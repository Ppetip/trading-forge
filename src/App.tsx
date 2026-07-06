import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3, Beaker, BookOpen, Check, Code2, Download, FlaskConical, LayoutDashboard,
  Play, Save, Settings, Star, Trash2, Upload, X,
} from "lucide-react";
import { parseCandleCsv, runDemoBacktest, runOrbBacktest } from "./backtest";
import { downloadText, generatePineScript } from "./pine";
import { storage } from "./storage";
import type { BacktestResult, Candle, SavedStrategy, StrategyRules, UserPreferences } from "./types";

type Page = "Workspace" | "Dashboard" | "Strategies" | "Comparison" | "Preferences";
const DEFAULT_RULES: StrategyRules = {
  name: "NQ 8:00 Opening Range", strategyType: "opening_range_breakout", market: "Futures",
  symbol: "NQ", timeframe: "5m", dateRange: "3y", sessionTime: "08:00",
  timezone: "America/New_York", openingRangeMinutes: 15, entryRule: "break_above_or_below_range",
  stopRule: "opposite_side_of_range", rewardRisk: 3, direction: "long_and_short",
  maxTradesPerDay: 1, fees: true, slippage: true,
};
const DEFAULT_PREFERENCES: UserPreferences = {
  market: "Futures", symbol: "NQ", timeframe: "5m", dateRange: "3y", rewardRisk: 3,
  timezone: "America/New_York", fees: true, slippage: true, chartStyle: "area", theme: "dark",
};
const STRATEGY_LABELS = {
  opening_range_breakout: "Opening range breakout",
  previous_day_breakout: "Previous day high/low breakout",
  previous_day_sweep: "Previous day sweep & reversal",
  moving_average_crossover: "Moving average crossover",
  moving_average_pullback: "Moving average pullback",
  rsi_reversal: "RSI reversal",
  support_resistance_breakout: "Support / resistance breakout",
};

function formatR(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
}

function MiniChart({ values, tone = "green" }: { values: number[]; tone?: "green" | "red" }) {
  const width = 800, height = 180, min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * width},${height - (value - min) / range * 160 - 10}`).join(" ");
  return <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
    <polyline points={points} fill="none" stroke={tone === "green" ? "#55d6a7" : "#e07171"} strokeWidth="2" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function StatGrid({ result }: { result: BacktestResult }) {
  const stats = [
    ["Total R", formatR(result.totalR)], ["Win rate", `${result.winRate.toFixed(1)}%`],
    ["Trades", String(result.trades.length)], ["Average R", formatR(result.averageR)],
    ["Profit factor", Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "âˆž"],
    ["Max drawdown", `-${result.maxDrawdown.toFixed(2)}R`],
  ];
  return <div className="stats">{stats.map(([label, value]) => <div className="stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}

function Results({ result, onExport }: { result: BacktestResult; onExport: () => void }) {
  const [capital, setCapital] = useState(10000);
  const [riskPercent, setRiskPercent] = useState(1);
  const riskDollars = capital * riskPercent / 100;
  const modeledReturn = riskDollars * result.totalR;
  const modeledDrawdown = riskDollars * result.maxDrawdown;
  return <section className="results">
    <div className="page-heading compact">
      <div><p className="eyebrow">RESULTS · {result.dataSource === "demo" ? "DEMO DATA" : "UPLOADED CANDLES"}</p><h2>{result.rules.name}</h2></div>
      <button className="button secondary" onClick={onExport}><Code2 size={15} /> Export Pine</button>
    </div>
    {result.dataSource === "demo" && <div className="warning"><strong>Illustrative results</strong> Demo candles are deterministic, not historical market data. Upload OHLC CSV data for a market-data backtest.</div>}
    <div className="capital-calculator"><div><span>ACCOUNT MODEL</span><strong>Translate R into dollars</strong><small>Simple fixed-risk math, not a forecast.</small></div><label>Starting capital<input type="number" min="100" step="100" value={capital} onChange={(event) => setCapital(Math.max(0, Number(event.target.value)))} /></label><label>Risk per trade<input type="number" min="0.1" max="10" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Math.max(0, Number(event.target.value)))} /><em>%</em></label><div className="capital-output"><span>Modeled net</span><strong className={modeledReturn >= 0 ? "positive" : "negative"}>{modeledReturn.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</strong><small>Historical R × {riskDollars.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })} risk</small></div><div className="capital-output"><span>Modeled max drawdown</span><strong className="negative">-{modeledDrawdown.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 })}</strong><small>Excludes compounding and sizing limits</small></div></div>
    <StatGrid result={result} />
    <div className="metrics-strip">
      <span><b>{result.wins}</b> wins</span><span><b>{result.losses}</b> losses</span>
      <span><b>{result.longestLosingStreak}</b> longest losing streak</span>
      <span><b>{result.bestMonth ? formatR(result.bestMonth.value) : "â€”"}</b> best month</span>
      <span><b>{result.worstMonth ? formatR(result.worstMonth.value) : "â€”"}</b> worst month</span>
    </div>
    <div className="chart-grid">
      <div className="card chart-card"><div className="card-title"><h3>Equity curve</h3><span>Cumulative R</span></div><MiniChart values={result.equity} /></div>
      <div className="card chart-card"><div className="card-title"><h3>Drawdown</h3><span>Peak-to-trough R</span></div><MiniChart values={result.drawdown} tone="red" /></div>
    </div>
    <div className="card monthly"><div className="card-title"><h3>Monthly performance</h3><span>R by month</span></div>
      <div className="month-bars">{result.monthly.slice(-18).map((month) => <div className="month" key={month.month} title={`${month.month}: ${formatR(month.value)}`}>
        <span className={month.value >= 0 ? "up" : "down"} style={{ height: `${Math.min(100, 12 + Math.abs(month.value) * 5)}%` }} /><small>{month.month.slice(5)}</small>
      </div>)}</div>
    </div>
    <TradeTable result={result} />
  </section>;
}

function TradeTable({ result }: { result: BacktestResult }) {
  return <div className="card table-card"><div className="card-title"><h3>Trade log</h3><span>{result.trades.length} trades</span></div><div className="table-scroll"><table>
    <thead><tr><th>Date / time</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr></thead>
    <tbody>{result.trades.slice().reverse().map((trade) => <tr key={trade.id}><td>{trade.date} <small>{trade.time}</small></td><td>{trade.direction}</td><td>{trade.entry.toFixed(2)}</td><td>{trade.stop.toFixed(2)}</td><td>{trade.target.toFixed(2)}</td><td className={trade.resultR > 0 ? "positive" : "negative"}>{formatR(trade.resultR)}</td></tr>)}</tbody>
  </table></div></div>;
}

function App() {
  const preferences = storage.preferences(DEFAULT_PREFERENCES);
  const [rules, setRules] = useState<StrategyRules>({ ...DEFAULT_RULES, symbol: preferences.symbol, timeframe: preferences.timeframe, dateRange: preferences.dateRange, rewardRisk: preferences.rewardRisk, timezone: preferences.timezone, fees: preferences.fees, slippage: preferences.slippage });
  const [prefs, setPrefs] = useState(preferences);
  const [page, setPage] = useState<Page>("Workspace");
  const [result, setResult] = useState<BacktestResult | null>(storage.runs()[0] ?? null);
  const [runs, setRuns] = useState(storage.runs());
  const [strategies, setStrategies] = useState(storage.strategies());
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataLabel, setDataLabel] = useState("Demo dataset");
  const [notice, setNotice] = useState("");
  const [pineOpen, setPineOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4200); return () => window.clearTimeout(timer); }, [notice]);
  const ruleJson = useMemo(() => ({
    strategy_type: rules.strategyType, symbol: rules.symbol, timeframe: rules.timeframe, date_range: rules.dateRange,
    session_time: rules.sessionTime, opening_range_minutes: rules.openingRangeMinutes, entry_rule: rules.entryRule,
    stop_rule: rules.stopRule, take_profit: `${rules.rewardRisk}R`, direction: rules.direction,
    max_trades_per_day: rules.maxTradesPerDay, fees: rules.fees, slippage: rules.slippage,
  }), [rules]);

  function run() {
    if (rules.strategyType !== "opening_range_breakout") return setNotice("This template is available for rule design. ORB is the implemented MVP engine.");
    const next = candles.length ? runOrbBacktest(rules, candles) : runDemoBacktest(rules);
    setResult(next); setRuns([next, ...runs].slice(0, 50)); storage.saveRun(next); setPage("Dashboard");
    setNotice(next.trades.length ? "Backtest completed and saved." : "No qualifying trades were found for these rules.");
  }
  function saveStrategy() {
    const item: SavedStrategy = { id: `${rules.strategyType}-${rules.name.toLowerCase().replace(/\W+/g, "-")}`, savedAt: new Date().toISOString(), favorite: false, rules: { ...rules }, latestResult: result ?? undefined };
    storage.saveStrategy(item); setStrategies(storage.strategies()); setNotice("Strategy saved to the library.");
  }
  async function upload(file?: File) {
    if (!file) return;
    try { const parsed = parseCandleCsv(await file.text()); setCandles(parsed); setDataLabel(`${file.name} · ${parsed.length.toLocaleString()} candles`); setNotice("Candle data loaded. The next run will use uploaded OHLC data."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not read candle data."); }
  }
  function exportPine() { setPineOpen(true); }

  return <div className={`app-shell ${prefs.theme}`}>
    <aside className="sidebar">
      <div className="brand"><span><Beaker size={18} /></span>Edge<i>Lab</i></div>
      <p className="nav-label">RESEARCH</p>
      {([["Workspace", FlaskConical], ["Dashboard", LayoutDashboard], ["Strategies", BookOpen], ["Comparison", BarChart3]] as const).map(([label, Icon]) =>
        <button key={label} className={page === label ? "nav-item active" : "nav-item"} onClick={() => setPage(label)}><Icon size={17} />{label}</button>)}
      <p className="nav-label">ACCOUNT</p>
      <button className={page === "Preferences" ? "nav-item active" : "nav-item"} onClick={() => setPage("Preferences")}><Settings size={17} />Preferences</button>
      <div className="sidebar-foot"><span className={candles.length ? "status live" : "status"} />{dataLabel}</div>
    </aside>
    <main>
      <header className="topbar"><div><p className="eyebrow">{page.toUpperCase()}</p><h1>{page === "Workspace" ? rules.name : page}</h1></div>
        {page === "Workspace" && <div className="actions"><button className="button secondary" onClick={saveStrategy}><Save size={15} /> Save</button><button className="button primary" onClick={run}><Play size={14} fill="currentColor" /> Run backtest</button></div>}
      </header>
      {notice && <div className="notice"><Check size={14} />{notice}<button onClick={() => setNotice("")}><X size={14} /></button></div>}
      {page === "Workspace" && <div className="workspace-grid"><section className="content">
        <div className="card idea"><div className="section-title"><span>01</span><h2>Strategy idea</h2></div>
          <textarea aria-label="Strategy idea" defaultValue="Test three years of the 8 AM opening range breakout on NQ. Enter when price breaks the opening range high or low. Use a 1:3 risk reward ratio." />
          <p>Plain language is a drafting aid. The structured rules below are the source of truth.</p>
        </div>
        <div className="card rules"><div className="section-title"><span>02</span><h2>Exact rule preview</h2><em><Check size={12} /> Valid</em></div><pre>{JSON.stringify(ruleJson, null, 2)}</pre></div>
        <div className="card data-card"><div><Upload size={18} /><div><h3>Historical candle data</h3><p>CSV headers: timestamp, open, high, low, close. Timestamps must already match the selected session timezone.</p></div></div>
          <input ref={fileRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => upload(event.target.files?.[0])} />
          <button className="button secondary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Upload CSV</button>
        </div>
      </section><SettingsPanel rules={rules} setRules={setRules} /></div>}
      {page === "Dashboard" && <div className="page">{result ? <Results result={result} onExport={exportPine} /> : <Empty title="No backtests yet" copy="Run a strategy from the workspace to create a repeatable result." />}</div>}
      {page === "Strategies" && <div className="page"><PageHeading title="Strategy library" copy="Saved rules and their latest results." action={<button className="button primary" onClick={() => setPage("Workspace")}>New strategy</button>} />
        {strategies.length ? <div className="library-grid">{strategies.map((item) => <div className="card strategy-card" key={item.id}><div><span className="template">{STRATEGY_LABELS[item.rules.strategyType]}</span><button className="icon-button" onClick={() => { storage.removeStrategy(item.id); setStrategies(storage.strategies()); }}><Trash2 size={14} /></button></div><h3>{item.rules.name}</h3><p>{item.rules.symbol} · {item.rules.timeframe} · 1:{item.rules.rewardRisk} · {item.rules.openingRangeMinutes}m range</p>{item.latestResult && <strong>{formatR(item.latestResult.totalR)} <small>{item.latestResult.trades.length} trades</small></strong>}<button className="button secondary wide" onClick={() => { setRules(item.rules); setResult(item.latestResult ?? null); setPage("Workspace"); }}>Open strategy</button></div>)}</div> : <Empty title="No saved strategies" copy="Save a strategy from the workspace and it will appear here." />}
      </div>}
      {page === "Comparison" && <div className="page"><PageHeading title="Comparison lab" copy="Compare saved backtest runs without hiding risk." />
        {runs.length >= 2 ? <Comparison runs={runs.slice(0, 4)} /> : <Empty title="Run two versions to compare" copy="Change a setting, rerun the strategy, then compare the stored results here." />}</div>}
      {page === "Preferences" && <div className="page narrow"><PageHeading title="User preferences" copy="Defaults applied when a new strategy is created." /><Preferences preferences={prefs} setPreferences={setPrefs} onSave={() => { storage.savePreferences(prefs); setNotice("Preferences saved."); }} /></div>}
    </main>
    {pineOpen && <div className="modal-backdrop" onClick={() => setPineOpen(false)}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="page-heading compact"><div><p className="eyebrow">TRADINGVIEW EXPORT</p><h2>Pine Script</h2></div><button className="icon-button" onClick={() => setPineOpen(false)}><X /></button></div><div className="warning">Pine Script results may differ because of data source, session handling, slippage, fees, and TradingView execution rules.</div><pre>{generatePineScript(rules)}</pre><button className="button primary" onClick={() => downloadText(`${rules.name.replace(/\W+/g, "-").toLowerCase()}.pine`, generatePineScript(rules))}><Download size={14} /> Download .pine</button></div></div>}
  </div>;
}

function SettingsPanel({ rules, setRules }: { rules: StrategyRules; setRules: (rules: StrategyRules) => void }) {
  return <aside className="settings-panel"><div className="section-title"><Settings size={15} /><h2>Strategy settings</h2></div>
    <label>Name<input value={rules.name} onChange={(event) => setRules({ ...rules, name: event.target.value })} /></label>
    <label>Template<select value={rules.strategyType} onChange={(event) => setRules({ ...rules, strategyType: event.target.value as StrategyRules["strategyType"] })}>{Object.entries(STRATEGY_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
    <div className="field-row"><label>Symbol<input value={rules.symbol} onChange={(event) => setRules({ ...rules, symbol: event.target.value.toUpperCase() })} /></label><label>Timeframe<select value={rules.timeframe} onChange={(event) => setRules({ ...rules, timeframe: event.target.value as StrategyRules["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label></div>
    <label>Date range<select value={rules.dateRange} onChange={(event) => setRules({ ...rules, dateRange: event.target.value as StrategyRules["dateRange"] })}><option value="6m">6 months</option><option value="1y">1 year</option><option value="3y">3 years</option><option value="5y">5 years</option></select></label>
    <p className="field-group">SESSION</p><div className="field-row"><label>Start<input type="time" value={rules.sessionTime} onChange={(event) => setRules({ ...rules, sessionTime: event.target.value })} /></label><label>Range<select value={rules.openingRangeMinutes} onChange={(event) => setRules({ ...rules, openingRangeMinutes: Number(event.target.value) as StrategyRules["openingRangeMinutes"] })}><option value="5">5 min</option><option value="15">15 min</option><option value="30">30 min</option><option value="60">60 min</option></select></label></div>
    <label>Timezone<select value={rules.timezone} onChange={(event) => setRules({ ...rules, timezone: event.target.value })}><option>America/New_York</option><option>America/Chicago</option><option>UTC</option></select></label>
    <p className="field-group">RISK & EXECUTION</p><label>Reward / risk<div className="range-row"><input type="range" min="1" max="5" step=".5" value={rules.rewardRisk} onChange={(event) => setRules({ ...rules, rewardRisk: Number(event.target.value) })} /><strong>1:{rules.rewardRisk}</strong></div></label>
    <label>Direction<select value={rules.direction} onChange={(event) => setRules({ ...rules, direction: event.target.value as StrategyRules["direction"] })}><option value="long_and_short">Long & short</option><option value="long_only">Long only</option><option value="short_only">Short only</option></select></label>
    <Toggle label="Include fees" checked={rules.fees} onChange={(fees) => setRules({ ...rules, fees })} /><Toggle label="Include slippage" checked={rules.slippage} onChange={(slippage) => setRules({ ...rules, slippage })} />
    <div className="assumption"><strong>Conservative fill rule</strong><p>If stop and target occur in the same candle, the stop is counted first.</p></div>
  </aside>;
}

function Comparison({ runs }: { runs: BacktestResult[] }) {
  const rows = [["Total R", (r: BacktestResult) => formatR(r.totalR)], ["Average R", (r: BacktestResult) => formatR(r.averageR)], ["Win rate", (r: BacktestResult) => `${r.winRate.toFixed(1)}%`], ["Max drawdown", (r: BacktestResult) => `-${r.maxDrawdown.toFixed(2)}R`], ["Profit factor", (r: BacktestResult) => r.profitFactor.toFixed(2)], ["Trades", (r: BacktestResult) => String(r.trades.length)] ] as const;
  return <div className="card compare"><table><thead><tr><th>Metric</th>{runs.map((run) => <th key={run.id}>{run.rules.openingRangeMinutes}m ORB<br /><small>1:{run.rules.rewardRisk} · {run.rules.symbol}</small></th>)}</tr></thead><tbody>{rows.map(([label, render]) => <tr key={label}><td>{label}</td>{runs.map((run) => <td key={run.id}>{render(run)}</td>)}</tr>)}</tbody></table><p>Runs are presented without a â€œwinnerâ€ badge. Evaluate return, drawdown, sample size, and assumptions together.</p></div>;
}

function Preferences({ preferences, setPreferences, onSave }: { preferences: UserPreferences; setPreferences: (value: UserPreferences) => void; onSave: () => void }) {
  return <div className="card preference-form"><div className="field-row"><label>Default market<select value={preferences.market}><option>Futures</option></select></label><label>Default symbol<input value={preferences.symbol} onChange={(event) => setPreferences({ ...preferences, symbol: event.target.value.toUpperCase() })} /></label></div>
    <div className="field-row"><label>Default timeframe<select value={preferences.timeframe} onChange={(event) => setPreferences({ ...preferences, timeframe: event.target.value as UserPreferences["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label><label>Default date range<select value={preferences.dateRange} onChange={(event) => setPreferences({ ...preferences, dateRange: event.target.value as UserPreferences["dateRange"] })}><option value="6m">6 months</option><option value="1y">1 year</option><option value="3y">3 years</option><option value="5y">5 years</option></select></label></div>
    <div className="field-row"><label>Default reward / risk<input type="number" min="1" max="10" step=".5" value={preferences.rewardRisk} onChange={(event) => setPreferences({ ...preferences, rewardRisk: Number(event.target.value) })} /></label><label>Session timezone<select value={preferences.timezone} onChange={(event) => setPreferences({ ...preferences, timezone: event.target.value })}><option>America/New_York</option><option>America/Chicago</option><option>UTC</option></select></label></div>
    <div className="field-row"><label>Chart style<select value={preferences.chartStyle} onChange={(event) => setPreferences({ ...preferences, chartStyle: event.target.value as UserPreferences["chartStyle"] })}><option value="area">Area</option><option value="line">Line</option></select></label><label>Theme<select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value as UserPreferences["theme"] })}><option value="dark">Dark</option><option value="light">Light</option></select></label></div>
    <Toggle label="Include fees by default" checked={preferences.fees} onChange={(fees) => setPreferences({ ...preferences, fees })} /><Toggle label="Include slippage by default" checked={preferences.slippage} onChange={(slippage) => setPreferences({ ...preferences, slippage })} />
    <button className="button primary" onClick={onSave}><Save size={14} /> Save preferences</button>
  </div>;
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <div className="toggle-row"><span>{label}</span><button className={checked ? "toggle on" : "toggle"} onClick={() => onChange(!checked)} aria-pressed={checked}><span /></button></div>;
}
function PageHeading({ title, copy, action }: { title: string; copy: string; action?: React.ReactNode }) { return <div className="page-heading"><div><h2>{title}</h2><p>{copy}</p></div>{action}</div>; }
function Empty({ title, copy }: { title: string; copy: string }) { return <div className="empty"><FlaskConical /><h2>{title}</h2><p>{copy}</p></div>; }

export default App;


