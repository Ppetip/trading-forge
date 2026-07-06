import { useEffect, useState } from "react";
import { ArrowRight, Beaker, Database, Play, Upload } from "lucide-react";
import { parseCandleCsv } from "./backtest";
import { runDailyLevel } from "./daily-level-api";
import { saasApi } from "./saas-api";
import type { Candle, StrategyRules, StrategyType } from "./types";

const initialRules: StrategyRules = {
  name: "NQ Previous Day Breakout", strategyType: "previous_day_breakout", market: "Futures",
  symbol: "NQ", timeframe: "5m", dateRange: "3y", sessionTime: "08:00",
  timezone: "America/New_York", openingRangeMinutes: 15, entryRule: "break_above_or_below_range",
  stopRule: "opposite_side_of_range", rewardRisk: 2, direction: "long_and_short",
  maxTradesPerDay: 1, fees: true, slippage: true
};

type Report = Awaited<ReturnType<typeof runDailyLevel>>["report"];
const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;

export default function DailyLevelWorkspace() {
  const [rules, setRules] = useState(initialRules);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [dataLabel, setDataLabel] = useState("No dataset selected");
  const [report, setReport] = useState<Report | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(true);
  useEffect(() => {
    saasApi.account().catch((caught) => setError((caught as Error).message)).finally(() => setBusy(false));
  }, []);
  async function upload(file?: File) {
    if (!file) return;
    setError("");
    try {
      const parsed = parseCandleCsv(await file.text());
      const days = new Set(parsed.map((candle) => candle.timestamp.slice(0, 10))).size;
      if (days < 2) throw new Error("Daily-level tests require candles from at least two trading dates.");
      setCandles(parsed);
      setDataLabel(`${file.name} · ${parsed.length.toLocaleString()} candles · ${days} dates`);
    } catch (caught) { setError((caught as Error).message); }
  }
  async function run() {
    if (!candles.length) { setError("Upload historical candles before running the backtest."); return; }
    setBusy(true); setError("");
    try {
      const response = await runDailyLevel({ rules, candles, visibility: "private" });
      setReport(response.report); setCached(response.cached);
    } catch (caught) { setError((caught as Error).message); } finally { setBusy(false); }
  }
  function strategyType(value: StrategyType) {
    setRules((current) => ({
      ...current, strategyType: value,
      name: `${current.symbol} ${value === "previous_day_sweep" ? "Previous Day Sweep Reversal" : "Previous Day Breakout"}`
    }));
  }
  return <div className="daily-page">
    <header><a className="saas-brand" href="#/"><span><Beaker size={17} /></span>Edge<i>Lab</i></a><nav><a href="#/saas">ORB workspace</a><a href="#/saas-reports">Reports</a><a href="#/samples">Strategy packs</a></nav></header>
    <main>
      <div className="daily-title"><p>SERVER ENGINE · DAILY LEVEL 1.0</p><h1>Previous-day level research</h1><span>Test objective breakouts or failed-break sweeps against the prior trading date’s high and low.</span></div>
      <div className="daily-layout">
        <section className="daily-rules">
          <h2>Exact rules</h2>
          <label>Strategy<select aria-label="Strategy" value={rules.strategyType} onChange={(event) => strategyType(event.target.value as StrategyType)}><option value="previous_day_breakout">Previous day high/low breakout</option><option value="previous_day_sweep">Previous day sweep and reversal</option></select></label>
          <label>Name<input aria-label="Name" value={rules.name} onChange={(event) => setRules({ ...rules, name: event.target.value })} /></label>
          <div><label>Symbol<input aria-label="Symbol" value={rules.symbol} onChange={(event) => setRules({ ...rules, symbol: event.target.value.toUpperCase() })} /></label><label>Timeframe<select aria-label="Timeframe" value={rules.timeframe} onChange={(event) => setRules({ ...rules, timeframe: event.target.value as StrategyRules["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label></div>
          <div><label>Risk/reward<input aria-label="Risk/reward" type="number" min=".25" max="20" step=".25" value={rules.rewardRisk} onChange={(event) => setRules({ ...rules, rewardRisk: Number(event.target.value) })} /></label><label>Direction<select aria-label="Direction" value={rules.direction} onChange={(event) => setRules({ ...rules, direction: event.target.value as StrategyRules["direction"] })}><option value="long_and_short">Long and short</option><option value="long_only">Long only</option><option value="short_only">Short only</option></select></label></div>
          <label className="daily-check"><input type="checkbox" checked={rules.fees} onChange={(event) => setRules({ ...rules, fees: event.target.checked })} />Fees enabled</label>
          <label className="daily-check"><input type="checkbox" checked={rules.slippage} onChange={(event) => setRules({ ...rules, slippage: event.target.checked })} />Slippage enabled</label>
          <pre>{JSON.stringify({ strategy_type: rules.strategyType, reference: "previous_trading_date_high_low", trigger: rules.strategyType === "previous_day_sweep" ? "pierce_level_then_close_back_inside" : "trade_through_level", stop: rules.strategyType === "previous_day_sweep" ? "signal_candle_extreme" : "opposite_previous_day_level", target: `${rules.rewardRisk}R`, same_bar_policy: "stop_first" }, null, 2)}</pre>
        </section>
        <section className="daily-run">
          <h2>Historical data</h2>
          <label className="daily-upload"><Upload size={17} /><strong>{dataLabel}</strong><span>CSV columns: timestamp, open, high, low, close</span><input type="file" accept=".csv,text/csv" onChange={(event) => upload(event.target.files?.[0])} /></label>
          {error && <div className="daily-error">{error}</div>}
          <button disabled={busy} onClick={run}><Play size={13} />{busy ? "Working…" : "Run server backtest"}</button>
          <div className="daily-boundary"><Database size={14} /><span>The server engine calculates every trade. AI does not generate these results.</span></div>
        </section>
      </div>
      {report && <section className="daily-report"><div><p>{cached ? "CACHED REPORT REUSED" : "NEW IMMUTABLE REPORT"}</p><h2>{String(report.rules.name)}</h2><span>{report.engineVersion}</span></div><article>{[["Total R", formatR(report.result.totalR)], ["Win rate", `${report.result.winRate.toFixed(1)}%`], ["Trades", report.result.trades.length], ["Average R", formatR(report.result.averageR)], ["Profit factor", report.result.profitFactor === null ? "∞" : report.result.profitFactor.toFixed(2)], ["Max drawdown", `-${report.result.maxDrawdown.toFixed(2)}R`]].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</article><a href={`#/saas-reports/${encodeURIComponent(report.id)}`}>Open full report <ArrowRight size={12} /></a></section>}
    </main>
  </div>;
}
