import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const API_URL = "https://hist.databento.com/v0/timeseries.get_range";
const CHUNK_MONTHS = 1;
const MAX_YEARS = 4;
const CACHE_ROOT = resolve(process.env.MARKET_DATA_CACHE_PATH ?? "data/market-cache");
const EQUITY_SYMBOLS = new Set(["SPY", "QQQ", "IWM", "DIA", "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"]);

function yearsFor(range) {
  const text = String(range ?? "1y").trim().toLowerCase();
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value) || value <= 0) return 1;
  if (text.includes("d")) return Math.max(1 / 365, Math.min(MAX_YEARS, value / 365));
  if (text.includes("m")) return Math.max(1 / 12, Math.min(MAX_YEARS, value / 12));
  return Math.max(1 / 365, Math.min(MAX_YEARS, value));
}

function marketSpec(rules) {
  const symbol = String(rules?.symbol ?? "NQ").toUpperCase().replace(/=F$/, "");
  if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) throw new Error("Use a valid market symbol.");
  const equity = rules?.market === "Stocks" || rules?.market === "Equities" || EQUITY_SYMBOLS.has(symbol);
  return equity
    ? { dataset: "EQUS.MINI", symbol, stypeIn: "raw_symbol", assetClass: "equity" }
    : { dataset: "GLBX.MDP3", symbol: `${symbol}.c.0`, stypeIn: "continuous", assetClass: "futures" };
}

function localTimestamp(value, timezone) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone || "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

function parseJsonLines(text, timezone) {
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).map((record) => ({
    timestamp: localTimestamp(record.ts_event ?? record.hd?.ts_event, timezone),
    open: Number(record.open), high: Number(record.high), low: Number(record.low), close: Number(record.close)
  })).filter((bar) => bar.timestamp && [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite));
}

function aggregate(candles, timeframe) {
  const text = String(timeframe ?? "5m").toLowerCase();
  const minutes = text.endsWith("h") ? Number.parseInt(text, 10) * 60 : Number.parseInt(text, 10);
  if (!Number.isFinite(minutes) || minutes <= 1) return candles;
  const buckets = new Map();
  for (const candle of candles) {
    const date = new Date(`${candle.timestamp}Z`);
    const totalMinutes = date.getUTCHours() * 60 + date.getUTCMinutes();
    const bucketMinutes = Math.floor(totalMinutes / minutes) * minutes;
    date.setUTCHours(0, bucketMinutes, 0, 0);
    const key = date.toISOString().slice(0, 19);
    const current = buckets.get(key);
    if (!current) buckets.set(key, { ...candle, timestamp: key });
    else { current.high = Math.max(current.high, candle.high); current.low = Math.min(current.low, candle.low); current.close = candle.close; }
  }
  return [...buckets.values()];
}

function cachePath(input) {
  const digest = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return resolve(CACHE_ROOT, `${digest}.json`);
}

async function readChunk(input) {
  try {
    const payload = JSON.parse(await readFile(cachePath(input), "utf8"));
    return Array.isArray(payload.candles) ? payload.candles : null;
  } catch { return null; }
}

async function writeChunk(input, candles) {
  try {
    await mkdir(CACHE_ROOT, { recursive: true });
    const target = cachePath(input), temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ version: 1, source: "databento", query: input, cachedAt: new Date().toISOString(), candles }));
    await rename(temporary, target);
  } catch (error) { console.error("Market-data cache write failed:", error.message); }
}

function nextChunkBoundary(date, requestEnd) {
  const currentMonth = date.getUTCFullYear() === requestEnd.getUTCFullYear() && date.getUTCMonth() === requestEnd.getUTCMonth();
  return currentMonth
    ? new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1))
    : new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
}

export async function fetchDatabentoCandles(rules, { fetchImpl = fetch, apiKey = process.env.DATABENTO_API_KEY, returnMetadata = false, start: requestedStartOverride, end: requestedEndOverride } = {}) {
  if (!apiKey) { const error = new Error("Databento is not configured."); error.status = 503; error.code = "MARKET_DATA_NOT_CONFIGURED"; throw error; }
  const spec = marketSpec(rules), authorization = `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`;
  const rangeUrl = `https://hist.databento.com/v0/metadata.get_dataset_range?dataset=${encodeURIComponent(spec.dataset)}`;
  const rangeResponse = await fetchImpl(rangeUrl, { headers: { authorization } });
  if (!rangeResponse.ok) { const error = new Error("Could not determine available market-data history."); error.status = 502; error.code = "MARKET_DATA_FAILED"; throw error; }
  const availability = await rangeResponse.json();
  const schemaRange = availability.schema?.["ohlcv-1m"] ?? availability;
  const entitlementEnd = new Date(schemaRange.end), availableStart = new Date(schemaRange.start);
  const entitlementSafeEnd = new Date(entitlementEnd.getTime() - 60_000);
  if (![entitlementSafeEnd, availableStart].every((date) => Number.isFinite(date.getTime()))) { const error = new Error("Databento returned an invalid availability window."); error.status = 502; error.code = "MARKET_DATA_FAILED"; throw error; }
  const requestedEnd = requestedEndOverride ? new Date(requestedEndOverride) : entitlementSafeEnd;
  const end = new Date(Math.min(requestedEnd.getTime(), entitlementSafeEnd.getTime()));
  const requestedStart = requestedStartOverride ? new Date(requestedStartOverride) : new Date(end.getTime() - yearsFor(rules.dateRange) * 365 * 24 * 60 * 60 * 1000);
  requestedStart.setUTCHours(0, 0, 0, 0);
  if (![end, requestedStart].every((date) => Number.isFinite(date.getTime())) || requestedStart >= end) { const error = new Error("Databento request window is invalid."); error.status = 422; error.code = "INVALID_MARKET_DATA_WINDOW"; throw error; }
  const start = new Date(Math.max(requestedStart.getTime(), availableStart.getTime()));
  const stitched = new Map();
  let cacheHits = 0, downloads = 0;
  for (let cursor = start; cursor < end;) {
    const chunkEnd = new Date(Math.min(end.getTime(), nextChunkBoundary(cursor, end).getTime()));
    const query = { dataset: spec.dataset, symbol: spec.symbol, schema: "ohlcv-1m", start: cursor.toISOString(), end: chunkEnd.toISOString(), timezone: rules.timezone ?? "America/New_York" };
    let candles = await readChunk(query);
    if (candles) cacheHits += 1;
    else {
      const form = new URLSearchParams({ dataset: spec.dataset, symbols: spec.symbol, schema: "ohlcv-1m", start: query.start, end: query.end, encoding: "json", stype_in: spec.stypeIn, pretty_px: "true", pretty_ts: "true", map_symbols: "true" });
      const response = await fetchImpl(API_URL, { method: "POST", headers: { authorization, "content-type": "application/x-www-form-urlencoded" }, body: form });
      if (!response.ok) { const detail = await response.text(); const error = new Error("Market data could not be loaded for this window. Please retry in a moment."); error.status = 502; error.code = "MARKET_DATA_FAILED"; error.details = detail.slice(0, 500); throw error; }
      candles = parseJsonLines(await response.text(), query.timezone); downloads += 1;
      await writeChunk(query, candles);
    }
    for (const candle of candles) stitched.set(candle.timestamp, candle);
    cursor = chunkEnd;
  }
  const candles = aggregate([...stitched.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)), rules.timeframe);
  if (!candles.length) { const error = new Error("Databento returned no candles for this request."); error.status = 422; error.code = "NO_MARKET_DATA"; throw error; }
  console.log(`Market data ${spec.dataset}/${spec.symbol}: ${cacheHits} cached chunks, ${downloads} downloaded chunks, ${candles.length} bars.`);
  return returnMetadata
    ? { candles, cacheHits, downloads, providerCalls: downloads + 1, dataset: spec.dataset, symbol: spec.symbol }
    : candles;
}
