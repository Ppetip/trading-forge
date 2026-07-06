import type { StrategyType } from "./types";

export const STRATEGY_READINESS = {
  READY_TO_BACKTEST: "READY_TO_BACKTEST",
  NEEDS_CLARIFICATION: "NEEDS_CLARIFICATION",
  PARSED_BUT_UNSUPPORTED: "PARSED_BUT_UNSUPPORTED",
  UNSUPPORTED_VAGUE_PROMPT: "UNSUPPORTED_VAGUE_PROMPT"
} as const;

export type StrategyReadiness = typeof STRATEGY_READINESS[keyof typeof STRATEGY_READINESS];

const SERVER_ENGINES = new Set<StrategyType>([
  "opening_range_breakout",
  "previous_day_breakout",
  "previous_day_sweep"
]);

export function hasServerEngine(strategyType: StrategyType): boolean {
  return SERVER_ENGINES.has(strategyType);
}

export function classifyStrategy(
  strategyType: StrategyType,
  untestable: string[] = []
): StrategyReadiness {
  if (untestable.length) return STRATEGY_READINESS.UNSUPPORTED_VAGUE_PROMPT;
  if (!hasServerEngine(strategyType)) return STRATEGY_READINESS.PARSED_BUT_UNSUPPORTED;
  return STRATEGY_READINESS.READY_TO_BACKTEST;
}

export function readinessLabel(status: StrategyReadiness): string {
  switch (status) {
    case STRATEGY_READINESS.READY_TO_BACKTEST: return "Ready to backtest";
    case STRATEGY_READINESS.NEEDS_CLARIFICATION: return "Needs clarification";
    case STRATEGY_READINESS.PARSED_BUT_UNSUPPORTED: return "Parsed, engine unavailable";
    case STRATEGY_READINESS.UNSUPPORTED_VAGUE_PROMPT: return "Unsupported vague conditions";
  }
}
