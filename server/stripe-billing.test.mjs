import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createDatabase } from "./db.mjs";
import { applyStripeEvent, createStripeCheckout, createStripePortal, verifyStripeSignature } from "./stripe-billing.mjs";

const config = { secretKey: "sk_test", webhookSecret: "whsec_test", proPriceId: "price_pro", appUrl: "https://edgelab.test" };
const account = { id: "user-1", email: "trader@example.com" };

test("Stripe Checkout and portal requests use server-side account references", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init, params: Object.fromEntries(init.body) });
    return new Response(JSON.stringify({ id: url.includes("portal") ? "bps_1" : "cs_1", url: "https://stripe.test/session" }), { status: 200 });
  };
  const checkout = await createStripeCheckout(account, {}, config, fetchImpl);
  assert.equal(checkout.url, "https://stripe.test/session");
  assert.equal(calls[0].params.mode, "subscription");
  assert.equal(calls[0].params.client_reference_id, account.id);
  assert.equal(calls[0].params["line_items[0][price]"], "price_pro");
  assert.equal(calls[0].params.customer_email, account.email);
  await createStripePortal({ provider_customer_id: "cus_1" }, config, fetchImpl);
  assert.equal(calls[1].params.customer, "cus_1");
  assert.equal(calls[1].params.return_url, "https://edgelab.test/#/plans");
});

test("Stripe signature verification rejects tampering and stale events", () => {
  const raw = Buffer.from('{"id":"evt_1"}'), timestamp = 1000;
  const signature = createHmac("sha256", config.webhookSecret).update(`${timestamp}.${raw}`).digest("hex");
  assert.doesNotThrow(() => verifyStripeSignature(raw, `t=${timestamp},v1=${signature}`, config.webhookSecret, 1100));
  assert.throws(() => verifyStripeSignature(Buffer.from("{}"), `t=${timestamp},v1=${signature}`, config.webhookSecret, 1100), /Invalid Stripe/);
  assert.throws(() => verifyStripeSignature(raw, `t=${timestamp},v1=${signature}`, config.webhookSecret, 2000), /expired/);
});

test("Stripe subscription events update entitlements idempotently", async () => {
  const db = createDatabase(":memory:");
  const createdAt = new Date().toISOString();
  db.prepare("INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, 'x', 'Trader', ?, ?)").run(account.id, account.email, createdAt, createdAt);
  db.prepare("INSERT INTO subscriptions (user_id, plan, status, updated_at) VALUES (?, 'free', 'active', ?)").run(account.id, createdAt);
  const event = {
    id: "evt_checkout", type: "checkout.session.completed",
    data: { object: { client_reference_id: account.id, customer: "cus_1", subscription: "sub_1", metadata: {} } }
  };
  const first = await applyStripeEvent(db, event);
  assert.equal(first.plan, "pro");
  assert.equal(db.prepare("SELECT plan FROM subscriptions WHERE user_id = ?").get(account.id).plan, "pro");
  assert.equal((await applyStripeEvent(db, event)).duplicate, true);
  const canceled = await applyStripeEvent(db, {
    id: "evt_deleted", type: "customer.subscription.deleted",
    data: { object: { id: "sub_1", customer: "cus_1", status: "canceled", metadata: { edgelab_user_id: account.id } } }
  });
  assert.equal(canceled.status, "canceled");
  assert.equal(db.prepare("SELECT plan, status FROM subscriptions WHERE user_id = ?").get(account.id).plan, "free");
  db.close();
});
