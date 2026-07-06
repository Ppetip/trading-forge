import { ArrowLeft, BarChart3, Beaker, Code2, Database, Download, FlaskConical } from "lucide-react";
import { downloadText, generatePineScript } from "./pine";
import { generateStrategyPine } from "./pineStrategies";
import { storage } from "./storage";
import { DEFAULT_ENGINE_PARAMETERS } from "./strategyEngines";
import type { BacktestResult } from "./types";

const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
function Chart({ values, red = false }: { values: number[]; red?: boolean }) {
  const width = 800, height = 160, min = Math.min(...values), max = Math.max(...values), spread = max - min || 1;
  const points = values.map((value, index) => `${index / Math.max(1, values.length - 1) * width},${height - (value - min) / spread * 140 - 10}`).join(" ");
  return <svg className="archive-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"><polyline points={points} fill="none" stroke={red ? "#e07171" : "#55d6a7"} strokeWidth="2" vectorEffect="non-scaling-stroke" /></svg>;
}

export default function RunArchive({ selectedId }: { selectedId?: string }) {
  const runs = storage.runs();
  const selected = selectedId ? runs.find((run) => run.id === selectedId) : undefined;
  return <div className="archive-shell">
    <header className="archive-header"><a className="landing-brand" href="#/"><span><Beaker size={18} /></span>Edge<i>Lab</i></a><nav><a href="#/strategy-lab">Workspace</a><a className="active" href="#/runs">Run archive</a></nav></header>
    {selectedId ? <RunDetail result={selected} /> : <RunList runs={runs} />}
  </div>;
}

function RunList({ runs }: { runs: BacktestResult[] }) {
  return <main className="archive-main">
    <div className="archive-title"><div><p>STORED RESEARCH</p><h1>Backtest run archive</h1><span>Every result retains its inputs, assumptions, trades, and data source.</span></div><a className="archive-button primary" href="#/strategy-lab"><FlaskConical size={14} /> New backtest</a></div>
    {runs.length ? <div className="run-list">
      <div className="run-row header"><span>Strategy</span><span>Source</span><span>Configuration</span><span>Total R</span><span>Drawdown</span><span>Trades</span></div>
      {runs.map((run) => <a className="run-row" href={`#/runs/${encodeURIComponent(run.id)}`} key={run.id}>
        <span><strong>{run.rules.name}</strong><small>{new Date(run.createdAt).toLocaleString()}</small></span>
        <span className={`source ${run.dataSource}`}><Database size={12} />{run.dataSource === "uploaded" ? "Uploaded CSV" : "Demo"}</span>
        <span>{run.rules.symbol} · {run.rules.timeframe} · {run.rules.strategyType.replaceAll("_", " ")}</span>
        <span className={run.totalR >= 0 ? "positive" : "negative"}>{formatR(run.totalR)}</span><span>-{run.maxDrawdown.toFixed(2)}R</span><span>{run.trades.length}</span>
      </a>)}
    </div> : <div className="archive-empty"><BarChart3 /><h2>No stored runs</h2><p>Complete a backtest in the workspace. Runs are saved locally and will appear here.</p><a className="archive-button primary" href="#/strategy-lab">Open workspace</a></div>}
  </main>;
}

function RunDetail({ result }: { result?: BacktestResult }) {
  if (!result) return <main className="archive-main"><a className="back-link" href="#/runs"><ArrowLeft size={14} /> Run archive</a><div className="archive-empty"><h2>Run not found</h2><p>This run may have been removed from local storage.</p></div></main>;
  const isOrb = result.rules.strategyType === "opening_range_breakout";
  const frozenRules = {
    strategy_type: result.rules.strategyType, symbol: result.rules.symbol, timeframe: result.rules.timeframe,
    date_range: result.rules.dateRange, data_source: result.dataSourceLabel ?? result.dataSource,
    session_time: isOrb ? result.rules.sessionTime : undefined, timezone: result.rules.timezone,
    opening_range_minutes: isOrb ? result.rules.openingRangeMinutes : undefined,
    engine_parameters: isOrb ? undefined : result.engineParameters ?? DEFAULT_ENGINE_PARAMETERS,
    entry_rule: isOrb ? result.rules.entryRule : "strategy_specific_signal",
    stop_rule: isOrb ? result.rules.stopRule : "recent_structure",
    take_profit: `${result.rules.rewardRisk}R`, direction: result.rules.direction,
    max_trades_per_day: result.rules.maxTradesPerDay, fees: result.rules.fees, slippage: result.rules.slippage,
    same_bar_policy: "stop_first",
  };
  const stats = [["Total R", formatR(result.totalR)], ["Win rate", `${result.winRate.toFixed(1)}%`], ["Trades", `${result.trades.length}`], ["Average R", formatR(result.averageR)], ["Profit factor", Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "∞"], ["Max drawdown", `-${result.maxDrawdown.toFixed(2)}R`]];
  const exportPine = () => {
    const script = isOrb ? generatePineScript(result.rules) : generateStrategyPine(result.rules, result.engineParameters ?? DEFAULT_ENGINE_PARAMETERS);
    downloadText(`${result.rules.name.replace(/\W+/g, "-").toLowerCase()}.pine`, script);
  };
  return <main className="archive-main">
    <a className="back-link" href="#/runs"><ArrowLeft size={14} /> Run archive</a>
    <div className="archive-title detail"><div><p>SAVED BACKTEST DETAIL</p><h1>{result.rules.name}</h1><span>{new Date(result.createdAt).toLocaleString()} · {result.dataSource === "uploaded" ? "Uploaded candle data" : "Deterministic demo data"}</span></div><button className="archive-button" onClick={exportPine}><Code2 size={14} /> Export Pine <Download size={12} /></button></div>
    {result.dataSource === "demo" && <div className="archive-warning"><strong>Illustrative result.</strong> This run did not use historical market candles and must not be treated as performance evidence.</div>}
    <div className="archive-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <div className="archive-grid">
      <section className="archive-card wide"><div className="archive-card-title"><h2>Equity curve</h2><span>Cumulative R</span></div><Chart values={result.equity} /></section>
      <section className="archive-card rules-card"><div className="archive-card-title"><h2>Frozen rules</h2><span>Exact run configuration</span></div><pre>{JSON.stringify(frozenRules, (_key, value) => value === undefined ? undefined : value, 2)}</pre></section>
      <section className="archive-card"><div className="archive-card-title"><h2>Drawdown</h2><span>Peak-to-trough R</span></div><Chart values={result.drawdown} red /></section>
      <section className="archive-card monthly-card"><div className="archive-card-title"><h2>Monthly performance</h2><span>{result.bestMonth ? `Best ${formatR(result.bestMonth.value)}` : "No months"}</span></div><div>{result.monthly.map((month) => <span key={month.month} title={`${month.month}: ${formatR(month.value)}`} className={month.value >= 0 ? "up" : "down"} style={{ height: `${Math.min(100, 10 + Math.abs(month.value) * 5)}%` }} />)}</div></section>
    </div>
    <section className="archive-card trades-card"><div className="archive-card-title"><h2>All trades</h2><span>{result.wins} wins · {result.losses} losses · longest losing streak {result.longestLosingStreak}</span></div><div className="archive-table"><table><thead><tr><th>Date / time</th><th>Side</th><th>Entry</th><th>Stop</th><th>Target</th><th>Result</th></tr></thead><tbody>{result.trades.slice().reverse().map((trade) => <tr key={trade.id}><td>{trade.date} <small>{trade.time}</small></td><td>{trade.direction}</td><td>{trade.entry.toFixed(2)}</td><td>{trade.stop.toFixed(2)}</td><td>{trade.target.toFixed(2)}</td><td className={trade.resultR >= 0 ? "positive" : "negative"}>{formatR(trade.resultR)}</td></tr>)}</tbody></table></div></section>
  </main>;
}
