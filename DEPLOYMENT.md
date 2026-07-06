# EdgeLab Deployment

## Required configuration

Create a `.env` file that is never committed:

```dotenv
EDGELAB_APP_URL=https://your-edgelab-domain.example
EDGELAB_HTTP_PORT=8080
STRIPE_SECRET_KEY=replace_with_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_replace_me
STRIPE_PRO_PRICE_ID=price_replace_me
```

`EDGELAB_APP_URL` must be the public HTTPS origin with no trailing slash. Checkout and portal return URLs are derived only from this server configuration, not from browser input.

## Stripe setup

1. Create a recurring Pro product and price in Stripe.
2. Set its price identifier as `STRIPE_PRO_PRICE_ID`.
3. Register `https://your-domain/api/billing/stripe-webhook` as a Stripe webhook.
4. Subscribe it to:
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
5. Store the endpoint signing secret as `STRIPE_WEBHOOK_SECRET`.
6. Enable and configure the Stripe customer portal.
7. Complete a test-mode Checkout, portal, renewal-status, failed-payment, and cancellation pass before using live keys.

Stripe requires raw request bodies for signature verification. EdgeLab verifies the timestamped `Stripe-Signature`, rejects signatures older than five minutes, and stores processed event IDs so retries are idempotent.

Official references:

- [Stripe Checkout Sessions](https://docs.stripe.com/api/checkout/sessions)
- [Stripe customer portal sessions](https://docs.stripe.com/api/customer_portal/sessions)
- [Stripe webhook signatures](https://docs.stripe.com/webhooks/signature)
- [Subscription lifecycle webhooks](https://docs.stripe.com/billing/subscriptions/webhooks)

## Start

```powershell
docker compose config
docker compose build
docker compose up -d
docker compose ps
```

The web container listens on `EDGELAB_HTTP_PORT` and proxies `/api` to the API container. Put the deployment behind an HTTPS load balancer or reverse proxy and forward the public hostname.

## Render

Use `render.yaml` as the blueprint when possible. It pins pnpm through `npx` so Render does not try to overwrite the read-only system pnpm binary.

If configuring the Render service manually, use:

```text
Runtime: Node
Build Command: CI=true npx --yes pnpm@9.15.9 install --frozen-lockfile && npx --yes pnpm@9.15.9 build
Start Command: node server/server.mjs
Health Check Path: /api/health
```

Required Render environment variables:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
EDGELAB_STATIC_DIR=dist
EDGELAB_DB_PATH=/opt/render/project/src/data/edgelab.sqlite
EDGELAB_DB_DRIVER=postgres
DATABASE_URL=<Neon Postgres connection string>
MARKET_DATA_CACHE_PATH=/opt/render/project/src/data/market-cache
EDGELAB_ENABLE_ADMIN_API=false
```

With `DATABASE_URL` present and `EDGELAB_DB_DRIVER=postgres`, the app uses Neon Postgres for accounts, sessions, reports, billing, usage events, transcripts, and admin settings. Keep a persistent disk mounted at `/opt/render/project/src/data` for the market-data cache. Set `EDGELAB_DB_DRIVER=sqlite` only for local SQLite fallback. Do not use `corepack enable`, `npm install -g pnpm`, or `pnpm add -g pnpm` in Render build commands; those can fail with `EROFS: read-only file system, unlink '/usr/bin/pnpm'`.

## Admin operations

Do not deploy the admin UI with the customer-facing web app. The default public build only emits `dist/index.html`, and the default API leaves `/api/admin/*` disabled.

For trusted local operations, run a separate admin API process and admin web entry against the configured database:

```powershell
pnpm server:admin
pnpm dev:admin
```

Only set `EDGELAB_ENABLE_ADMIN_API=true` on that trusted ops process. Keep it unset or `false` for public hosting.

## Persistence and operations

- SQLite data is stored in the named `edgelab_data` volume.
- Back up the volume and test restores before accepting customers.
- Run only one API replica while SQLite is the write store.
- Move to managed PostgreSQL before horizontal API scaling.
- Monitor `/api/health`, container restarts, Stripe webhook failures, disk use, and backup age.
- Rotate Stripe and internal webhook secrets after any suspected disclosure.

## Verification gate

```powershell
pnpm test:all
pnpm build
docker compose config
```

Do not charge customers until HTTPS, backups, Stripe test-mode lifecycle checks, and monitoring are all verified in the target environment.
