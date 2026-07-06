import { useEffect, useState } from "react";
import {
  ArrowRight, BarChart3, Beaker, BookOpen, Check, CreditCard, FileText, Layers3,
  Server, Sparkles, UserRound
} from "lucide-react";
import RunArchive from "./RunArchive";
import SaaSPlans from "./SaaSPlans";
import SaaSReports from "./SaaSReports";
import SaaSSamples from "./SaaSSamples";
import SaaSWorkspace from "./SaaSWorkspace";
import StrategyLab from "./StrategyLab";
import TranscriptBuilder from "./TranscriptBuilder";

type Route = { page: "landing" | "workspace" | "strategies" | "plans" | "reports" | "sharedReport" | "samples" | "transcripts" | "lab" | "runs" | "run"; id?: string };
function readRoute(): Route {
  const hash = window.location.hash;
  if (hash === "#/app" || hash === "#/saas") return { page: "workspace" };
  if (hash === "#/strategies") return { page: "strategies" };
  if (hash === "#/account" || hash === "#/plans") return { page: "plans" };
  if (hash === "#/templates" || hash === "#/samples") return { page: "samples" };
  if (hash === "#/transcripts") return { page: "transcripts" };
  if (hash === "#/reports" || hash === "#/saas-reports") return { page: "reports" };
  if (hash.startsWith("#/reports/")) return { page: "reports", id: decodeURIComponent(hash.slice(10)) };
  if (hash.startsWith("#/saas-reports/")) return { page: "reports", id: decodeURIComponent(hash.slice(15)) };
  if (hash.startsWith("#/shared-reports/")) return { page: "sharedReport", id: decodeURIComponent(hash.slice(17)) };
  if (hash === "#/lab" || hash === "#/strategy-lab" || hash === "#/daily-level") return { page: "lab" };
  if (hash === "#/dev/runs" || hash === "#/runs") return { page: "runs" };
  if (hash.startsWith("#/dev/runs/")) return { page: "run", id: decodeURIComponent(hash.slice(11)) };
  if (hash.startsWith("#/runs/")) return { page: "run", id: decodeURIComponent(hash.slice(7)) };
  return { page: "landing" };
}

export default function Root() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const update = () => setRoute(readRoute());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  if (route.page === "landing") return <Landing />;

  const content = (() => {
    if (route.page === "plans") return <SaaSPlans />;
    if (route.page === "samples") return <SaaSSamples />;
    if (route.page === "transcripts") return <TranscriptBuilder />;
    if (route.page === "reports") return <SaaSReports reportId={route.id} />;
    if (route.page === "sharedReport") return <SaaSReports reportId={route.id} publicView />;
    if (route.page === "workspace") return <div className="saas-route"><SaaSWorkspace /><div className="saas-shortcuts"><a href="#/transcripts">Extract from Video/Notes</a><a href="#/templates">Strategy Packs</a><a href="#/account"><CreditCard size={13} />Pricing & account</a></div></div>;
    if (route.page === "strategies") return <SaaSWorkspace initialPage="strategies" />;
    if (route.page === "runs" || route.page === "run") return <RunArchive selectedId={route.id} />;
    if (route.page === "lab") return <StrategyLab />;
    return <Landing />;
  })();

  if (route.page === "workspace" || route.page === "strategies" || route.page === "sharedReport") return content;
  return <div className="route-shell with-sidebar"><GlobalSidebar route={route} /><div className="route-shell__content">{content}</div></div>;
}

function GlobalSidebar({ route }: { route: Route }) {
  const items = [
    { href: "#/app", label: "Test a Strategy", icon: Beaker, page: "workspace" as const },
    { href: "#/reports", label: "My Reports", icon: FileText, page: "reports" as const },
    { href: "#/strategies", label: "My Strategies", icon: BookOpen, page: "strategies" as const },
    { href: "#/templates", label: "Strategy Packs", icon: Sparkles, page: "samples" as const },
    { href: "#/transcripts", label: "Extract from Video/Notes", icon: Sparkles, page: "transcripts" as const },
    { href: "#/account", label: "Account & Pricing", icon: UserRound, page: "plans" as const }
  ];
  return <aside className="saas-sidebar global-sidebar"><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i><small>SAAS</small></a><p>RESEARCH</p>{items.map(({ href, label, icon: Icon, page }) => <a key={href} href={href} className={`saas-nav-link ${route.page === page ? "active" : ""}`}><Icon size={16} />{label}</a>)}<div className="global-sidebar-note"><strong>Research first</strong><span>Exact rules, real data, immutable reports.</span></div></aside>;
}
function Landing() {
  return <div className="landing">
    <nav className="landing-nav"><a className="landing-brand" href="#top"><span><Beaker size={18} /></span>Edge<i>Lab</i></a><div className="landing-nav-actions"><a href="#/templates">Strategy Packs</a><a className="landing-link" href="#/app">Test a Strategy <ArrowRight size={14} /></a></div></nav>
    <main className="landing-main" id="top">
      <section className="hero"><div className="hero-copy"><p className="landing-kicker">TRADING STRATEGY RESEARCH</p><h1>Turn trading ideas<br /><em>into evidence.</em></h1><p className="hero-lede">Paste a strategy from your notes, a video, or plain English. EdgeLab turns it into exact rules, tests it on historical data, and gives you a report you can save and improve.</p><div className="hero-actions"><a className="landing-primary" href="#/app">Test a Strategy <ArrowRight size={16} /></a><span>Research software. No profit promises.</span></div></div><div className="terminal-preview"><div className="terminal-top"><span /><span /><span /><b>ACCOUNT / ORB / NQ / 5m</b></div><div className="terminal-stats"><div><small>PLAN USAGE</small><strong>2 / 5</strong></div><div><small>REPORTS</small><strong>03</strong></div><div><small>VERSIONS</small><strong>04</strong></div></div><svg viewBox="0 0 600 190" preserveAspectRatio="none" aria-label="Illustrative equity curve"><polyline points="0,165 45,155 75,160 110,132 145,140 180,112 225,120 270,88 310,103 350,74 395,81 435,48 480,59 525,29 600,18" fill="none" stroke="#55d6a7" strokeWidth="2" /></svg><p>ILLUSTRATIVE INTERFACE · NOT PERFORMANCE DATA</p></div></section>
      <section className="principles"><article><Server /><h2>Server-calculated reports</h2><p>The backtest engine calculates results. AI may structure or explain rules but never invents performance.</p></article><article><Layers3 /><h2>Versioned research</h2><p>Follow-up ideas create new versions while the original rules and reports remain intact.</p></article><article><BarChart3 /><h2>Evidence without spin</h2><p>Weak results, drawdowns, losing streaks, and small-sample warnings remain visible.</p></article></section>
      <section className="workflow"><div><p className="landing-kicker">THE RESEARCH LOOP</p><h2>Idea â†’ Rules â†’ Test<br />â†’ Report â†’ Improve</h2></div><ol><li><span>01</span><div><strong>Describe the setup</strong><p>Prompt parsing extracts rules and names its assumptions.</p></div><Check /></li><li><span>02</span><div><strong>Audit the rules</strong><p>Every server input is visible before execution.</p></div><Check /></li><li><span>03</span><div><strong>Run or reuse</strong><p>Exact cache matches return the existing report immediately.</p></div><Check /></li><li><span>04</span><div><strong>Version and compare</strong><p>Improve the thesis without overwriting prior evidence.</p></div><Check /></li></ol></section>
      <footer><div><Beaker size={18} /><strong>EdgeLab</strong></div><p>Strategy research software. Not financial advice.</p><a href="#/app">Start free <ArrowRight size={14} /></a></footer>
    </main>
  </div>;
}

