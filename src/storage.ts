import type { BacktestResult, SavedStrategy, UserPreferences } from "./types";

const keys = { strategies: "edgelab.strategies.v1", runs: "edgelab.runs.v1", preferences: "edgelab.preferences.v1" };
function read<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  strategies: () => read<SavedStrategy[]>(keys.strategies, []),
  runs: () => read<BacktestResult[]>(keys.runs, []),
  preferences: (fallback: UserPreferences) => read<UserPreferences>(keys.preferences, fallback),
  saveStrategy(strategy: SavedStrategy) {
    localStorage.setItem(keys.strategies, JSON.stringify([strategy, ...this.strategies().filter((item) => item.id !== strategy.id)]));
  },
  saveRun(run: BacktestResult) {
    localStorage.setItem(keys.runs, JSON.stringify([run, ...this.runs()].slice(0, 50)));
  },
  savePreferences(preferences: UserPreferences) {
    localStorage.setItem(keys.preferences, JSON.stringify(preferences));
  },
  removeStrategy(id: string) {
    localStorage.setItem(keys.strategies, JSON.stringify(this.strategies().filter((item) => item.id !== id)));
  },
};
