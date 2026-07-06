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
