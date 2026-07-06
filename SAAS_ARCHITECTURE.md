# EdgeLab Sellable MVP Architecture

## Runtime

- React/Vite frontend
- Node.js HTTP API
- Built-in SQLite database with WAL mode
- HttpOnly, SameSite session cookies
- Server-side ORB execution
- SHA-256 report caching over exact rules, engine version, and every OHLC candle
- One-time trial lifecycle and plan-gated Pine exports
- HMAC-verified billing-provider subscription events

## Local Development

Copy `.env.example` to `.env` or set the values in your shell. Run the API:

```powershell
pnpm dev:server
```

Run the frontend in a second terminal:

```powershell
pnpm dev
```

Open the Vite URL and use `#/saas`. Plans and authorized exports are at `#/plans`.

## Verification

```powershell
pnpm test:all
pnpm build
```

Frontend and server tests are separate because the API uses Node's built-in SQLite module.

## Implemented Sellable-MVP Boundaries

- Registration, login, logout, durable sessions, and account usage
- Free, trial, and pro plan records with monthly limits
- One-time 14-day trial activation
- Signed subscription lifecycle webhooks
- Strategy records with immutable version history
- Prompt-to-rules parsing that reports assumptions
- Server-calculated ORB backtests
- Private/public report visibility model
- Exact-input report cache reuse
- Saved report history
- Server-authorized, plan-limited Pine exports
- Admin usage and product metrics API

## Billing Webhook Contract

Send `POST /api/billing/webhook` with the raw JSON body. Set `x-edgelab-signature` to the hexadecimal HMAC-SHA256 digest of that raw body using `EDGELAB_BILLING_WEBHOOK_SECRET`.

Supported event:

```json
{
  "type": "subscription.updated",
  "data": {
    "userId": "internal-user-id",
    "plan": "pro",
    "status": "active",
    "customerId": "provider-customer-id",
    "subscriptionId": "provider-subscription-id",
    "currentPeriodEndsAt": "2026-08-01T00:00:00.000Z"
  }
}
```

The browser cannot modify plans directly. A verified webhook is required.

## Production Requirements

Before charging customers:

1. Put the API behind HTTPS and set `NODE_ENV=production`.
2. Connect checkout/customer-portal endpoints from the selected billing provider.
3. Replace internal user IDs in provider metadata only through trusted checkout creation.
4. Add webhook replay protection and persist provider event IDs.
5. Replace SQLite with managed PostgreSQL when write concurrency requires it.
6. Add email verification, password reset, session revocation, CSRF defense, and rate limits.
7. Connect licensed market-data adapters and record provider/version metadata in fingerprints.
8. Connect an AI provider behind the parser boundary with per-user cost accounting.
9. Move large uploads to object storage and long work to background jobs.
10. Add structured logs, monitoring, backups, and migrations.

The Pro checkout button remains disabled until a real provider is configured. The interface does not imply that payments are currently active.
