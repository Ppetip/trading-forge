import { useEffect, useState } from "react";
import { ArrowRight, BarChart3, Beaker, BookOpen, Check, Clock3, Copy, Sparkles } from "lucide-react";
import { saasApi } from "./saas-api";
import { SAMPLE_STRATEGIES, type SampleStrategy } from "./sample-strategies";
import { PaywallModal, type PaywallInfo } from "./PaywallModal";

type PublicReport = {
  id: string; createdAt: string;
  rules: { name?: string; symbol?: string; timeframe?: string; strategyType?: string; [key: string]: unknown };
  result: { totalR?: number; winRate?: number; trades?: unknown[]; maxDrawdown?: number; audit?: { verification?: { status?: string; label?: string } } };
};

const formatR = (value = 0) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
const reportFor = (strategy: SampleStrategy, reports: PublicReport[]) => reports.find((report) => String(report.rules.name ?? "").toLowerCase() === strategy.name.toLowerCase());
const auditStatus = (report: PublicReport) => report.result.audit?.verification?.status ?? "unverified_legacy_report";

function cloneSample(strategy: SampleStrategy, report?: PublicReport) {
  if (report) window.localStorage.setItem("edgelab.iterateRules", JSON.stringify(report.rules));
  window.localStorage.setItem("edgelab.iteratePrompt", report
    ? `Clone and test a controlled variation of ${strategy.name}. Preserve the published baseline first, then change one measurable rule at a time.`
    : `${strategy.name}: ${strategy.concept} Clarify every objective entry, exit, risk, market, and timeframe rule before testing.`);
  window.location.hash = "#/saas";
}

function Pack({ title, note, strategies, reports, openPaywall }: { title: string; note: string; strategies: SampleStrategy[]; reports: PublicReport[]; openPaywall: (info: PaywallInfo) => void }) {
  return <section className="sample-pack"><div className="sample-pack-title"><div><p>15 EDUCATIONAL TEMPLATES</p><h2>{title}</h2><span>{note}</span></div><b>{strategies.length}</b></div><div className="sample-grid">{strategies.map((strategy) => {
    const report = reportFor(strategy, reports);
    return <article className={report ? "sample-result-card" : ""} key={strategy.id}>
      <div><BookOpen size={13} /><span>{report ? report.result.audit?.verification?.label ?? "UNVERIFIED LEGACY REPORT" : strategy.engine === "available" ? "ORB ENGINE READY" : "ENGINE ROADMAP"}</span></div>
      <h3>{strategy.name}</h3><p>{strategy.concept}</p>
      {report && <div className="sample-evidence"><strong className={Number(report.result.totalR) < 0 ? "negative" : "positive"}>{formatR(Number(report.result.totalR))}</strong><span>{Number(report.result.winRate ?? 0).toFixed(1)}% win · {(report.result.trades ?? []).length} trades</span></div>}
      <footer>{report ? <><a href={`#/shared-reports/${encodeURIComponent(report.id)}`}><BarChart3 size={12} />View result</a><button onClick={() => cloneSample(strategy, report)}><Copy size={12} />Clone & tweak</button><button className="paid-action" onClick={() => openPaywall({ title: "AI strategy chat is paid", message: "Asking AI to review a published strategy or plan variations uses report-aware model calls, so it is reserved for paid workflows.", options: ["Upgrade to ask AI about reports", "Clone and tweak manually", "Open the shared report without AI"], primaryHref: "#/account", primaryLabel: "View plans" })}><Sparkles size={12} />Ask AI · paid</button></> : <><button onClick={() => cloneSample(strategy)}>{strategy.engine === "available" ? <Check size={12} /> : <Clock3 size={12} />}{strategy.engine === "available" ? "Open test draft" : "Clarify draft"}</button><span>{strategy.engine === "roadmap" ? "Needs a server engine before results" : "No saved result yet"}</span></>}</footer>
    </article>;
  })}</div></section>;
}

function PublishedResults({ reports, loading, authenticated }: { reports: PublicReport[]; loading: boolean; authenticated: boolean }) {
  const verified = reports.filter((report) => auditStatus(report) === "verified_evidence" && Number(report.result.totalR ?? 0) > 0);
  const failed = reports.filter((report) => auditStatus(report) === "failed_backtest_run" || Number(report.result.totalR ?? 0) <= 0);
  const legacy = reports.filter((report) => auditStatus(report) === "unverified_legacy_report" && Number(report.result.totalR ?? 0) > 0);
  const all = [...verified, ...failed, ...legacy];
  return <section className="published-results"><div className="sample-pack-title"><div><p>SERVER BACKTEST RUNS</p><h2>Published backtest results</h2><span>Frozen reports produced by executable engines. Only audit-passing profitable reports are verified evidence.</span></div><b>{reports.length}</b></div>{loading ? <div className="published-empty"><Beaker />Loading server backtest runs…</div> : all.length ? <div className="published-grid">{all.map((report) => <a href={`#/shared-reports/${encodeURIComponent(report.id)}`} key={report.id}><div><BarChart3 /><strong>{report.rules.name ?? "Untitled strategy"}</strong></div><span>{report.rules.symbol} · {report.rules.timeframe} · {(report.result.trades ?? []).length} trades · {report.result.audit?.verification?.label ?? "Unverified Legacy Report"}</span><footer><b className={Number(report.result.totalR) < 0 ? "negative" : "positive"}>{formatR(Number(report.result.totalR ?? 0))}</b><small>{Number(report.result.winRate ?? 0).toFixed(1)}% win rate</small><ArrowRight size={13} /></footer></a>)}</div> : <div className="published-empty"><BarChart3 /><strong>No community reports published yet.</strong><span>Sign in, run a backtest, then publish it from Reports. It will appear here automatically.</span><a href={authenticated ? "#/saas-reports" : "#/saas"}>{authenticated ? "Publish yours now" : "Create an account"} <ArrowRight size={12} /></a></div>}</section>;
}

export default function SaaSSamples() {
  const [reports, setReports] = useState<PublicReport[]>([]), [loading, setLoading] = useState(true), [authenticated, setAuthenticated] = useState(false);
  const [paywall, setPaywall] = useState<PaywallInfo | null>(null);
  useEffect(() => { saasApi.account().then(() => setAuthenticated(true)).catch(() => setAuthenticated(false)); saasApi.publicReports().then(({ reports }) => setReports(reports as unknown as PublicReport[])).catch(() => setReports([])).finally(() => setLoading(false)); }, []);
  const inspired = SAMPLE_STRATEGIES.filter((strategy) => strategy.pack === "famous-inspired");
  const common = SAMPLE_STRATEGIES.filter((strategy) => strategy.pack === "common");
  return <div className="samples-page"><header><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><nav><a href="#/saas">Workspace</a><a href="#/saas-reports">Reports</a><a href="#/plans">Plans</a></nav></header><main><div className="samples-hero"><p>STRATEGY LIBRARY</p><h1>Educational starting points.<br />Evidence still required.</h1><span>Open real server results where an engine exists. Clone any concept into the clarifier without pretending roadmap templates were tested.</span><a href="#/saas">Open strategy workspace <ArrowRight size={13} /></a></div><PublishedResults reports={reports} loading={loading} authenticated={authenticated} /><div className="sample-disclaimer"><strong>Required context:</strong> Famous-inspired samples are based on publicly known trading concepts. They are not official strategies or endorsements. Every sample is for testing and education and may perform poorly.</div><Pack title="Famous-inspired strategy pack" note="Inspired by publicly known concepts; never represented as an official strategy." strategies={inspired} reports={reports} openPaywall={setPaywall} /><Pack title="Common retail strategy pack" note="Common setups traders can define, challenge, and compare." strategies={common} reports={reports} openPaywall={setPaywall} /></main>{paywall && <PaywallModal info={paywall} onClose={() => setPaywall(null)} />}</div>;
}

