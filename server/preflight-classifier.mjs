import { AI_MODELS, callOpenRouterJson } from "./ai-provider.mjs";
import { INPUT_TIER, NEXT_WORKFLOW_TIER, PLAN_IMPLICATION, PREFLIGHT_ENUMS, PREFLIGHT_VERSION, STRATEGY_FAMILY } from "./preflight-definitions.mjs";

const FUTURES = ["NQ", "ES", "YM", "RTY", "CL", "GC", "6E", "MES", "MNQ", "MGC"];
const READY_FAMILIES = new Set([STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT, STRATEGY_FAMILY.PREVIOUS_DAY_LEVEL]);
const TIER_RANK = Object.freeze({
  [INPUT_TIER.LIVE_TRADE_ADVICE]: 0,
  [INPUT_TIER.CODE_ADMIN_DEPLOYMENT]: 0,
  [INPUT_TIER.REPORT_REVIEW]: 1,
  [INPUT_TIER.TRANSCRIPT_OR_NOTES]: 1,
  [INPUT_TIER.UNSUPPORTED_OR_UNCLEAR]: 1,
  [INPUT_TIER.STRATEGY_VAGUE]: 2,
  [INPUT_TIER.STRATEGY_PARSEABLE]: 3,
  [INPUT_TIER.STRATEGY_READY]: 4
});

export async function classifyPreflight(prompt, {
  defaults = {},
  fetchImpl = fetch,
  model = AI_MODELS.preflightClassifier,
  modelClassifier = classifyWithOpenRouter
} = {}) {
  const deterministic = deterministicPreflight(prompt, defaults);
  let modelOutput = null;
  let modelError = null;
  try {
    modelOutput = await modelClassifier(prompt, { defaults, fetchImpl, model, deterministic });
  } catch (error) {
    modelError = error;
  }
  const candidate = validatePreflight(modelOutput) ? normalizeClassification(modelOutput, "model") : deterministic;
  const downgraded = downgrade(candidate, deterministic);
  const confidenceSafe = downgraded.confidence < 0.65
    ? { ...downgraded, nextWorkflowTier: NEXT_WORKFLOW_TIER.CLARIFICATION, shouldRunFullParser: false,
      warnings: unique([...downgraded.warnings, "Low classifier confidence; full parser was not allowed to run."]) }
    : downgraded;
  return {
    ...confidenceSafe,
    model: modelOutput ? model : null,
    fallbackUsed: !modelOutput || !validatePreflight(modelOutput) || Boolean(modelError),
    modelErrorCode: modelError?.code ?? null
  };
}

export function deterministicPreflight(prompt, defaults = {}) {
  const text = String(prompt ?? "").trim();
  const lower = text.toLowerCase();
  const detectedSymbols = FUTURES.filter((symbol) => new RegExp(`\\b${symbol}\\b`, "i").test(text));
  const reasons = [], warnings = [], missingFields = [];
  let inputTier = INPUT_TIER.STRATEGY_VAGUE;
  let nextWorkflowTier = NEXT_WORKFLOW_TIER.CLARIFICATION;
  let strategyFamily = STRATEGY_FAMILY.UNKNOWN;
  let planImplication = detectedSymbols.length ? PLAN_IMPLICATION.PRO_DATA_LIKELY : PLAN_IMPLICATION.FREE_OK;
  let confidence = 0.62;

  if (/\b(should i buy|should i sell|enter now|exit now|hold or sell|what trade should i take|live trade|right now)\b/i.test(text)) {
    return base({ inputTier: INPUT_TIER.LIVE_TRADE_ADVICE, nextWorkflowTier: NEXT_WORKFLOW_TIER.SAFETY_REDIRECT, planImplication: PLAN_IMPLICATION.BLOCKED_SAFETY,
      confidence: 0.9, reasons: ["Prompt appears to ask for live trade advice."], warnings: ["EdgeLab can test historical rules, not tell users what to trade live."], detectedSymbols });
  }
  if (text.length > 3500 || /\b(transcript|youtube|video|course notes|discord|twitter thread|x thread|paste these notes)\b/i.test(text)) {
    return base({ inputTier: INPUT_TIER.TRANSCRIPT_OR_NOTES, nextWorkflowTier: NEXT_WORKFLOW_TIER.TRANSCRIPT_EXTRACTOR, planImplication: PLAN_IMPLICATION.PAID_AI_LIKELY,
      confidence: text.length > 3500 ? 0.86 : 0.74, reasons: ["Input looks like a transcript, notes, or long-form source."], warnings, detectedSymbols });
  }
  if (/\b(deploy|github|server|database|sqlite|admin|billing|stripe|api key|env|css|html|button|contrast|bug|code|component|route)\b/i.test(text)) {
    return base({ inputTier: INPUT_TIER.CODE_ADMIN_DEPLOYMENT, nextWorkflowTier: NEXT_WORKFLOW_TIER.CODE_ADMIN_SUPPORT, planImplication: PLAN_IMPLICATION.ADMIN_ONLY,
      confidence: 0.86, reasons: ["Input is about app/code/admin/deployment work, not a backtestable trading strategy."], warnings, detectedSymbols });
  }
  if (/\b(report|drawdown|profit factor|win rate|why did|failed|game plan|review this|iterate)\b/i.test(text) && !/\b(buy|sell|long|short|breakout|orb|opening range|rsi|ema|sma)\b/i.test(text)) {
    return base({ inputTier: INPUT_TIER.REPORT_REVIEW, nextWorkflowTier: NEXT_WORKFLOW_TIER.CHEAP_HELPER, planImplication: PLAN_IMPLICATION.PAID_AI_LIKELY,
      confidence: 0.75, reasons: ["Input looks like a report question rather than a new strategy."], warnings, detectedSymbols });
  }

  if (/\b(opening range|orb)\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT;
  else if (/\bprevious day|prior day|pd[hl]\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.PREVIOUS_DAY_LEVEL;
  else if (/\b(bollinger).{0,50}\brsi\b|\brsi\b.{0,50}\b(bollinger)\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.BOLLINGER_RSI;
  else if (/\brsi\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.RSI_MEAN_REVERSION;
  else if (/\b(ema|sma|moving average)\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.MOVING_AVERAGE;
  else if (/\b(support|resistance|breakout)\b/i.test(text)) strategyFamily = STRATEGY_FAMILY.SUPPORT_RESISTANCE;

  if (!/\b(stop|stop-loss|sl|opposite side|atr|swing low|swing high|opening range|orb)\b/i.test(text)) missingFields.push("stop_loss");
  if (!/\b(target|take profit|tp|risk reward|reward|1\s*[:/]\s*\d|\d+r)\b/i.test(text)) missingFields.push("take_profit");
  if (!/\b(1m|5m|15m|30m|60m|1h|daily|day|minute|hour|timeframe)\b/i.test(text)) missingFields.push("timeframe");
  if (!detectedSymbols.length && !defaults.symbol) missingFields.push("market_symbol");
  if (detectedSymbols.length) warnings.push("Futures symbol detected; premium data or a proxy may be required.");

  const hasEntry = /\b(buy|sell|long|short|break|cross|close[s]? above|close[s]? below|opening range|orb|rsi|ema|sma)\b/i.test(text);
  const ready = hasEntry && missingFields.length === 0 && READY_FAMILIES.has(strategyFamily);
  if (ready) {
    inputTier = INPUT_TIER.STRATEGY_READY;
    nextWorkflowTier = NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER;
    confidence = 0.82;
    reasons.push("Prompt includes an executable supported strategy with symbol, timeframe, stop, and target clues.");
  } else if (hasEntry && strategyFamily !== STRATEGY_FAMILY.UNKNOWN) {
    inputTier = missingFields.length ? INPUT_TIER.STRATEGY_VAGUE : INPUT_TIER.STRATEGY_PARSEABLE;
    nextWorkflowTier = missingFields.length ? NEXT_WORKFLOW_TIER.CLARIFICATION : NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER;
    confidence = missingFields.length ? 0.68 : 0.76;
    reasons.push(missingFields.length ? "Strategy-like prompt is missing required execution details." : "Strategy-like prompt has objective rules but may need engine support verification.");
  } else {
    reasons.push("Input did not clearly define an objective supported strategy.");
  }
  return base({ inputTier, nextWorkflowTier, strategyFamily, planImplication, confidence, reasons, warnings, missingFields, detectedSymbols });
}

async function classifyWithOpenRouter(prompt, { defaults, fetchImpl, model, deterministic }) {
  return callOpenRouterJson({ model, fetchImpl, messages: [
    { role: "system", content: `You are EdgeLab's cheap preflight classifier. Return strict JSON only. Never upgrade vague input. When in doubt downgrade. Valid inputTier values: ${[...PREFLIGHT_ENUMS.inputTier].join(", ")}. Valid nextWorkflowTier values: ${[...PREFLIGHT_ENUMS.nextWorkflowTier].join(", ")}. Valid strategyFamily values: ${[...PREFLIGHT_ENUMS.strategyFamily].join(", ")}. Valid planImplication values: ${[...PREFLIGHT_ENUMS.planImplication].join(", ")}. confidence must be 0..1. shouldRunFullParser may be true only for STRATEGY_PARSEABLE or STRATEGY_READY with confidence >= 0.65.` },
    { role: "user", content: JSON.stringify({ prompt: String(prompt ?? "").slice(0, 6000), defaults, deterministic }) }
  ] });
}

function validatePreflight(value) {
  return Boolean(value && typeof value === "object" &&
    PREFLIGHT_ENUMS.inputTier.has(value.inputTier) &&
    PREFLIGHT_ENUMS.nextWorkflowTier.has(value.nextWorkflowTier) &&
    PREFLIGHT_ENUMS.strategyFamily.has(value.strategyFamily) &&
    PREFLIGHT_ENUMS.planImplication.has(value.planImplication) &&
    Number.isFinite(Number(value.confidence)) &&
    Array.isArray(value.reasons) &&
    Array.isArray(value.warnings) &&
    Array.isArray(value.missingFields) &&
    Array.isArray(value.detectedSymbols));
}

function normalizeClassification(value, source) {
  const confidence = Math.max(0, Math.min(1, Number(value.confidence)));
  const inputTier = value.inputTier;
  const nextWorkflowTier = [INPUT_TIER.STRATEGY_READY, INPUT_TIER.STRATEGY_PARSEABLE].includes(inputTier) && confidence >= 0.65
    ? value.nextWorkflowTier
    : value.nextWorkflowTier === NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER ? NEXT_WORKFLOW_TIER.CLARIFICATION : value.nextWorkflowTier;
  return base({ ...value, inputTier, nextWorkflowTier, confidence, source,
    shouldRunFullParser: Boolean(value.shouldRunFullParser) && nextWorkflowTier === NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER && confidence >= 0.65 });
}

function downgrade(candidate, deterministic) {
  const deterministicRank = TIER_RANK[deterministic.inputTier] ?? 1;
  const candidateRank = TIER_RANK[candidate.inputTier] ?? 1;
  const inputTier = candidateRank > deterministicRank + 1 ? deterministic.inputTier : candidate.inputTier;
  const hardDeterministic = [
    INPUT_TIER.LIVE_TRADE_ADVICE,
    INPUT_TIER.CODE_ADMIN_DEPLOYMENT,
    INPUT_TIER.TRANSCRIPT_OR_NOTES,
    INPUT_TIER.REPORT_REVIEW
  ].includes(deterministic.inputTier);
  const next = hardDeterministic ? deterministic.nextWorkflowTier : candidate.nextWorkflowTier;
  const confidence = Math.min(candidate.confidence, hardDeterministic ? deterministic.confidence : 1);
  const shouldRunFullParser = [INPUT_TIER.STRATEGY_READY, INPUT_TIER.STRATEGY_PARSEABLE].includes(inputTier) && next === NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER && confidence >= 0.65;
  return base({ ...candidate, inputTier, nextWorkflowTier: shouldRunFullParser ? NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER : next,
    confidence, reasons: unique([...deterministic.reasons, ...candidate.reasons]), warnings: unique([...deterministic.warnings, ...candidate.warnings]),
    missingFields: unique([...deterministic.missingFields, ...candidate.missingFields]), detectedSymbols: unique([...deterministic.detectedSymbols, ...candidate.detectedSymbols]),
    shouldRunFullParser });
}

function base(input) {
  const confidence = Math.max(0, Math.min(1, Number(input.confidence ?? 0.5)));
  const nextWorkflowTier = input.nextWorkflowTier ?? NEXT_WORKFLOW_TIER.CLARIFICATION;
  const inputTier = input.inputTier ?? INPUT_TIER.STRATEGY_VAGUE;
  return {
    version: PREFLIGHT_VERSION,
    inputTier,
    nextWorkflowTier,
    strategyFamily: input.strategyFamily ?? STRATEGY_FAMILY.UNKNOWN,
    planImplication: input.planImplication ?? PLAN_IMPLICATION.FREE_OK,
    confidence,
    reasons: unique(input.reasons ?? []),
    warnings: unique(input.warnings ?? []),
    missingFields: unique(input.missingFields ?? []),
    detectedSymbols: unique(input.detectedSymbols ?? []),
    shouldRunFullParser: Boolean(input.shouldRunFullParser) || ([INPUT_TIER.STRATEGY_READY, INPUT_TIER.STRATEGY_PARSEABLE].includes(inputTier) && nextWorkflowTier === NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER && confidence >= 0.65),
    source: input.source ?? "deterministic"
  };
}

const unique = (items) => [...new Set((items ?? []).map(String).filter(Boolean))];
