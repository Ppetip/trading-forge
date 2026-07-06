import { randomUUID } from "node:crypto";
import { assertUsage, recordUsage } from "./plans.mjs";
import { parseStrategyPrompt } from "./prompt-parser.mjs";
import { badRequest } from "./validation.mjs";

const SOURCE_TYPES = new Set(["youtube_transcript", "video_transcript", "trading_notes", "course_notes", "discord", "x_thread"]);

function hydrate(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceUrl: row.source_url,
    title: row.title,
    content: row.content,
    status: row.status,
    extraction: row.extracted_rules_json ? JSON.parse(row.extracted_rules_json) : null,
    createdAt: row.created_at
  };
}

export async function listTranscriptSources(db, userId) {
  return (await db.prepare("SELECT * FROM transcript_sources WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(userId)).map(hydrate);
}

export async function createTranscriptSource(db, account, body) {
  await assertUsage(db, account, "transcript_extraction", "transcriptExtractions");
  const sourceType = String(body.sourceType ?? "");
  if (!SOURCE_TYPES.has(sourceType)) throw badRequest("Choose a supported transcript source type.");
  const content = String(body.content ?? "").trim();
  if (content.length < 40) throw badRequest("Paste at least 40 characters of transcript or notes.");
  if (content.length > 100_000) throw badRequest("Transcript content must not exceed 100,000 characters.");
  const title = String(body.title ?? "Untitled transcript").trim().slice(0, 160) || "Untitled transcript";
  const sourceUrl = body.sourceUrl ? String(body.sourceUrl).trim().slice(0, 2048) : null;
  if (sourceUrl) {
    let parsed;
    try { parsed = new URL(sourceUrl); } catch { throw badRequest("Source URL must be valid."); }
    if (!["http:", "https:"].includes(parsed.protocol)) throw badRequest("Source URL must use HTTP or HTTPS.");
  }
  const parsed = parseStrategyPrompt(content, body.defaults ?? {});
  const rules = parsed.rules;
  const detected = {
    market: rules.market ?? null,
    symbol: rules.symbol ?? null,
    timeframe: rules.timeframe ?? null,
    entry: rules.entryRule ?? null,
    stop: rules.stopRule ?? null,
    target: rules.rewardRisk ? `${rules.rewardRisk}R target` : null,
    filters: [rules.direction, rules.maxTradesPerDay ? `Maximum ${rules.maxTradesPerDay} trade(s) per day` : null].filter(Boolean),
    risk: { rewardRisk: rules.rewardRisk ?? null, fees: rules.fees ?? null, slippage: rules.slippage ?? null },
    missing: parsed.assumptions,
    unsupported: parsed.untestable,
    backtestReady: !parsed.clarificationNeeded && parsed.untestable.length === 0
  };
  const extraction = {
    parser: parsed.parser,
    summary: content.length > 280 ? `${content.slice(0, 277).trim()}â€¦` : content,
    rules,
    detected,
    assumptions: parsed.assumptions,
    untestable: parsed.untestable,
    clarificationNeeded: parsed.clarificationNeeded,
    warning: "Rules were extracted from user-provided text. Review every rule and assumption before testing."
  };
  const id = randomUUID(), createdAt = new Date().toISOString();
  await db.prepare(`
    INSERT INTO transcript_sources (id, user_id, source_type, source_url, title, content, status, extracted_rules_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'extracted', ?, ?)
  `).run(id, account.id, sourceType, sourceUrl, title, content, JSON.stringify(extraction), createdAt);
  await recordUsage(db, account.id, "transcript_upload", { sourceId: id, sourceType, characters: content.length });
  await recordUsage(db, account.id, "transcript_extraction", { sourceId: id, parser: parsed.parser });
  return { id, sourceType, sourceUrl, title, content, status: "extracted", extraction, createdAt };
}


