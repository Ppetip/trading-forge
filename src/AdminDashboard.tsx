import { useEffect, useState, type ReactNode } from "react";
import { Activity, Beaker, CircleDollarSign, Database, Gauge, ShieldCheck, Users } from "lucide-react";
import { opsApi, type AdminMetrics, type DataControls } from "./saas-ops-api";

type MetricRow = [string | number, string | number];
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const controlLabels: Record<keyof DataControls, string> = { disableDatabento: "Disable fresh Databento", cachedDatabentoOnly: "Cached Databento only", disableYahoo: "Disable research-grade provider", forceDailyCandles: "Force daily candles", forceProxyForFutures: "Force futures proxy mode", disableLongWindows: "Disable long-window tests" };

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null), [error, setError] = useState(""), [saving, setSaving] = useState("");
  const load = () => opsApi.adminMetrics().then(({ metrics }) => setMetrics(metrics)).catch((caught) => setError((caught as Error).message));
  useEffect(() => { void load(); }, []);
  async function toggle(key: keyof DataControls) { if (!metrics) return; setSaving(key); setError(""); try { await opsApi.updateDataControls({ [key]: !metrics.dataSpend.controls[key] }); await load(); } catch (caught) { setError((caught as Error).message); } finally { setSaving(""); } }
  if (error && !metrics) return <div className="plans-loading"><ShieldCheck /><span>{error}</span><a href="#/app">Workspace</a></div>;
  if (!metrics) return <div className="plans-loading"><Gauge />Loading operational metricsâ€¦</div>;
  const userStats: MetricRow[] = [["Total users", metrics.users.total], ["New signups Â· 30d", metrics.users.newSignups30d], ["Free", metrics.users.free], ["Trial", metrics.users.trial], ["Paid", metrics.users.paid], ["Conversion", percent(metrics.users.conversionRate)], ["Churn", percent(metrics.users.churnRate)]];
  const activities: MetricRow[] = [["Backtests", metrics.activity.backtests], ["Reports", metrics.activity.reports], ["Strategies saved", metrics.activity.strategiesSaved], ["Pine exports", metrics.activity.pineExports], ["Transcript uploads", metrics.activity.transcriptUploads], ["Failed tests", metrics.activity.failedTests]];
  const dataRows: MetricRow[] = [["Data requests", metrics.dataSpend.requests], ["Cache hits", metrics.dataSpend.cacheHits], ["Cache misses", metrics.dataSpend.cacheMisses], ["Provider fetches", metrics.dataSpend.providerFetches], ["Provider errors", metrics.dataSpend.providerErrors], ["Premium rows", metrics.dataSpend.premiumRows], ["Premium blocks", metrics.dataSpend.premiumBlocked], ["Proxy uses", metrics.dataSpend.proxyUses]];
  return <div className="admin-page"><header><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><span><ShieldCheck size={13} />ADMIN ONLY</span><a href="#/app">Workspace</a></header><main>
    <div className="admin-title"><p>DATA SPEND CONTROL</p><h1>Provider health, cost containment, and usage</h1><span>Generated {new Date(metrics.generatedAt).toLocaleString()}</span></div>
    {error && <p className="admin-error">{error}</p>}
    <section className="admin-stat-row">{userStats.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}</section>
    <div className="admin-grid"><MetricPanel icon={<Activity />} title="Product activity" rows={activities} /><MetricPanel icon={<Database />} title="Market-data activity" rows={dataRows} /><MetricPanel icon={<Users />} title="Most-used symbols" rows={metrics.popular.symbols.map((item) => [item.name || "unknown", item.total])} /><MetricPanel icon={<Gauge />} title="Provider traffic" rows={metrics.dataSpend.providers.map((item) => [item.name || "unknown", item.total])} />
      <section className="admin-controls"><div><ShieldCheck /><h2>Emergency controls</h2></div><p>Changes are server-enforced and audit logged. Disabling Databento also enables cache-only mode.</p>{(Object.keys(controlLabels) as Array<keyof DataControls>).map((key) => <label key={key}><span>{controlLabels[key]}</span><button type="button" aria-pressed={metrics.dataSpend.controls[key]} disabled={saving === key} className={metrics.dataSpend.controls[key] ? "on" : ""} onClick={() => toggle(key)}>{metrics.dataSpend.controls[key] ? "ON" : "OFF"}</button></label>)}</section>
      <section className="admin-cost"><div><CircleDollarSign /><h2>Tracked costs</h2></div><article><span>AI/API cost</span><strong>${metrics.costs.apiTotalUsd.toFixed(4)}</strong></article><article><span>Backtest compute cost</span><strong>${metrics.costs.computeTotalUsd.toFixed(4)}</strong></article><p>Costs remain $0 until providers report cost metadata. Values are never fabricated.</p></section>
    </div></main></div>;
}
function MetricPanel({ icon, title, rows }: { icon: ReactNode; title: string; rows: MetricRow[] }) { return <section className="admin-panel"><div>{icon}<h2>{title}</h2></div>{rows.length ? rows.map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>) : <p>No recorded activity.</p>}</section>; }