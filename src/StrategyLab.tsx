import { useMemo, useRef, useState } from "react";
import { ArrowLeft, BarChart3, Beaker, Check, Code2, Database, Play, Save, Upload } from "lucide-react";
import { parseCandleCsv, runOrbBacktest } from "./backtest";
import { downloadText, generatePineScript } from "./pine";
import { generateStrategyPine } from "./pineStrategies";
import { storage } from "./storage";
import { DEFAULT_ENGINE_PARAMETERS, runRuleStrategy, type EngineParameters } from "./strategyEngines";
import type { BacktestResult, Candle, SavedStrategy, StrategyRules, StrategyType } from "./types";

const labels: Record<StrategyType, string> = {
  opening_range_breakout: "Opening range breakout",
  previous_day_breakout: "Previous day high/low breakout",
  previous_day_sweep: "Previous day sweep & reversal",
  moving_average_crossover: "Moving average crossover",
  moving_average_pullback: "Moving average pullback",
  rsi_reversal: "RSI reversal",
  support_resistance_breakout: "Support / resistance breakout",
};
const initialRules: StrategyRules = {
  name: "NQ Opening Range", strategyType: "opening_range_breakout", market: "Futures", symbol: "NQ",
  timeframe: "5m", dateRange: "3y", sessionTime: "08:00", timezone: "America/New_York",
  openingRangeMinutes: 15, entryRule: "break_above_or_below_range", stopRule: "opposite_side_of_range",
  rewardRisk: 3, direction: "long_and_short", maxTradesPerDay: 1, fees: true, slippage: true,
};
const formatR = (value: number) => `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;

export default function StrategyLab() {
  const [rules, setRules] = useState(initialRules);
  const [parameters, setParameters] = useState(DEFAULT_ENGINE_PARAMETERS);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<BacktestResult | null>(null);
  const [message, setMessage] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const exactRules = useMemo(() => ({
    strategy_type: rules.strategyType, symbol: rules.symbol, timeframe: rules.timeframe,
    data_source: fileName || "required_csv_upload", date_range: rules.dateRange, session_time: rules.sessionTime,
    timezone: rules.timezone, opening_range_minutes: rules.strategyType === "opening_range_breakout" ? rules.openingRangeMinutes : undefined,
    fast_ma: ["moving_average_crossover", "moving_average_pullback"].includes(rules.strategyType) ? parameters.fastMa : undefined,
    slow_ma: ["moving_average_crossover", "moving_average_pullback"].includes(rules.strategyType) ? parameters.slowMa : undefined,
    rsi_period: rules.strategyType === "rsi_reversal" ? parameters.rsiPeriod : undefined,
    rsi_oversold: rules.strategyType === "rsi_reversal" ? parameters.rsiOversold : undefined,
    rsi_overbought: rules.strategyType === "rsi_reversal" ? parameters.rsiOverbought : undefined,
    lookback: rules.strategyType === "support_resistance_breakout" ? parameters.lookback : undefined,
    stop_lookback: rules.strategyType !== "opening_range_breakout" ? parameters.stopLookback : undefined,
    take_profit: `${rules.rewardRisk}R`, direction: rules.direction, fees: rules.fees, slippage: rules.slippage,
    same_bar_policy: "stop_first",
  }), [rules, parameters, fileName]);

  async function upload(file?: File) {
    if (!file) return;
    try {
      const parsed = parseCandleCsv(await file.text());
      setCandles(parsed); setFileName(file.name); setMessage(`${parsed.length.toLocaleString()} candles loaded from ${file.name}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid CSV."); }
  }
  function run() {
    if (!candles.length) return setMessage("Upload historical OHLC candles before running this workspace.");
    const next = rules.strategyType === "opening_range_breakout" ? runOrbBacktest(rules, candles) : runRuleStrategy(rules, candles, parameters);
    storage.saveRun(next); setResult(next); setMessage(`Run stored with ${next.trades.length} qualifying trades.`);
  }
  function save() {
    const item: SavedStrategy = { id: `${Date.now()}`, savedAt: new Date().toISOString(), favorite: false, rules, latestResult: result ?? undefined };
    storage.saveStrategy(item); setMessage("Strategy and latest result saved.");
  }
  function exportPine() {
    const script = rules.strategyType === "opening_range_breakout" ? generatePineScript(rules) : generateStrategyPine(rules, parameters);
    downloadText(`${rules.name.replace(/\W+/g, "-").toLowerCase()}.pine`, script);
  }

  return <div className="lab-shell">
    <div className="experimental-banner"><strong>Experimental local lab</strong><span>Runs here use uploaded candles and browser storage. They are not server reports.</span></div>
    <header className="lab-header"><a className="landing-brand" href="#/"><span><Beaker size={18} /></span>Edge<i>Lab</i></a><nav><a href="#/app">Test a Strategy</a><a href="#/dev/runs">Local run archive</a></nav></header>
    <main className="lab-main">
      <div className="lab-title"><div><a href="#/app"><ArrowLeft size={13} /> App</a><p>EXPERIMENTAL ? LOCAL BROWSER ONLY</p><h1>Rule engine lab</h1><span>Uploaded candles only. Every engine assumption is visible before execution.</span></div><div><button className="lab-button" onClick={save}><Save size={14} /> Save</button><button className="lab-button primary" onClick={run}><Play size={14} /> Run backtest</button></div></div>
      {message && <div className="lab-message"><Check size={13} />{message}</div>}
      <div className="lab-layout"><section>
        <div className="lab-card"><div className="lab-card-title"><span>01</span><h2>Choose the rule engine</h2></div><div className="engine-grid">{Object.entries(labels).map(([value, label]) => <button className={rules.strategyType === value ? "selected" : ""} key={value} onClick={() => setRules({ ...rules, strategyType: value as StrategyType, name: `${rules.symbol} ${label}` })}><strong>{label}</strong><small>{value === "opening_range_breakout" ? "Session range" : value.includes("moving_average") ? "Trend" : value.includes("previous_day") ? "Daily levels" : "Technical"}</small></button>)}</div></div>
        <div className="lab-card"><div className="lab-card-title"><span>02</span><h2>Historical candles</h2></div><div className="upload-zone"><Database /><div><strong>{fileName || "No dataset loaded"}</strong><p>CSV: timestamp, open, high, low, close. Timestamps must match the selected timezone.</p></div><input hidden ref={fileRef} type="file" accept=".csv" onChange={(event) => upload(event.target.files?.[0])} /><button className="lab-button" onClick={() => fileRef.current?.click()}><Upload size={13} /> Upload CSV</button></div></div>
        <div className="lab-card"><div className="lab-card-title"><span>03</span><h2>Exact rules</h2></div><pre>{JSON.stringify(exactRules, (_key, value) => value === undefined ? undefined : value, 2)}</pre></div>
        {result && <ResultSummary result={result} onExport={exportPine} />}
      </section>
      <aside className="lab-settings"><h2>Parameters</h2><p>Stored with the strategy run.</p>
        <label>Strategy name<input value={rules.name} onChange={(event) => setRules({ ...rules, name: event.target.value })} /></label>
        <div className="field-row"><label>Symbol<input value={rules.symbol} onChange={(event) => setRules({ ...rules, symbol: event.target.value.toUpperCase() })} /></label><label>Timeframe<select value={rules.timeframe} onChange={(event) => setRules({ ...rules, timeframe: event.target.value as StrategyRules["timeframe"] })}><option>1m</option><option>5m</option><option>15m</option></select></label></div>
        <label>Direction<select value={rules.direction} onChange={(event) => setRules({ ...rules, direction: event.target.value as StrategyRules["direction"] })}><option value="long_and_short">Long & short</option><option value="long_only">Long only</option><option value="short_only">Short only</option></select></label>
        <label>Reward / risk<input type="number" min="1" max="10" step=".5" value={rules.rewardRisk} onChange={(event) => setRules({ ...rules, rewardRisk: Number(event.target.value) })} /></label>
        {rules.strategyType === "opening_range_breakout" && <><div className="field-row"><label>Session time<input type="time" value={rules.sessionTime} onChange={(event) => setRules({ ...rules, sessionTime: event.target.value })} /></label><label>Range minutes<select value={rules.openingRangeMinutes} onChange={(event) => setRules({ ...rules, openingRangeMinutes: Number(event.target.value) as StrategyRules["openingRangeMinutes"] })}><option>5</option><option>15</option><option>30</option><option>60</option></select></label></div></>}
        {["moving_average_crossover", "moving_average_pullback"].includes(rules.strategyType) && <div className="field-row"><NumberField label="Fast MA" value={parameters.fastMa} set={(fastMa) => setParameters({ ...parameters, fastMa })} /><NumberField label="Slow MA" value={parameters.slowMa} set={(slowMa) => setParameters({ ...parameters, slowMa })} /></div>}
        {rules.strategyType === "rsi_reversal" && <><NumberField label="RSI period" value={parameters.rsiPeriod} set={(rsiPeriod) => setParameters({ ...parameters, rsiPeriod })} /><div className="field-row"><NumberField label="Oversold" value={parameters.rsiOversold} set={(rsiOversold) => setParameters({ ...parameters, rsiOversold })} /><NumberField label="Overbought" value={parameters.rsiOverbought} set={(rsiOverbought) => setParameters({ ...parameters, rsiOverbought })} /></div></>}
        {rules.strategyType === "support_resistance_breakout" && <NumberField label="Level lookback" value={parameters.lookback} set={(lookback) => setParameters({ ...parameters, lookback })} />}
        {rules.strategyType !== "opening_range_breakout" && <NumberField label="Stop lookback" value={parameters.stopLookback} set={(stopLookback) => setParameters({ ...parameters, stopLookback })} />}
        <Toggle label="Include fees" value={rules.fees} set={(fees) => setRules({ ...rules, fees })} /><Toggle label="Include slippage" value={rules.slippage} set={(slippage) => setRules({ ...rules, slippage })} />
        <div className="lab-policy"><strong>Conservative same-bar policy</strong><p>If stop and target occur in one candle, the result is a stop.</p></div>
      </aside></div>
    </main>
  </div>;
}

function NumberField({ label, value, set }: { label: string; value: number; set: (value: number) => void }) { return <label>{label}<input type="number" min="1" value={value} onChange={(event) => set(Number(event.target.value))} /></label>; }
function Toggle({ label, value, set }: { label: string; value: boolean; set: (value: boolean) => void }) { return <div className="toggle-row"><span>{label}</span><button className={value ? "toggle on" : "toggle"} onClick={() => set(!value)}><span /></button></div>; }
function ResultSummary({ result, onExport }: { result: BacktestResult; onExport: () => void }) {
  const stats = [["Total R", formatR(result.totalR)], ["Win rate", `${result.winRate.toFixed(1)}%`], ["Trades", String(result.trades.length)], ["Average R", formatR(result.averageR)], ["Profit factor", Number.isFinite(result.profitFactor) ? result.profitFactor.toFixed(2) : "∞"], ["Drawdown", `-${result.maxDrawdown.toFixed(2)}R`]];
  return <div className="lab-card lab-result"><div className="lab-result-head"><div><p>UPLOADED DATA RESULT</p><h2>{result.rules.name}</h2></div><div><a className="lab-button" href={`#/runs/${encodeURIComponent(result.id)}`}><BarChart3 size={13} /> Full detail</a><button className="lab-button" onClick={onExport}><Code2 size={13} /> Pine Script</button></div></div><div className="lab-stats">{stats.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div></div>;
}
