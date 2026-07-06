import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createHmac } from "node:crypto";
import { createDatabase } from "./db.mjs";
import { createEdgeLabServer } from "./server.mjs";

async function request(base, path, { method = "GET", body, cookie, headers = {} } = {}) {
  const raw = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { ...(raw ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: raw
  });
  return { response, data: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

test("authenticated Stripe Checkout, signed webhook provisioning, and customer portal work end to end", async () => {
  const db = createDatabase(":memory:");
  const stripeCalls = [];
  const stripeFetch = async (url, init) => {
    stripeCalls.push({ url, parameters: Object.fromEntries(init.body) });
    const portal = url.includes("billing_portal");
    return new Response(JSON.stringify({ id: portal ? "bps_1" : "cs_1", url: portal ? "https://billing.stripe.test/portal" : "https://checkout.stripe.test/pay" }), { status: 200 });
  };
  const stripeConfig = { secretKey: "sk_test", webhookSecret: "whsec_route", proPriceId: "price_pro", appUrl: "https://edgelab.test" };
  const server = createEdgeLabServer({ db, stripeConfig, stripeFetch });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const registration = await request(base, "/api/auth/register", {
      method: "POST", body: { email: "stripe-route@example.com", displayName: "Stripe Route", password: "correct horse battery staple" }
    });
    const checkout = await request(base, "/api/billing/checkout", { method: "POST", cookie: registration.cookie });
    assert.equal(checkout.response.status, 201);
    assert.equal(checkout.data.session.url, "https://checkout.stripe.test/pay");
    const userId = stripeCalls[0].parameters.client_reference_id;

    const event = JSON.stringify({
      id: "evt_route_checkout", type: "checkout.session.completed",
      data: { object: { client_reference_id: userId, customer: "cus_route", subscription: "sub_route", metadata: {} } }
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = createHmac("sha256", stripeConfig.webhookSecret).update(`${timestamp}.${event}`).digest("hex");
    const webhook = await request(base, "/api/billing/stripe-webhook", {
      method: "POST", body: event, headers: { "stripe-signature": `t=${timestamp},v1=${signature}` }
    });
    assert.equal(webhook.response.status, 200);
    assert.equal(webhook.data.plan, "pro");
    const account = await request(base, "/api/account", { cookie: registration.cookie });
    assert.equal(account.data.account.plan, "pro");

    const portal = await request(base, "/api/billing/portal", { method: "POST", cookie: registration.cookie });
    assert.equal(portal.response.status, 201);
    assert.equal(portal.data.session.url, "https://billing.stripe.test/portal");
    assert.equal(stripeCalls[1].parameters.customer, "cus_route");
  } finally {
    server.close();
    await once(server, "close");
    db.close();
  }
});
