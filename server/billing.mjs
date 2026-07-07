import { createHmac, timingSafeEqual } from "node:crypto";
import { badRequest } from "./validation.mjs";

export async function startTrial(db, account, now = new Date(), days = 14) {
  const subscription = await db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(account.id);
  if (subscription.plan !== "free" || subscription.trial_ends_at) {
    const error = new Error("This account has already used its trial or has an active plan.");
    error.status = 409;
    error.code = "TRIAL_UNAVAILABLE";
    throw error;
  }
  const trialEndsAt = new Date(now.getTime() + days * 86400000).toISOString();
  await db.prepare("UPDATE subscriptions SET plan = 'trial', status = 'trialing', trial_ends_at = ?, current_period_ends_at = ?, updated_at = ? WHERE user_id = ?")
    .run(trialEndsAt, trialEndsAt, now.toISOString(), account.id);
  return { plan: "trial", status: "trialing", trialEndsAt };
}

export function verifyWebhook(rawBody, signature, secret) {
  if (!secret) {
    const error = new Error("Billing webhook secret is not configured.");
    error.status = 503;
    error.code = "BILLING_NOT_CONFIGURED";
    throw error;
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(rawBody).digest("hex"));
  const actual = Buffer.from(String(signature ?? ""));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    const error = new Error("Invalid billing webhook signature.");
    error.status = 401;
    error.code = "INVALID_WEBHOOK_SIGNATURE";
    throw error;
  }
}

export async function applySubscriptionEvent(db, event, now = new Date()) {
  if (!event || event.type !== "subscription.updated") throw badRequest("Unsupported billing event.");
  const data = event.data;
  if (!data?.userId || !["free", "starter", "trial", "pro", "power"].includes(data.plan) || !["active", "trialing", "past_due", "canceled"].includes(data.status)) {
    throw badRequest("Billing event data is invalid.");
  }
  const result = await db.prepare(`
    UPDATE subscriptions
    SET plan = ?, status = ?, provider_customer_id = ?, provider_subscription_id = ?,
        current_period_ends_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(
    data.plan, data.status, data.customerId ?? null, data.subscriptionId ?? null,
    data.currentPeriodEndsAt ?? null, now.toISOString(), data.userId
  );
  if (!result.changes) throw badRequest("Billing user does not exist.");
  return { accepted: true, userId: data.userId, plan: data.plan, status: data.status };
}
