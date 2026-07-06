import { recordUsage } from "./plans.mjs";

export const DEFAULT_DATA_CONTROLS = Object.freeze({ disableDatabento: false, cachedDatabentoOnly: false, disableYahoo: false, forceDailyCandles: false, forceProxyForFutures: false, disableLongWindows: false });
export function requireAdmin(account) { if (account.role !== "admin") { const error = new Error("Admin access required."); error.status = 403; error.code = "FORBIDDEN"; throw error; } return account; }
export function getDataControls(db) {
  const row = db.prepare("SELECT value_json, updated_at FROM app_settings WHERE key = 'data_controls'").get();
  if (!row) return { ...DEFAULT_DATA_CONTROLS, updatedAt: null };
  try { return { ...DEFAULT_DATA_CONTROLS, ...JSON.parse(row.value_json), updatedAt: row.updated_at }; } catch { return { ...DEFAULT_DATA_CONTROLS, updatedAt: row.updated_at }; }
}
export function updateDataControls(db, account, input) {
  requireAdmin(account); const controls = getDataControls(db), next = {};
  for (const key of Object.keys(DEFAULT_DATA_CONTROLS)) next[key] = key in input ? Boolean(input[key]) : Boolean(controls[key]);
  if (next.disableDatabento) next.cachedDatabentoOnly = true;
  const updatedAt = new Date().toISOString();
  db.prepare("INSERT INTO app_settings (key,value_json,updated_by,updated_at) VALUES ('data_controls',?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_by=excluded.updated_by, updated_at=excluded.updated_at")
    .run(JSON.stringify(next), account.id, updatedAt);
  recordUsage(db, account.id, "admin_data_controls_changed", { controls: next });
  return { ...next, updatedAt };
}
export function auditEvent(db, account, eventType, metadata = {}) { recordUsage(db, account.id, `audit_${eventType}`, metadata); }