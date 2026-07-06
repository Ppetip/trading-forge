import { createHmac, timingSafeEqual } from "node:crypto";

function configuration(input = {}) {
  const config = {
    secretKey: input.secretKey ?? process.env.STRIPE_SECRET_KEY,
    webhookSecret: input.webhookSecret ?? process.env.STRIPE_WEBHOOK_SECRET,
    proPriceId: input.proPriceId ?? process.env.STRIPE_PRO_PRICE_ID,
    appUrl: String(input.appUrl ?? process.env.EDGELAB_APP_URL ?? "").replace(/\/+$/, "")
  };
  if (!config.secretKey || !config.proPriceId || !config.appUrl) {
    const error = new Error("Stripe Checkout is not configured.");
    error.status = 503; error.code = "BILLING_NOT_CONFIGURED";
    throw error;
  }
  return config;
}

async function stripePost(path, parameters, config, fetchImpl = fetch) {
  const response = await fetchImpl(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${config.secretKey}:`).toString("base64")}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(parameters)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error?.message ?? "Stripe request failed.");
    error.status = 502; error.code = "BILLING_PROVIDER_ERROR";
    throw error;
  }
  return data;
}

export async function createStripeCheckout(account, subscription, input = {}, fetchImpl = fetch) {
  const config = configuration(input);
  const params = {
    mode: "subscription",
    "line_items[0][price]": config.proPriceId,
    "line_items[0][quantity]": "1",
    client_reference_id: account.id,
    success_url: `${config.appUrl}/#/plans?checkout=success`,
    cancel_url: `${config.appUrl}/#/plans?checkout=canceled`,
    allow_promotion_codes: "true",
    "metadata[edgelab_user_id]": account.id,
    "subscription_data[metadata][edgelab_user_id]": account.id
  };
  if (subscription?.provider_customer_id) params.customer = subscription.provider_customer_id;
  else params.customer_email = account.email;
  const session = await stripePost("checkout/sessions", params, config, fetchImpl);
  return { id: session.id, url: session.url };
}

export async function createStripePortal(subscription, input = {}, fetchImpl = fetch) {
  const config = configuration(input);
  if (!subscription?.provider_customer_id) {
    const error = new Error("No billing customer exists for this account.");
    error.status = 409; error.code = "BILLING_CUSTOMER_MISSING";
    throw error;
  }
  const session = await stripePost("billing_portal/sessions", {
    customer: subscription.provider_customer_id,
    return_url: `${config.appUrl}/#/plans`
  }, config, fetchImpl);
  return { id: session.id, url: session.url };
}

export function verifyStripeSignature(rawBody, signatureHeader, secret = process.env.STRIPE_WEBHOOK_SECRET, nowSeconds = Math.floor(Date.now() / 1000), toleranceSeconds = 300) {
  if (!secret) {
    const error = new Error("Stripe webhook secret is not configured.");
    error.status = 503; error.code = "BILLING_NOT_CONFIGURED";
    throw error;
  }
  const parts = String(signatureHeader ?? "").split(",").map((part) => part.split("="));
  const timestamp = Number(parts.find(([key]) => key === "t")?.[1]);
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!Number.isFinite(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds || !signatures.length) {
    const error = new Error("Invalid or expired Stripe webhook signature.");
    error.status = 401; error.code = "INVALID_WEBHOOK_SIGNATURE";
    throw error;
  }
  const expected = Buffer.from(createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex"));
  const valid = signatures.some((value) => {
    const actual = Buffer.from(value ?? "");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
  if (!valid) {
    const error = new Error("Invalid Stripe webhook signature.");
    error.status = 401; error.code = "INVALID_WEBHOOK_SIGNATURE";
    throw error;
  }
}

const normalizedStatus = (status) => status === "active" ? "active" : status === "trialing" ? "trialing" : status === "canceled" ? "canceled" : "past_due";

export function applyStripeEvent(db, event, now = new Date()) {
  const object = event?.data?.object;
  if (!event?.id || !event.type || !object) throw Object.assign(new Error("Stripe event payload is invalid."), { status: 400, code: "BAD_REQUEST" });
  db.exec("CREATE TABLE IF NOT EXISTS billing_events (provider_event_id TEXT PRIMARY KEY, event_type TEXT NOT NULL, processed_at TEXT NOT NULL)");
  if (db.prepare("SELECT 1 FROM billing_events WHERE provider_event_id = ?").get(event.id)) return { accepted: true, duplicate: true };
  let userId, plan, status, customerId, subscriptionId, periodEnd;
  if (event.type === "checkout.session.completed") {
    userId = object.client_reference_id ?? object.metadata?.edgelab_user_id;
    plan = "pro"; status = "active"; customerId = object.customer; subscriptionId = object.subscription;
  } else if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
    userId = object.metadata?.edgelab_user_id;
    plan = event.type === "customer.subscription.deleted" ? "free" : "pro";
    status = event.type === "customer.subscription.deleted" ? "canceled" : normalizedStatus(object.status);
    customerId = object.customer; subscriptionId = object.id;
    periodEnd = object.current_period_end ? new Date(object.current_period_end * 1000).toISOString() : null;
  } else {
    db.prepare("INSERT INTO billing_events (provider_event_id, event_type, processed_at) VALUES (?, ?, ?)").run(event.id, event.type, now.toISOString());
    return { accepted: true, ignored: true };
  }
  if (!userId) throw Object.assign(new Error("Stripe event is missing the EdgeLab user reference."), { status: 400, code: "BAD_REQUEST" });
  const result = db.prepare(`
    UPDATE subscriptions SET plan = ?, status = ?, provider_customer_id = COALESCE(?, provider_customer_id),
      provider_subscription_id = COALESCE(?, provider_subscription_id), current_period_ends_at = ?, updated_at = ?
    WHERE user_id = ?
  `).run(plan, status, customerId ?? null, subscriptionId ?? null, periodEnd ?? null, now.toISOString(), userId);
  if (!result.changes) throw Object.assign(new Error("Billing user does not exist."), { status: 400, code: "BAD_REQUEST" });
  db.prepare("INSERT INTO billing_events (provider_event_id, event_type, processed_at) VALUES (?, ?, ?)").run(event.id, event.type, now.toISOString());
  return { accepted: true, duplicate: false, userId, plan, status };
}
