import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, BarChart3, Beaker, BookOpen, Check, Database, FileText, FlaskConical,
  LogOut, Play, Save, Sparkles, Upload, UserRound
} from "lucide-react";
import { parseCandleCsv } from "./backtest";
import { ApiError, saasApi, type ApiAccount } from "./saas-api";
import type { Candle, StrategyRules } from "./types";
import { classifyStrategy, hasServerEngine, readinessLabel, STRATEGY_READINESS, type StrategyReadiness } from "./engineCapabilities";
import { PaywallModal, paywallFromError, type PaywallInfo } from "./PaywallModal";

type SaaSPage = "workspace" | "strategies";
type ServerResult = {
  id: string;
  rules: StrategyRules;
  result: {
    trades: Array<Record<string, unknown>>;
    totalR: number;
    averageR: number;
    winRate: number;
    wins: number;
    losses: number;
    profitFactor: number | null;
    maxDrawdown: number;
    longestLosingStreak: number;
    monthly: Array<{ month: string; value: number }>;
    equity: number[];
    drawdown: number[];
  };
  createdAt: string;
};
type PreflightClassification = {
  inputTier: string;
  nextWorkflowTier: string;
  strategyFamily: string;
  planImplication: string;
  confidence: number;
  reasons: string[];
  warnings: string[];
  missingFields: string[];
  detectedSymbols: string[];
  shouldRunFullParser: boolean;
  fallbackUsed?: boolean;
};

const defaults: StrategyRules = {
  name: "NQ 8:00 Opening Range", strategyType: "opening_range_breakout", market: "Futures",
  symbol: "NQ", timeframe: "5m", dateRange: "1y", sessionTime: "08:00",
  timezone: "America/New_York", openingRangeMinutes: 15, entryRule: "break_above_or_below_range",
  stopRule: "opposite_side_of_range", rewardRisk: 3, direction: "long_and_short",
  maxTradesPerDay: 1, fees: true, slippage: true
};

const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const yearsFor = (range: StrategyRules["dateRange"]) => ({ "6m": 0.5, "1y": 1, "3y": 3, "5y": 5 })[range] ?? 1;
const hasPremiumData = (plan: ApiAccount["plan"]) => plan === "trial" || plan === "pro" || plan === "power";
const cleanLabel = (value: string) => value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function dataWindowPaywall(rules: StrategyRules, plan: ApiAccount["plan"]): PaywallInfo | null {
  const intraday = true;
  const maxResearchYears = rules.timeframe === "1m" ? 7 / 365 : 60 / 365;
  if (!intraday || yearsFor(rules.dateRange) <= maxResearchYears || hasPremiumData(plan)) return null;
  const limit = rules.timeframe === "1m" ? "about 7 days" : "about 60 days";
  return {
    title: "This test needs premium intraday data",
    message: `${rules.dateRange} of ${rules.timeframe} candles is beyond research-grade intraday limits (${limit}). EdgeLab will not silently shrink that window because it would make the report misleading.`,
    options: ["Upgrade to Pro for premium intraday data", `Reduce the window to ${limit}`, "Upload your own candles", rules.symbol === "NQ" ? "Use QQQ as a research-grade proxy" : "Use daily candles for a cheaper first-pass test"],
    primaryHref: "#/account",
    primaryLabel: "Compare plans"
  };
}

export default function SaaSWorkspace({ initialPage = "workspace" }: { initialPage?: SaaSPage }) {
  const [account, setAccount] = useState<ApiAccount | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [page, setPage] = useState<SaaSPage>(initialPage);
  const [rules, setRules] = useState<StrategyRules>(() => { try { return JSON.parse(window.localStorage.getItem("edgelab.iterateRules") || "null") || defaults; } catch { return defaults; } });
  const [prompt, setPrompt] = useState(() => window.localStorage.getItem("edgelab.iteratePrompt") || window.localStorage.getItem("edgelab.samplePrompt") || "Test the 8 AM opening range breakout on NQ. Use a 15-minute range and 1:3 risk reward.");
  const [assumptions, setAssumptions] = useState<string[]>([]);
  const [readiness, setReadiness] = useState<StrategyReadiness>(STRATEGY_READINESS.READY_TO_BACKTEST);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataLabel, setDataLabel] = useState("Automatic Databento ready");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [report, setReport] = useState<ServerResult | null>(null);
  const [cached, setCached] = useState(false);
  const [reports, setReports] = useState<Array<Record<string, unknown>>>([]);
  const [strategies, setStrategies] = useState<Array<Record<string, unknown>>>([]);
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [comparison, setComparison] = useState("single");
  const [paywall, setPaywall] = useState<PaywallInfo | null>(null);
  const [preflight, setPreflight] = useState<PreflightClassification | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saasApi.account().then(({ account }) => setAccount(account)).catch(() => setAccount(null)).finally(() => setLoadingAccount(false));
  }, []);

  useEffect(() => {
    if (account && initialPage === "strategies") {
      saasApi.strategies().then(({ strategies }) => setStrategies(strategies)).catch(handleError);
    }
  }, [account, initialPage]);

  const rulePreview = useMemo(() => ({
    ...rules,
    strategy_type: rules.strategyType, data_source: dataLabel,
    same_bar_policy: "stop_first"
  }), [rules, dataLabel]);

  const handleError = (caught: unknown) => {
    const paywallInfo = paywallFromError(caught);
    if (paywallInfo) { setPaywall(paywallInfo); setError(""); return; }
    const apiError = caught as ApiError;
    const maybePreflight = (apiError.details as { preflight?: PreflightClassification } | undefined)?.preflight;
    if (apiError.code === "PREFLIGHT_NOT_PARSEABLE" && maybePreflight) {
      setPreflight(maybePreflight);
      setError("");
      setMessage("");
      setReadiness(STRATEGY_READINESS.NEEDS_CLARIFICATION);
      return;
    }
    setError(apiError.message || "Request failed.");
    if (apiError.status === 401) setAccount(null);
  };

  async function refreshAccount() {
    const response = await saasApi.account();
    setAccount(response.account);
  }

  async function parsePrompt(showConfirmation = true) {
    setError(""); if (showConfirmation) setMessage("");
    try {
      const classified = (await saasApi.preflightClassify(prompt, { symbol: rules.symbol, timezone: rules.timezone })).preflight as unknown as PreflightClassification;
      setPreflight(classified);
      if (!classified.shouldRunFullParser) {
        setReadiness(STRATEGY_READINESS.NEEDS_CLARIFICATION);
        if (showConfirmation) setMessage("");
        return { rules, status: STRATEGY_READINESS.NEEDS_CLARIFICATION };
      }
    } catch {
      setPreflight(null);
    }
    const response = await saasApi.parseRules(prompt, { symbol: rules.symbol, timezone: rules.timezone });
    const parsedRules = response.rules as unknown as StrategyRules;
    setRules(parsedRules);
    setAssumptions([...response.assumptions, ...response.untestable.map((item) => `Unsupported: ${item}`)]);
    const status = classifyStrategy(parsedRules.strategyType, response.untestable);
    setReadiness(status);
    if (showConfirmation) setMessage(status === STRATEGY_READINESS.READY_TO_BACKTEST ? "Rules extracted and ready to backtest." : readinessLabel(status));
    return { rules: parsedRules, status };
  }

  function addCommonDefaults() {
    const next: StrategyRules = {
      ...rules,
      strategyType: "opening_range_breakout" as const,
      symbol: rules.symbol || "NQ",
      timeframe: rules.timeframe || "5m",
      dateRange: rules.dateRange || "1y",
      sessionTime: rules.sessionTime || "08:00",
      timezone: rules.timezone || "America/New_York",
      openingRangeMinutes: rules.openingRangeMinutes || 15,
      stopRule: "opposite_side_of_range" as const,
      rewardRisk: rules.rewardRisk || 3,
      maxTradesPerDay: 1,
      fees: true,
      slippage: true
    };
    setRules(next);
    setPrompt((current) => `${current.trim()}\n\nUse ${next.symbol}, ${next.timeframe} candles, latest ${next.dateRange}, stop at the opposite side of the range, take profit at 1:${next.rewardRisk}, one trade per day, fees and slippage included.`);
    setMessage("Added common objective defaults. Preview rules again before running.");
    setPreflight(null);
  }

  async function upload(file?: File) {
    if (!file) return;
    try {
      const parsed = parseCandleCsv(await file.text());
      setCandles(parsed); setDataLabel(`${file.name} · ${parsed.length.toLocaleString()} candles`);
      setMessage("Historical candles loaded locally. They are sent to the server only when you run a test.");
      setError("");
    } catch (caught) { handleError(caught); }
  }

  async function runSingle(nextRules = rules) {
    if (["previous_day_breakout", "previous_day_sweep"].includes(nextRules.strategyType) && !candles.length) {
      throw new Error("This server engine needs uploaded daily-session candles until automatic daily-level routing is enabled.");
    }
    const payload = { rules: nextRules, ...(candles.length ? { candles } : {}), strategyVersionId: versionId, visibility: "private" };
    const response = ["previous_day_breakout", "previous_day_sweep"].includes(nextRules.strategyType)
      ? await saasApi.runDailyLevel(payload)
      : await saasApi.runOrb(payload);
    setReport(response.report as unknown as ServerResult);
    setCached(response.cached);
    return response;
  }

  async function validateStrategy() {
    if (!account) return;
    setError(""); setMessage("AI is clarifying the rules and preparing market data…");
    try {
      const parsed = await parsePrompt(false);
      const tierWarning = candles.length ? null : dataWindowPaywall(parsed.rules, account.plan);
      if (tierWarning) { setMessage(""); setPaywall(tierWarning); return; }
      if (parsed.status === STRATEGY_READINESS.NEEDS_CLARIFICATION) { setMessage(""); return; }
      if (parsed.status === STRATEGY_READINESS.UNSUPPORTED_VAGUE_PROMPT) { setMessage(""); setError("Required execution rules are still subjective or undefined. Choose objective assumptions before testing."); return; }
      if (parsed.status === STRATEGY_READINESS.PARSED_BUT_UNSUPPORTED) { setMessage("Rules extracted successfully."); setError(`These rules are objective, but the ${parsed.rules.strategyType.replaceAll("_", " ")} server engine is not implemented. No report was created.`); return; }
      await runSingle(parsed.rules);
      setDataLabel(`Automatic Databento · ${parsed.rules.dateRange || "1y"}`);
      setMessage("Validation complete. Rules, market data, and report were saved.");
      await refreshAccount();
    } catch (caught) { handleError(caught); }
  }
  async function run() {
    if (!account) return;
    setError(""); setMessage("");
    const tierWarning = candles.length ? null : dataWindowPaywall(rules, account.plan);
    if (tierWarning) { setPaywall(tierWarning); return; }
    if (readiness !== STRATEGY_READINESS.READY_TO_BACKTEST || !hasServerEngine(rules.strategyType)) {
      setError("This strategy is not ready for a real server backtest. Clarify it and confirm that a server engine is available first.");
      return;
    }
    try {
      if (comparison === "single") {
        await runSingle();
        setMessage("Server backtest complete. The report is saved automatically.");
      } else {
        const ratios = comparison.split(",").map(Number);
        const outcomes = [];
        for (const rewardRisk of ratios) outcomes.push(await runSingle({ ...rules, rewardRisk, name: `${rules.name} 1:${rewardRisk}` }));
        const best = outcomes.toSorted((a, b) => (b.report.result as { averageR: number }).averageR - (a.report.result as { averageR: number }).averageR)[0];
        setReport(best.report as unknown as ServerResult);
        setMessage(`Compared ${ratios.map((ratio) => `1:${ratio}`).join(", ")}. Showing the highest average-R report without claiming live profitability.`);
      }
      await refreshAccount();
    } catch (caught) { handleError(caught); }
  }

  async function saveVersion() {
    setError(""); setMessage("");
    try {
      if (!strategyId) {
        const response = await saasApi.createStrategy({ name: rules.name, rules, prompt, changeSummary: "Initial version" });
        setStrategyId(response.strategy.id); setVersionId(response.strategy.versionId);
        setMessage("Strategy v1 saved.");
      } else {
        const response = await saasApi.createVersion(strategyId, { name: rules.name, rules, prompt, changeSummary: "Rules updated from workspace" });
        setVersionId(response.version.id);
        setMessage(`Strategy v${response.version.versionNumber} saved without overwriting earlier versions.`);
      }
      await refreshAccount();
    } catch (caught) { handleError(caught); }
  }

  async function loadAccountData(nextPage: SaaSPage) {
    setPage(nextPage); setError("");
    try {
      if (nextPage === "strategies") setStrategies((await saasApi.strategies()).strategies);
      await refreshAccount();
    } catch (caught) { handleError(caught); }
  }

  if (loadingAccount) return <div className="saas-loading"><Beaker /> Loading EdgeLabâ€¦</div>;
  if (!account) return <AuthScreen onAuthenticated={async () => { await refreshAccount(); setPage(initialPage); }} />;

  return <div className="saas-shell">
    <aside className="saas-sidebar">
      <a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i><small>SAAS</small></a>
      <p>RESEARCH</p>
      <button className={page === "workspace" ? "active" : ""} onClick={() => { window.location.hash = "#/app"; setPage("workspace"); }}><FlaskConical size={16} />Test a Strategy</button>
      <button onClick={() => { window.location.hash = "#/reports"; }}><FileText size={16} />My Reports</button>
      <button className={page === "strategies" ? "active" : ""} onClick={() => { window.location.hash = "#/strategies"; loadAccountData("strategies"); }}><BookOpen size={16} />My Strategies</button>
      <a className="saas-nav-link" href="#/templates"><BookOpen size={16} />Strategy Packs</a>
      <a className="saas-nav-link" href="#/transcripts"><Sparkles size={16} />Extract from Video/Notes</a>
      <a className="saas-nav-link" href="#/account"><UserRound size={16} />Account & Pricing</a>
      {account.role === "admin" && <a className="saas-nav-link admin" href="#/admin"><Sparkles size={16} />Data Spend Control</a>}
      <div className="saas-plan"><span>{account.plan.toUpperCase()} PLAN</span><strong>{account.usage.used.backtests}/{account.usage.limits.backtests}</strong><small>backtests this month</small><div><i style={{ width: `${Math.min(100, account.usage.used.backtests / Math.max(1, account.usage.limits.backtests) * 100)}%` }} /></div></div>
      <button className="logout" onClick={async () => { await saasApi.logout(); setAccount(null); }}><LogOut size={15} />Log out</button>
    </aside>
    <main className="saas-main">
      {message && <div className="saas-alert success"><Check size={14} />{message}</div>}
      {error && <div className="saas-alert error">{error}</div>}
      {page === "workspace" && <WorkspaceWithPaywall
        rules={rules} setRules={setRules} prompt={prompt} setPrompt={(value) => { setPrompt(value); setReadiness(STRATEGY_READINESS.NEEDS_CLARIFICATION); setReport(null); setPreflight(null); }} assumptions={assumptions}
        parsePrompt={() => { parsePrompt().catch(handleError); }} validateStrategy={validateStrategy} upload={() => fileRef.current?.click()} fileRef={fileRef} onFile={upload}
        dataLabel={dataLabel} rulePreview={rulePreview} comparison={comparison} setComparison={setComparison}
        run={run} saveVersion={saveVersion} plan={account.plan} readiness={readiness} report={report} cached={cached} versionId={versionId}
        openPaywall={setPaywall} preflight={preflight} addCommonDefaults={addCommonDefaults}
      />}
      {page === "strategies" && <AccountPage account={account} strategies={strategies} />}
    </main>
    {paywall && <PaywallModal info={paywall} onClose={() => setPaywall(null)} />}
  </div>;
}

function AuthScreen({ onAuthenticated }: { onAuthenticated: () => Promise<void> }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError("");
    try {
      if (mode === "register") await saasApi.register({ email, displayName, password });
      else await saasApi.login({ email, password });
      await onAuthenticated();
    } catch (caught) { setError((caught as Error).message); }
  };
  return <div className="auth-page"><div className="auth-copy"><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><p>HONEST STRATEGY RESEARCH</p><h1>Your ideas.<br />Testable rules.<br /><em>Saved evidence.</em></h1><ul><li><Check />Server-calculated backtests</li><li><Check />Versioned strategy research</li><li><Check />Cached, repeatable reports</li></ul></div><form className="auth-card" onSubmit={submit}><p>{mode === "register" ? "CREATE YOUR WORKSPACE" : "WELCOME BACK"}</p><h2>{mode === "register" ? "Start with the free plan" : "Sign in to EdgeLab"}</h2>{mode === "register" && <label>Display name<input required minLength={2} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>}<label>Email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Password<input required type="password" minLength={10} value={password} onChange={(event) => setPassword(event.target.value)} /></label>{error && <div className="auth-error">{error}</div>}<button type="submit">{mode === "register" ? "Create account" : "Sign in"} <ArrowRight size={14} /></button><small>{mode === "register" ? "Already have an account?" : "Need an account?"} <button type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>{mode === "register" ? "Sign in" : "Register"}</button></small></form></div>;
}

type WorkspaceProps = {
  rules: StrategyRules; setRules: (rules: StrategyRules) => void; prompt: string; setPrompt: (value: string) => void;
  assumptions: string[]; parsePrompt: () => void; validateStrategy: () => void; upload: () => void; fileRef: React.RefObject<HTMLInputElement>;
  onFile: (file?: File) => void; dataLabel: string; rulePreview: Record<string, unknown>; comparison: string;
  setComparison: (value: string) => void; run: () => void; saveVersion: () => void; report: ServerResult | null;
  cached: boolean; versionId: string | null; plan: ApiAccount["plan"]; readiness: StrategyReadiness;
  openPaywall: (info: PaywallInfo) => void;
  preflight: PreflightClassification | null; addCommonDefaults: () => void;
};

function WorkspaceWithPaywall(props: WorkspaceProps) {
  const { rules, setRules } = props;
  const tierWarning = dataWindowPaywall(rules, props.plan);
  const openComparisonPaywall = () => props.openPaywall({
    title: "Controlled comparisons are a paid research tool",
    message: "Batching multiple risk/reward versions uses more compute and creates more saved reports, so it unlocks on paid plans.",
    options: ["Upgrade to run all versions together", "Run one version manually on Free", "Save the baseline first, then iterate one change at a time"],
    primaryHref: "#/account",
    primaryLabel: "View plans"
  });
  return <>
    <header className="saas-header"><div><p>STRATEGY WORKSPACE</p><h1>{rules.name}</h1><span>{props.versionId ? "Version saved" : "Unsaved draft"} · Server-backed ORB</span></div><div><button onClick={props.saveVersion}><Save size={14} />Save version</button><button className="primary" onClick={props.validateStrategy}><Sparkles size={14} />Validate strategy</button></div></header>
    <div className="saas-workspace"><section>
      <div className="saas-card"><div className="saas-card-title"><span>01</span><h2>Describe the strategy</h2><em><Sparkles size={12} />Prompt-to-rules</em></div><textarea value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} /><div className="card-foot"><small>AI structures rules; the engine calculates results.</small><button className="validate-inline" onClick={props.parsePrompt}>Preview extracted rules <ArrowRight size={12} /></button></div></div>
      {props.preflight && <PreflightPanel preflight={props.preflight} onAddDefaults={props.addCommonDefaults} />}
      <div className="market-data-status"><Database size={16} /><div><strong>Market data is automatic</strong><span>Research-grade data is used when possible. Premium intraday/futures requests are explained before running.</span></div><em>{props.dataLabel}</em><details><summary>Use custom CSV instead</summary><input hidden ref={props.fileRef} type="file" accept=".csv" onChange={(event) => props.onFile(event.target.files?.[0])} /><button onClick={props.upload}><Upload size={13} />Upload CSV</button></details></div>
      <div className="saas-card"><div className="saas-card-title"><span>03</span><h2>Exact rules</h2><em className={props.readiness === STRATEGY_READINESS.READY_TO_BACKTEST ? "valid" : ""}>{readinessLabel(props.readiness)}</em></div>{props.assumptions.length > 0 && <div className="assumption-list"><strong>Parser assumptions</strong>{props.assumptions.map((item) => <span key={item}>{item}</span>)}</div>}<pre>{JSON.stringify(props.rulePreview, null, 2)}</pre></div>
      {props.report && <ServerReport report={props.report} cached={props.cached} />}
    </section><aside className="saas-settings"><details className="advanced-settings"><summary>Advanced controls</summary><h2>Test settings</h2><p>Every setting becomes part of the cache key.</p>
      <label>Name<input value={rules.name} onChange={(event) => setRules({ ...rules, name: event.target.value })} /></label>
      <div className="field-row"><label>Symbol<input value={rules.symbol} onChange={(event) => setRules({ ...rules, symbol: event.target.value.toUpperCase() })} /></label><label>Timeframe<select value={rules.timeframe} onChange={(event) => setRules({ ...rules, timeframe: event.target.value as StrategyRules["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label></div>
      <label>Date range<select value={rules.dateRange} onChange={(event) => setRules({ ...rules, dateRange: event.target.value as StrategyRules["dateRange"] })}><option value="6m">6 months</option><option value="1y">1 year</option><option value="3y">3 years</option><option value="5y">5 years</option></select></label>
      {tierWarning && <div className="tier-warning"><strong>Premium data required</strong><span>{rules.dateRange} of {rules.timeframe} candles needs Pro premium data, a shorter window, or uploaded candles.</span></div>}
      <div className="field-row"><label>Session<input type="time" value={rules.sessionTime} onChange={(event) => setRules({ ...rules, sessionTime: event.target.value })} /></label><label>Range<select value={rules.openingRangeMinutes} onChange={(event) => setRules({ ...rules, openingRangeMinutes: Number(event.target.value) as StrategyRules["openingRangeMinutes"] })}><option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label></div>
      <label>Risk/reward comparison <small className="pro-badge">PRO</small><select value={props.comparison} onChange={(event) => { if (props.plan === "free" && event.target.value !== "single") openComparisonPaywall(); else props.setComparison(event.target.value); }}><option value="single">Single · 1:{rules.rewardRisk}</option><option value="2,3,4">Compare · 1:2 / 1:3 / 1:4</option></select></label>
      {props.plan === "free" && <button type="button" className="comparison-upgrade" onClick={openComparisonPaywall}>Unlock controlled comparisons and AI experiments</button>}
      {props.comparison === "single" && <label>Reward / risk<input type="number" min="1" max="10" step=".5" value={rules.rewardRisk} onChange={(event) => setRules({ ...rules, rewardRisk: Number(event.target.value) })} /></label>}
      <label>Direction<select value={rules.direction} onChange={(event) => setRules({ ...rules, direction: event.target.value as StrategyRules["direction"] })}><option value="long_and_short">Long & short</option><option value="long_only">Long only</option><option value="short_only">Short only</option></select></label>
      <Toggle label="Fees" checked={rules.fees} set={(fees) => setRules({ ...rules, fees })} /><Toggle label="Slippage" checked={rules.slippage} set={(slippage) => setRules({ ...rules, slippage })} />
      <button className="run-exact" onClick={props.run} disabled={props.readiness !== STRATEGY_READINESS.READY_TO_BACKTEST}><Play size={13} />{props.readiness === STRATEGY_READINESS.READY_TO_BACKTEST ? "Run exact rules" : "Clarify before testing"}</button>
      <div className="server-note"><Database size={14} /><div><strong>Server-calculated</strong><span>Results are never generated by AI.</span></div></div>
    </details></aside></div>
  </>;
}

function PreflightPanel({ preflight, onAddDefaults }: { preflight: PreflightClassification; onAddDefaults: () => void }) {
  const blocked = !preflight.shouldRunFullParser;
  const title = blocked ? "Needs one more step before parsing" : "Ready for rule extraction";
  const primaryReason = preflight.reasons[0] ?? "The prompt was classified before the full parser was allowed to spend tokens.";
  const routeHref = preflight.inputTier === "TRANSCRIPT_OR_NOTES" ? "#/transcripts"
    : preflight.inputTier === "REPORT_REVIEW" ? "#/reports"
      : preflight.inputTier === "CODE_ADMIN_DEPLOYMENT" ? "#/admin"
        : "#/account";
  const routeLabel = preflight.inputTier === "TRANSCRIPT_OR_NOTES" ? "Open extractor"
    : preflight.inputTier === "REPORT_REVIEW" ? "Open reports"
      : preflight.inputTier === "CODE_ADMIN_DEPLOYMENT" ? "Open admin"
        : "View data options";
  return <div className={blocked ? "preflight-panel blocked" : "preflight-panel ready"}>
    <div className="preflight-head"><div><span>AI PREFLIGHT · {Math.round(preflight.confidence * 100)}% confidence</span><h3>{title}</h3><p>{primaryReason}</p></div><strong>{cleanLabel(preflight.inputTier)}</strong></div>
    <div className="preflight-grid">
      <div><span>Workflow</span><b>{cleanLabel(preflight.nextWorkflowTier)}</b></div>
      <div><span>Family</span><b>{cleanLabel(preflight.strategyFamily)}</b></div>
      <div><span>Plan/data</span><b>{cleanLabel(preflight.planImplication)}</b></div>
      <div><span>Symbols</span><b>{preflight.detectedSymbols.length ? preflight.detectedSymbols.join(", ") : "Not specified"}</b></div>
    </div>
    {(preflight.missingFields.length > 0 || preflight.warnings.length > 0) && <div className="preflight-details">
      {preflight.missingFields.length > 0 && <section><h4>Missing details</h4>{preflight.missingFields.map((field) => <span key={field}>{cleanLabel(field)}</span>)}</section>}
      {preflight.warnings.length > 0 && <section><h4>Warnings</h4>{preflight.warnings.map((warning) => <span key={warning}>{warning}</span>)}</section>}
    </div>}
    <div className="preflight-actions">
      {preflight.inputTier === "STRATEGY_VAGUE" || preflight.inputTier === "UNSUPPORTED_OR_UNCLEAR" ? <button onClick={onAddDefaults}>Add common defaults</button> : null}
      {preflight.inputTier === "LIVE_TRADE_ADVICE" ? <span>EdgeLab tests historical rules; it does not give live buy/sell calls.</span> : <a href={routeHref}>{routeLabel} <ArrowRight size={12} /></a>}
      <small>{preflight.fallbackUsed ? "Used deterministic fallback." : "Cheap AI classifier checked this prompt."}</small>
    </div>
  </div>;
}

function Workspace(props: WorkspaceProps) {
  const { rules, setRules } = props;
  return <><header className="saas-header"><div><p>STRATEGY WORKSPACE</p><h1>{rules.name}</h1><span>{props.versionId ? "Version saved" : "Unsaved draft"} · Server-backed ORB</span></div><div><button onClick={props.saveVersion}><Save size={14} />Save version</button><button className="primary" onClick={props.validateStrategy}><Sparkles size={14} />Validate strategy</button></div></header><div className="saas-workspace"><section>
    <div className="saas-card"><div className="saas-card-title"><span>01</span><h2>Describe the strategy</h2><em><Sparkles size={12} />Prompt-to-rules</em></div><textarea value={props.prompt} onChange={(event) => props.setPrompt(event.target.value)} /><div className="card-foot"><small>AI structures rules; the engine calculates results.</small><button className="validate-inline" onClick={props.parsePrompt}>Preview extracted rules <ArrowRight size={12} /></button></div></div>
    <div className="market-data-status"><Database size={16} /><div><strong>Market data is automatic</strong><span>Databento fetches at least one year unless your prompt requests another period.</span></div><em>{props.dataLabel}</em><details><summary>Use custom CSV instead</summary><input hidden ref={props.fileRef} type="file" accept=".csv" onChange={(event) => props.onFile(event.target.files?.[0])} /><button onClick={props.upload}><Upload size={13} />Upload CSV</button></details></div>
    <div className="saas-card"><div className="saas-card-title"><span>03</span><h2>Exact rules</h2><em className={props.readiness === STRATEGY_READINESS.READY_TO_BACKTEST ? "valid" : ""}>{readinessLabel(props.readiness)}</em></div>{props.assumptions.length > 0 && <div className="assumption-list"><strong>Parser assumptions</strong>{props.assumptions.map((item) => <span key={item}>{item}</span>)}</div>}<pre>{JSON.stringify(props.rulePreview, null, 2)}</pre></div>
    {props.report && <ServerReport report={props.report} cached={props.cached} />}
  </section><aside className="saas-settings"><details className="advanced-settings"><summary>Advanced controls</summary><h2>Test settings</h2><p>Every setting becomes part of the cache key.</p><label>Name<input value={rules.name} onChange={(event) => setRules({ ...rules, name: event.target.value })} /></label><div className="field-row"><label>Symbol<input value={rules.symbol} onChange={(event) => setRules({ ...rules, symbol: event.target.value.toUpperCase() })} /></label><label>Timeframe<select value={rules.timeframe} onChange={(event) => setRules({ ...rules, timeframe: event.target.value as StrategyRules["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label></div><div className="field-row"><label>Session<input type="time" value={rules.sessionTime} onChange={(event) => setRules({ ...rules, sessionTime: event.target.value })} /></label><label>Range<select value={rules.openingRangeMinutes} onChange={(event) => setRules({ ...rules, openingRangeMinutes: Number(event.target.value) as StrategyRules["openingRangeMinutes"] })}><option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label></div><label>Risk/reward comparison <small className="pro-badge">PRO</small><select value={props.comparison} onChange={(event) => props.setComparison(event.target.value)} disabled={props.plan === "free"}><option value="single">Single · 1:{rules.rewardRisk}</option><option value="2,3,4">Compare · 1:2 / 1:3 / 1:4</option></select></label>{props.plan === "free" && <a className="comparison-upgrade" href="#/account">Unlock controlled comparisons and AI experiments</a>}{props.comparison === "single" && <label>Reward / risk<input type="number" min="1" max="10" step=".5" value={rules.rewardRisk} onChange={(event) => setRules({ ...rules, rewardRisk: Number(event.target.value) })} /></label>}<label>Direction<select value={rules.direction} onChange={(event) => setRules({ ...rules, direction: event.target.value as StrategyRules["direction"] })}><option value="long_and_short">Long & short</option><option value="long_only">Long only</option><option value="short_only">Short only</option></select></label><Toggle label="Fees" checked={rules.fees} set={(fees) => setRules({ ...rules, fees })} /><Toggle label="Slippage" checked={rules.slippage} set={(slippage) => setRules({ ...rules, slippage })} /><button className="run-exact" onClick={props.run} disabled={props.readiness !== STRATEGY_READINESS.READY_TO_BACKTEST}><Play size={13} />{props.readiness === STRATEGY_READINESS.READY_TO_BACKTEST ? "Run exact rules" : "Clarify before testing"}</button><div className="server-note"><Database size={14} /><div><strong>Server-calculated</strong><span>Results are never generated by AI.</span></div></div></details></aside></div></>;
}

function Toggle({ label, checked, set }: { label: string; checked: boolean; set: (value: boolean) => void }) { return <div className="toggle-row"><span>{label}</span><button className={checked ? "toggle on" : "toggle"} onClick={() => set(!checked)}><span /></button></div>; }

function ServerReport({ report, cached }: { report: ServerResult; cached: boolean }) {
  const result = report.result;
  const stats = [["Total R", formatR(result.totalR)], ["Win rate", `${result.winRate.toFixed(1)}%`], ["Trades", String(result.trades.length)], ["Average R", formatR(result.averageR)], ["Profit factor", result.profitFactor === null ? "âˆž" : result.profitFactor.toFixed(2)], ["Drawdown", `-${result.maxDrawdown.toFixed(2)}R`]];
  return <div className="server-report"><div className="report-head"><div><p>{cached ? "CACHED REPORT REUSED" : "NEW SERVER REPORT"}</p><h2>{report.rules.name}</h2></div><a href="#/reports">Open report history <ArrowRight size={12} /></a></div><div className="report-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="honesty-note">{result.trades.length < 30 && <span>Small sample warning: fewer than 30 trades.</span>}<span>Past backtest results do not guarantee live performance.</span></div></div>;
}

function ReportsPage({ reports }: { reports: Array<Record<string, unknown>> }) {
  return <div className="saas-page"><header><p>REPORT LIBRARY</p><h1>Saved backtest reports</h1><span>Server-stored, repeatable research records.</span></header>{reports.length ? <div className="saas-list">{reports.map((report) => { const rules = report.rules as StrategyRules; const result = report.result as ServerResult["result"]; return <article key={String(report.id)}><div><strong>{rules.name}</strong><span>{rules.symbol} · {rules.timeframe} · 1:{rules.rewardRisk}</span></div><div><b>{formatR(result.totalR)}</b><span>{result.trades.length} trades</span></div><em>{String(report.visibility)}</em></article>; })}</div> : <div className="saas-empty"><FileText /><h2>No reports yet</h2><p>Run a backtest to create your first server report.</p></div>}</div>;
}

function AccountPage({ account, strategies }: { account: ApiAccount; strategies: Array<Record<string, unknown>> }) {
  return <div className="saas-page"><header><p>STRATEGY LIBRARY</p><h1>My Strategies</h1><span>{account.email}</span></header><div className="account-grid"><section><span>PLAN</span><strong>{account.plan.toUpperCase()}</strong><small>{account.subscriptionStatus}</small></section><section><span>BACKTESTS</span><strong>{account.usage.used.backtests}/{account.usage.limits.backtests}</strong><small>this month</small></section><section><span>SAVED STRATEGIES</span><strong>{strategies.length}/{account.usage.limits.savedStrategies}</strong><small>current workspace</small></section></div><div className="saas-card"><div className="saas-card-title"><BookOpen size={14} /><h2>Strategy version history</h2></div>{strategies.length ? <div className="strategy-lines">{strategies.map((strategy) => <div key={String(strategy.id)}><strong>{String(strategy.name)}</strong><span>{String(strategy.strategy_type).replaceAll("_", " ")} · {String(strategy.version_count)} versions</span></div>)}</div> : <p className="empty-copy">Save a strategy from the workspace to start its version history.</p>}</div><div className="billing-card"><div><p>UPGRADE PATH</p><h2>Pro unlocks deeper research</h2><span>More backtests, reports, versions, comparisons, Pine exports, and transcript extraction.</span></div><button disabled>Billing provider connection pending</button></div></div>;
}








