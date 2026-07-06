import test from "node:test";
import assert from "node:assert/strict";
import { classifyPreflight } from "./preflight-classifier.mjs";
import { INPUT_TIER, NEXT_WORKFLOW_TIER, PLAN_IMPLICATION, STRATEGY_FAMILY } from "./preflight-definitions.mjs";

test("vague strategy routes to clarification instead of parser", async () => {
  const result = await classifyPreflight("Buy when price shows strength after a liquidity sweep.", { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.inputTier, INPUT_TIER.STRATEGY_VAGUE);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.CLARIFICATION);
  assert.equal(result.shouldRunFullParser, false);
  assert.ok(result.missingFields.includes("stop_loss"));
});

test("ready ORB strategy can run the full parser", async () => {
  const result = await classifyPreflight("Test NQ 8 AM opening range breakout on 5 minute candles with a 15 minute range and 1:3 risk reward.", { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.inputTier, INPUT_TIER.STRATEGY_READY);
  assert.equal(result.strategyFamily, STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT);
  assert.equal(result.shouldRunFullParser, true);
});

test("futures symbols flag likely premium data", async () => {
  const result = await classifyPreflight("Backtest ES opening range breakout on 5m with 1:2 risk reward.", { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.planImplication, PLAN_IMPLICATION.PRO_DATA_LIKELY);
  assert.ok(result.detectedSymbols.includes("ES"));
});

test("live trade advice redirects away from strategy parsing", async () => {
  const result = await classifyPreflight("Should I buy NQ right now or wait?", { modelClassifier: async () => ({ inputTier: INPUT_TIER.STRATEGY_READY, nextWorkflowTier: NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER, strategyFamily: STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT, planImplication: PLAN_IMPLICATION.FREE_OK, confidence: 0.99, reasons: [], warnings: [], missingFields: [], detectedSymbols: ["NQ"], shouldRunFullParser: true }) });
  assert.equal(result.inputTier, INPUT_TIER.LIVE_TRADE_ADVICE);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.SAFETY_REDIRECT);
  assert.equal(result.shouldRunFullParser, false);
});

test("transcript and notes route to transcript extractor", async () => {
  const result = await classifyPreflight("YouTube transcript: this simple moving average strategy made 300 percent. ".repeat(80), { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.inputTier, INPUT_TIER.TRANSCRIPT_OR_NOTES);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.TRANSCRIPT_EXTRACTOR);
});

test("report question routes to cheap helper", async () => {
  const result = await classifyPreflight("Why did this report have such a bad drawdown and profit factor?", { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.inputTier, INPUT_TIER.REPORT_REVIEW);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.CHEAP_HELPER);
});

test("code/admin request routes to admin support", async () => {
  const result = await classifyPreflight("Fix the CSS contrast and restart the server deployment.", { modelClassifier: async () => { throw Object.assign(new Error("no model"), { code: "OFF" }); } });
  assert.equal(result.inputTier, INPUT_TIER.CODE_ADMIN_DEPLOYMENT);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.CODE_ADMIN_SUPPORT);
});

test("malformed model JSON falls back to deterministic classification", async () => {
  const result = await classifyPreflight("Test NQ opening range breakout on 5 minute candles with 1:3 risk reward.", { modelClassifier: async () => ({ nope: true }) });
  assert.equal(result.fallbackUsed, true);
  assert.equal(result.strategyFamily, STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT);
});

test("low confidence does not run the full parser", async () => {
  const result = await classifyPreflight("Test NQ opening range breakout on 5 minute candles with 1:3 risk reward.", { modelClassifier: async () => ({ inputTier: INPUT_TIER.STRATEGY_READY, nextWorkflowTier: NEXT_WORKFLOW_TIER.FULL_STRATEGY_PARSER, strategyFamily: STRATEGY_FAMILY.OPENING_RANGE_BREAKOUT, planImplication: PLAN_IMPLICATION.PRO_DATA_LIKELY, confidence: 0.5, reasons: ["weak"], warnings: [], missingFields: [], detectedSymbols: ["NQ"], shouldRunFullParser: true }) });
  assert.equal(result.shouldRunFullParser, false);
  assert.equal(result.nextWorkflowTier, NEXT_WORKFLOW_TIER.CLARIFICATION);
});

