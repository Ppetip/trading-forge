export const PLAN_LIMITS = Object.freeze({
  free: { backtests: 5, savedStrategies: 3, savedReports: 3, pineExports: 0, transcriptExtractions: 0, comparisons: 0, aiReportReviews: 0, premiumDataBacktests: 0, newPremiumWindows: 0 },
  starter: { backtests: 100, savedStrategies: 50, savedReports: 50, pineExports: 100, transcriptExtractions: 25, comparisons: 0, aiReportReviews: 25, premiumDataBacktests: 0, newPremiumWindows: 0 },
  trial: { backtests: 50, savedStrategies: 25, savedReports: 50, pineExports: 20, transcriptExtractions: 5, comparisons: 20, aiReportReviews: 25, premiumDataBacktests: 10, newPremiumWindows: 2 },
  pro: { backtests: 500, savedStrategies: 250, savedReports: 1000, pineExports: 500, transcriptExtractions: 100, comparisons: 500, aiReportReviews: 250, premiumDataBacktests: 100, newPremiumWindows: 20 },
  power: { backtests: 2000, savedStrategies: 1000, savedReports: 5000, pineExports: 2000, transcriptExtractions: 500, comparisons: 2000, aiReportReviews: 1000, premiumDataBacktests: 500, newPremiumWindows: 100 },
});

export function effectivePlan(account, now = new Date()) {
  if (account.plan === "trial" && account.trial_ends_at && new Date(account.trial_ends_at) <= now) return "free";
  if (account.subscription_status === "past_due" || account.subscription_status === "canceled") return "free";
  return PLAN_LIMITS[account.plan] ? account.plan : "free";
}

export function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

export function usageFor(db, userId, eventType, now = new Date()) {
  return Number(db.prepare("SELECT COALESCE(SUM(quantity), 0) AS total FROM usage_events WHERE user_id = ? AND event_type = ? AND created_at >= ?")
    .get(userId, eventType, monthStart(now)).total);
}

export function assertUsage(db, account, eventType, limitName, now = new Date()) {
  const plan = effectivePlan(account, now);
  const limit = PLAN_LIMITS[plan][limitName];
  const used = usageFor(db, account.id, eventType, now);
  if (used >= limit) {
    const error = new Error(`${limitName} limit reached for the ${plan} plan.`);
    error.status = 402;
    error.code = "PLAN_LIMIT_REACHED";
    error.details = { plan, limit, used, limitName };
    throw error;
  }
  return { plan, limit, used, remaining: limit - used };
}

export function recordUsage(db, userId, eventType, metadata = null, quantity = 1, now = new Date()) {
  const { randomUUID } = awaitImportCrypto();
  db.prepare("INSERT INTO usage_events (id, user_id, event_type, quantity, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, eventType, quantity, metadata ? JSON.stringify(metadata) : null, now.toISOString());
}

function awaitImportCrypto() {
  return globalThis.__edgelabCrypto ??= { randomUUID: () => crypto.randomUUID() };
}

export function accountUsage(db, account, now = new Date()) {
  const plan = effectivePlan(account, now);
  const limits = PLAN_LIMITS[plan];
  return {
    plan,
    limits,
    used: {
      backtests: usageFor(db, account.id, "backtest", now),
      pineExports: usageFor(db, account.id, "pine_export", now),
      transcriptExtractions: usageFor(db, account.id, "transcript_extraction", now),
      comparisons: usageFor(db, account.id, "comparison", now),
      aiReportReviews: usageFor(db, account.id, "ai_report_review", now),
      premiumDataBacktests: usageFor(db, account.id, "premium_data_backtest", now),
      newPremiumWindows: usageFor(db, account.id, "premium_data_window", now),
    },
  };
}


