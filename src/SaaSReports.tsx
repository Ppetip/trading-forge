import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BarChart3, Beaker, Copy, Database, FileText, History, LoaderCircle, Lock, RefreshCw, Send, Share2, Sparkles } from "lucide-react";
import { saasApi } from "./saas-api";
import { PaywallModal, paywallFromError, type PaywallInfo } from "./PaywallModal";
import type { StrategyRules } from "./types";

type Trade = { id: number; date: string; time: string; direction: string; entry: number; stop: number; target: number; resultR: number; status: string; rangeHigh?: number; rangeLow?: number; rangeStart?: string; rangeEnd?: string; entryTime?: string; entryPrice?: number; exitTime?: string; exitPrice?: number; exitReason?: string; grossR?: number; feeR?: number; netR?: number; ambiguous?: boolean };
type AIReview = { model: string; mode: string; headline: string; summary: string; findings: string[]; experiments: string[]; risks: string[]; answer: string };
type BacktestAudit = { engineVersion: string; strategyHash: string; cacheKey: string; provider?: string | null; requestedSymbol?: string | null; providerSymbol?: string | null; assetClass?: string | null; timeframe: string; timezone: string; firstBar?: string | null; lastBar?: string | null; barCount: number; missingBars: number; duplicateBars: number; providerMetadataAvailable: boolean; sessionTime?: string; openingRangeMinutes?: number; intrabarConflictMode?: string; fees?: boolean; slippage?: boolean; tradeCount: number; wins: number; losses: number; ambiguousTrades: number; grossR: number; feeR: number; netR: number; verification?: { status: "verified_evidence" | "unverified_legacy_report" | "failed_backtest_run"; label: string; criticalErrors: string[] } };
type Report = {
  id: string; cacheKey: string; engineVersion: string; dataProvenance?: { provider?: string; grade?: string; requestedSymbol?: string; resolvedSymbol?: string; interval?: string; start?: string; end?: string; proxy?: boolean; dataset?: string; adjusted?: boolean; continuous?: boolean; cacheHit?: boolean; providerCalls?: number; costScore?: string }; visibility: "private" | "public"; createdAt: string; rules: StrategyRules;
  result: { trades: Trade[]; totalR: number; averageR: number; winRate: number; wins: number; losses: number; ambiguousTrades?: number; profitFactor: number | null; maxDrawdown: number; longestLosingStreak: number; equity: number[]; drawdown: number[]; monthly: Array<{ month: string; value: number }>; bestMonth: { month: string; value: number } | null; worstMonth: { month: string; value: number } | null; audit?: BacktestAudit };
};

const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const tone = (value: number) => value > 0 ? "positive" : value < 0 ? "negative" : "neutral";

function InteractiveChart({ values, trades, red = false, label }: { values: number[]; trades: Trade[]; red?: boolean; label: string }) {
  const [selected, setSelected] = useState<number | null>(null);
  const width = 800, height = 190, safe = values.length ? values : [0], min = Math.min(...safe), max = Math.max(...safe), range = max - min || 1;
  const point = (value: number, index: number) => ({ x: index / Math.max(1, safe.length - 1) * width, y: height - (value - min) / range * 150 - 22 });
  const points = safe.map((value, index) => { const p = point(value, index); return `${p.x},${p.y}`; }).join(" ");
  const activeIndex = selected ?? safe.length - 1, active = point(safe[activeIndex], activeIndex);
  const trade = activeIndex > 0 ? trades[Math.min(trades.length - 1, activeIndex - 1)] : undefined;
  const activeLabel = trade ? `${trade.date} ${trade.time}` : "Start of test";
  function selectAt(clientX: number, rect: DOMRect) { setSelected(Math.max(0, Math.min(safe.length - 1, Math.round((clientX - rect.left) / Math.max(1, rect.width) * (safe.length - 1))))); }
  return <div className="interactive-chart" onMouseLeave={() => setSelected(null)} onWheel={(event) => { event.preventDefault(); setSelected(Math.max(0, Math.min(safe.length - 1, activeIndex + (event.deltaY > 0 || event.deltaX > 0 ? 1 : -1)))); }}>
    <div className="chart-readout"><span>{activeLabel}</span><strong className={red || safe[activeIndex] < 0 ? "negative" : "positive"}>{formatR(safe[activeIndex])}</strong></div>
    <svg className="saas-report-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label={`${label}, selected ${activeLabel}: ${formatR(safe[activeIndex])}`} onMouseMove={(event) => selectAt(event.clientX, event.currentTarget.getBoundingClientRect())} onClick={(event) => selectAt(event.clientX, event.currentTarget.getBoundingClientRect())}>
      <line x1="0" y1={point(0, 0).y} x2={width} y2={point(0, 0).y} className="chart-zero" />
      {[max, (max + min) / 2, min].map((tick, tickIndex) => <g key={`${tickIndex}-${tick}`}><line x1="0" y1={point(tick, 0).y} x2={width} y2={point(tick, 0).y} className="chart-grid" /><text x="8" y={Math.max(12, point(tick, 0).y - 4)} className="chart-tick">{tick.toFixed(1)}R</text></g>)}
      <polyline points={points} fill="none" stroke={red ? "#e07171" : "#55d6a7"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
      <line x1={active.x} y1="10" x2={active.x} y2={height - 20} className="chart-cursor" />
      <circle cx={active.x} cy={active.y} r="5" className={red ? "chart-dot red" : "chart-dot"} vectorEffect="non-scaling-stroke" />
    </svg>
    <div className="chart-axis"><span>{trades[0]?.date ?? "Start"}</span><span>{min.toFixed(1)}R to {max.toFixed(1)}R</span><span>{trades.at(-1)?.date ?? "End"}</span></div>
    <small className="chart-help">Move the mouse across the chart or use the mouse wheel to inspect each trade.</small>
  </div>;
}

function MonthlyChart({ months }: { months: Report["result"]["monthly"] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const active = selected === null ? null : months[selected];
  return <>
    <div className="month-readout" aria-live="polite"><span>{active ? active.month : "Hover over a month"}</span><strong className={active ? tone(active.value) : "neutral"}>{active ? formatR(active.value) : "—"}</strong></div>
    <article>{months.map((month, index) => <button type="button" className="month-column" key={month.month} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onMouseLeave={() => setSelected(null)} onBlur={() => setSelected(null)} aria-label={`${month.month}: ${formatR(month.value)}`}><i className={month.value >= 0 ? "up" : "down"} style={{ height: `${Math.min(100, 12 + Math.abs(month.value) * 6)}%` }} /><b>{month.month.slice(5)}</b></button>)}</article>
  </>;
}
function testedRules(report: Report) {
  const common = { ...report.rules, strategy_type: report.rules.strategyType, same_bar_policy: "stop_first", engine_version: report.engineVersion };
  if (report.rules.strategyType === "opening_range_breakout") return { ...common, entry_rule: "close_confirmed_opening_range_break", stop_rule: "opposite_side_of_opening_range" };
  if (report.rules.strategyType === "previous_day_breakout") return { ...common, reference: "previous_trading_date_high_low", entry_rule: "trade_through_previous_day_high_or_low", stop_rule: "opposite_previous_day_level" };
  if (report.rules.strategyType === "previous_day_sweep") return { ...common, reference: "previous_trading_date_high_low", entry_rule: "pierce_level_then_close_back_inside", stop_rule: "signal_candle_extreme" };
  return common;
}

export default function SaaSReports({ reportId, publicView = false }: { reportId?: string; publicView?: boolean }) {
  const [reports, setReports] = useState<Report[]>([]), [report, setReport] = useState<Report | null>(null);
  const [view, setView] = useState<"results" | "history">("results"), [error, setError] = useState(""), [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (!publicView) saasApi.account().then(({ account }) => setIsAdmin(account.role === "admin")).catch(() => setIsAdmin(false));
    const load = reportId
      ? (publicView ? saasApi.publicReport(reportId) : saasApi.report(reportId)).then(({ report: value }) => setReport(value as unknown as Report))
      : saasApi.reports().then(({ reports: values }) => { const next = values as unknown as Report[]; setReports(next); setReport(next[0] ?? null); });
    load.catch((caught) => setError((caught as Error).message)).finally(() => setLoading(false));
  }, [reportId, publicView]);
  if (loading) return <div className="plans-loading"><Beaker /> Loading reports…</div>;
  if (error) return <div className="plans-loading"><FileText /><span>{error}</span><a href="#/saas">Workspace</a></div>;
  return <div className="server-reports-page"><header><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><nav>{publicView && <span>SHARED RESEARCH REPORT</span>}<a href="#/saas">Workspace</a>{!publicView && <a href="#/plans">Plans & exports</a>}</nav></header>
    {!publicView && !reportId && <div className="report-tabs"><button className={view === "results" ? "active" : ""} onClick={() => setView("results")}><BarChart3 size={14} />Latest results</button><button className={view === "history" ? "active" : ""} onClick={() => setView("history")}><History size={14} />History <span>{reports.length}</span></button></div>}
    {view === "history" && !reportId ? <ReportList reports={reports} /> : report ? <ReportDetail report={report} publicView={publicView} onReport={setReport} showBack={Boolean(reportId) && !publicView} isAdmin={isAdmin} /> : <ReportList reports={reports} />}
  </div>;
}

function ReportList({ reports }: { reports: Report[] }) {
  const verified = reports.filter((report) => auditStatus(report) === "verified_evidence" && report.result.totalR > 0);
  const failed = reports.filter((report) => auditStatus(report) === "failed_backtest_run" || report.result.totalR <= 0);
  const legacy = reports.filter((report) => auditStatus(report) === "unverified_legacy_report" && report.result.totalR > 0);
  return <main className="server-reports-main"><div className="server-reports-title"><p>SERVER BACKTEST RUNS</p><h1>Saved backtest reports</h1><span>Verified reports must pass provider metadata, symbol, timezone, bar-quality, engine-version, and validation checks.</span></div>{reports.length ? <div className="report-groups"><ReportGroup title="Verified profitable reports" reports={verified} /><ReportGroup title="Failed reports" reports={failed} /><ReportGroup title="Unverified legacy reports" reports={legacy} /></div> : <div className="saas-empty"><BarChart3 /><h2>No reports yet</h2><p>Run a server backtest to create one.</p></div>}</main>;
}

function auditStatus(report: Report) {
  return report.result.audit?.verification?.status ?? "unverified_legacy_report";
}

function auditLabel(report: Report) {
  return report.result.audit?.verification?.label ?? "Unverified Legacy Report";
}

function ReportGroup({ title, reports }: { title: string; reports: Report[] }) {
  return <section className="report-group"><h2>{title}<span>{reports.length}</span></h2>{reports.length ? <div className="server-report-list">{reports.map((report) => <a href={`#/saas-reports/${encodeURIComponent(report.id)}`} key={report.id}><div><strong>{report.rules.name}</strong><span>{new Date(report.createdAt).toLocaleString()} · {report.rules.symbol} · {report.rules.timeframe} · {auditLabel(report)}</span></div><div><b className={tone(report.result.totalR)}>{formatR(report.result.totalR)}</b><span>{report.result.trades.length} trades · {report.visibility}</span></div><ArrowRight size={14} /></a>)}</div> : <p className="report-group-empty">None yet.</p>}</section>;
}

function reportVerdict(result: Report["result"]) {
  if (result.trades.length < 30) return { label: "NEEDS MORE DATA", tone: "warning" };
  if (result.totalR <= 0 || (result.profitFactor !== null && result.profitFactor < 1)) return { label: "FAILED", tone: "negative" };
  if (result.profitFactor !== null && result.profitFactor < 1.2) return { label: "WEAK", tone: "warning" };
  return { label: "PASS", tone: "positive" };
}
function ReportDetail({ report, publicView, onReport, showBack = false, isAdmin = false }: { report: Report; publicView: boolean; onReport: (report: Report) => void; showBack?: boolean; isAdmin?: boolean }) {
  const [shareMessage, setShareMessage] = useState("");
  const [aiReview, setAiReview] = useState<AIReview | null>(null), [aiBusy, setAiBusy] = useState(false), [aiError, setAiError] = useState(""), [question, setQuestion] = useState("");
  const [paywall, setPaywall] = useState<PaywallInfo | null>(null);
  const result = report.result, rules = testedRules(report), verdict = reportVerdict(result), provenance = report.dataProvenance, audit = report.result.audit;
  const stats = useMemo(() => [
    { label: "Total R", value: formatR(result.totalR), className: tone(result.totalR) },
    { label: "Win rate", value: `${result.winRate.toFixed(1)}%`, className: "neutral" },
    { label: "Trades", value: String(result.trades.length), className: "neutral" },
    { label: "Average R", value: formatR(result.averageR), className: tone(result.averageR) },
    { label: "Profit factor", value: result.profitFactor === null ? "∞" : result.profitFactor.toFixed(2), className: result.profitFactor !== null && result.profitFactor < 1 ? "negative" : "positive" },
    { label: "Max drawdown", value: `-${result.maxDrawdown.toFixed(2)}R`, className: "negative" }
  ], [result]);
  async function changeVisibility() { const next = report.visibility === "private" ? "public" : "private"; try { const { report: updated } = await saasApi.setReportVisibility(report.id, next); onReport(updated as unknown as Report); setShareMessage(next === "public" ? "Public link enabled." : "Public link disabled."); } catch (caught) { setShareMessage((caught as Error).message); } }
  async function copyLink() { const link = `${window.location.origin}${window.location.pathname}#/shared-reports/${encodeURIComponent(report.id)}`; try { await navigator.clipboard.writeText(link); setShareMessage("Public link copied."); } catch { setShareMessage(link); } }
  async function runAI(mode: "review" | "plan", prompt = "") {
    setAiBusy(true); setAiError("");
    try { const { review } = await saasApi.reviewReport(report.id, { mode, question: prompt }); setAiReview(review); }
    catch (caught) {
      const nextPaywall = paywallFromError(caught);
      if (nextPaywall) setPaywall(nextPaywall);
      else setAiError((caught as Error).message);
    }
    finally { setAiBusy(false); }
  }
  function iterateStrategy() {
    window.localStorage.setItem("edgelab.iterateRules", JSON.stringify(report.rules));
    window.localStorage.setItem("edgelab.iteratePrompt", `Iterate on the tested strategy "${report.rules.name}". Preserve the baseline rules, then describe one measurable change to test against report ${report.id}.`);
    window.location.hash = "#/saas";
  }
  return <main className="server-reports-main">
    {paywall && <PaywallModal info={paywall} onClose={() => setPaywall(null)} />}
    {showBack && <a className="report-back" href="#/saas-reports"><ArrowLeft size={13} /> Latest report</a>}
    <div className="server-detail-title"><div><p>SERVER BACKTEST RUN · {report.visibility.toUpperCase()}</p><h1>{report.rules.name}</h1><span>{new Date(report.createdAt).toLocaleString()} · cache {report.cacheKey.slice(0, 12)}</span></div><div><Database size={15} /><span>{auditLabel(report)}<br /><small>{report.engineVersion}</small></span></div></div>
    {!publicView && <div className="report-sharing"><div><Share2 size={14} /><span><strong>Report sharing</strong>{report.visibility === "public" ? "Anyone with the public link can view this frozen report." : "Only your account can access this report."}</span></div><div>{report.visibility === "public" && <button onClick={copyLink}><Copy size={12} />Copy link</button>}<button onClick={changeVisibility}>{report.visibility === "private" ? <Share2 size={12} /> : <Lock size={12} />}{report.visibility === "private" ? "Make public" : "Make private"}</button></div>{shareMessage && <small>{shareMessage}</small>}</div>}
    {publicView && <div className="public-report-note"><Share2 size={13} />This is a shared historical backtest report. It is not a live signal or financial advice.</div>}
    {!publicView && <section className="report-ai"><div className="report-ai-head"><div><Sparkles size={16} /><span><strong>AI research desk</strong><small>Grounded in this frozen report only</small></span></div><div><button onClick={() => runAI("review")} disabled={aiBusy}><Sparkles size={12} />AI review</button><button onClick={() => runAI("plan")} disabled={aiBusy}><BarChart3 size={12} />Game plan</button><button className="iterate" onClick={iterateStrategy}><RefreshCw size={12} />Iterate strategy</button></div></div><form onSubmit={(event) => { event.preventDefault(); if (question.trim()) runAI("review", question.trim()); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about drawdown, weak periods, risk, or the next controlled test…" /><button disabled={aiBusy || !question.trim()}>{aiBusy ? <LoaderCircle className="spin" size={13} /> : <Send size={13} />}Ask AI</button></form>{aiError && <div className="report-ai-error">{aiError}</div>}{aiBusy && <div className="report-ai-loading"><LoaderCircle className="spin" />Reviewing frozen rules and metrics…</div>}{aiReview && !aiBusy && <div className="report-ai-output"><div><p>{aiReview.mode === "plan" ? "CONTROLLED GAME PLAN" : "GROUNDED AI REVIEW"} · {aiReview.model}</p><h2>{aiReview.headline}</h2><span>{aiReview.summary}</span>{aiReview.answer && <blockquote>{aiReview.answer}</blockquote>}</div><section><h3>Evidence</h3>{aiReview.findings.map((item) => <p key={item}>{item}</p>)}</section><section><h3>Next experiments</h3>{aiReview.experiments.map((item, index) => <p key={item}><b>{index + 1}</b>{item}</p>)}</section><section className="risks"><h3>Guardrails</h3>{aiReview.risks.map((item) => <p key={item}>{item}</p>)}</section></div>}</section>}    {result.trades.length < 30 && <div className="report-warning"><strong>Small sample warning.</strong> This report contains fewer than 30 trades. Treat conclusions as weak.</div>}
    <section className="report-trust"><div><span>AUDIT STATUS</span><strong className={auditStatus(report) === "verified_evidence" ? "positive" : auditStatus(report) === "failed_backtest_run" ? "negative" : "warning"}>{auditLabel(report)}</strong><small>{audit?.verification?.criticalErrors?.length ? audit.verification.criticalErrors.join(", ") : "All required gates passed"}</small></div><div><span>VERDICT</span><strong className={verdict.tone}>{verdict.label}</strong></div><div><span>DATA SOURCE</span><strong>{provenance?.grade ?? "Legacy report"}</strong><small>{audit?.provider ?? provenance?.provider ?? "Provider metadata unavailable"}</small></div><div><span>SYMBOL TESTED</span><strong>{audit?.providerSymbol ?? provenance?.resolvedSymbol ?? report.rules.symbol}</strong><small>{provenance?.proxy ? `Proxy for ${provenance.requestedSymbol}` : `Requested ${audit?.requestedSymbol ?? provenance?.requestedSymbol ?? report.rules.symbol}`}</small></div><div><span>TIMEZONE</span><strong>{audit?.timezone ?? report.rules.timezone ?? "Unknown"}</strong><small>{audit?.firstBar && audit?.lastBar ? `${audit.firstBar} → ${audit.lastBar}` : "Bar window unavailable"}</small></div><div><span>ENGINE</span><strong>{audit?.engineVersion ?? report.engineVersion}</strong><small>Immutable calculation version</small></div></section>
    {isAdmin && <section className="report-audit"><div><span>providerSymbol</span><strong>{audit?.providerSymbol ?? provenance?.resolvedSymbol ?? "missing"}</strong></div><div><span>provider</span><strong>{audit?.provider ?? provenance?.provider ?? "missing"}</strong></div><div><span>strategyHash</span><code>{audit?.strategyHash ?? "legacy-missing"}</code></div><div><span>cacheKey</span><code>{audit?.cacheKey ?? report.cacheKey}</code></div><div><span>bars</span><strong>{audit ? `${audit.barCount} bars · ${audit.missingBars} missing · ${audit.duplicateBars} duplicate` : "legacy-missing"}</strong></div><div><span>conflicts</span><strong>{audit ? `${audit.ambiguousTrades} ambiguous · ${audit.intrabarConflictMode}` : "legacy-missing"}</strong></div></section>}
    <div className="server-detail-stats">{stats.map((stat) => <div key={stat.label}><span>{stat.label}</span><strong className={stat.className}>{stat.value}</strong></div>)}</div>
    <div className="server-detail-grid"><section className="chart-panel"><div><h2>Equity curve</h2><span>Cumulative return in R</span></div><InteractiveChart values={result.equity} trades={result.trades} label="Equity curve" /></section><section className="chart-panel"><div><h2>Drawdown</h2><span>Peak-to-trough decline in R</span></div><InteractiveChart values={result.drawdown} trades={result.trades} red label="Drawdown" /></section><section className="rules"><div><h2>Exact tested rules</h2><span>Immutable snapshot</span></div><pre>{JSON.stringify(rules, null, 2)}</pre></section><section className="months"><div><h2>Monthly performance</h2><span>{result.bestMonth ? `Best ${result.bestMonth.month} · ${formatR(result.bestMonth.value)}` : "No month data"}</span></div><MonthlyChart months={result.monthly} /><small>Green months gained R; red months lost R.</small></section></div>
    {isAdmin && <TradeTape trades={result.trades} />}
    <section className="server-trades"><div><h2>Trade log</h2><span>{result.wins} wins · {result.losses} losses · longest losing streak {result.longestLosingStreak}</span></div><div><table><thead><tr><th>Date / time</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr></thead><tbody>{result.trades.map((trade) => <tr key={trade.id}><td>{trade.date} <small>{trade.time}</small></td><td>{trade.direction}</td><td>{trade.entry.toFixed(2)}</td><td>{trade.stop.toFixed(2)}</td><td>{trade.target.toFixed(2)}</td><td className={tone(trade.resultR)}>{formatR(trade.resultR)}</td></tr>)}</tbody></table></div></section>
    <div className="report-disclaimer">Backtest results are historical simulations, not financial advice or a promise of live performance.</div>
  </main>;
}

function TradeTape({ trades }: { trades: Trade[] }) {
  const tape = trades.length <= 40 ? trades : [...trades.slice(0, 20), ...trades.slice(-20)];
  return <section className="trade-tape"><div><h2>Trade tape debug view</h2><span>First 20 and last 20 trades with execution fields used by the audit.</span></div><div><table><thead><tr><th>Date</th><th>Range</th><th>Entry</th><th>Stop / target</th><th>Exit</th><th>Reason</th><th>Gross</th><th>Fees</th><th>Net</th></tr></thead><tbody>{tape.map((trade, index) => <tr key={`${trade.id}-${index}`}><td>{trade.date}<small>{trade.rangeStart?.slice(11, 16) ?? "?"}→{trade.rangeEnd?.slice(11, 16) ?? "?"}</small></td><td>{fmt(trade.rangeLow)}–{fmt(trade.rangeHigh)}</td><td>{trade.direction}<small>{trade.entryTime ?? `${trade.date} ${trade.time}`}</small><b>{fmt(trade.entryPrice ?? trade.entry)}</b></td><td>{fmt(trade.stop)} / {fmt(trade.target)}</td><td>{trade.exitTime ?? "?"}<small>{fmt(trade.exitPrice)}</small></td><td>{trade.exitReason ?? trade.status}{trade.ambiguous ? " · ambiguous" : ""}</td><td className={tone(trade.grossR ?? trade.resultR)}>{formatR(trade.grossR ?? trade.resultR)}</td><td className="negative">{formatR(trade.feeR ?? 0)}</td><td className={tone(trade.netR ?? trade.resultR)}>{formatR(trade.netR ?? trade.resultR)}</td></tr>)}</tbody></table></div></section>;
}

function fmt(value?: number) {
  return Number.isFinite(value) ? Number(value).toFixed(2) : "—";
}



