import { requireAuth, send } from "./http.mjs";
import { applyStripeEvent, createStripeCheckout, createStripePortal, verifyStripeSignature } from "./stripe-billing.mjs";

async function rawBody(request, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function handleStripeBilling({ pathname, method, request, response, db, stripeConfig, stripeFetch }) {
  if (pathname === "/api/billing/checkout" && method === "POST") {
    const account = await requireAuth(request, db);
    const subscription = await db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(account.id);
    const session = await createStripeCheckout(account, subscription, stripeConfig, stripeFetch);
    send(response, 201, { session });
    return true;
  }
  if (pathname === "/api/billing/portal" && method === "POST") {
    const account = await requireAuth(request, db);
    const subscription = await db.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(account.id);
    const session = await createStripePortal(subscription, stripeConfig, stripeFetch);
    send(response, 201, { session });
    return true;
  }
  if (pathname === "/api/billing/stripe-webhook" && method === "POST") {
    const raw = await rawBody(request);
    verifyStripeSignature(raw, request.headers["stripe-signature"], stripeConfig?.webhookSecret);
    let event;
    try { event = JSON.parse(raw.toString("utf8")); }
    catch {
      const error = new Error("Stripe webhook body must be valid JSON.");
      error.status = 400; error.code = "BAD_REQUEST";
      throw error;
    }
    send(response, 200, await applyStripeEvent(db, event));
    return true;
  }
  return false;
}
