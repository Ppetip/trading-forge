# EdgeLab launch readiness audit

Last updated: 2026-07-06

This file tracks the minimum gates for taking EdgeLab / Trading Forge from a local research prototype to a hosted product that users can trust.

## Production promise

EdgeLab should never present a backtest as verified evidence unless all of these are true:

- The strategy is in an executable, supported rule schema.
- The server engine supports that exact strategy family.
- The data source, provider symbol, timezone, date range, and cache identity are known.
- The run has a `BacktestAudit` with no critical validation failures.
- The user plan allows the requested data source, lookback, tool, and export.
- Failed, unsupported, legacy, or metadata-missing runs are labeled as such.

## Hardened in this pass

- Subscription schema now supports every configured plan tier: `free`, `starter`, `trial`, `pro`, and `power`.
- Existing SQLite databases with the older `free/trial/pro` subscription check are migrated in place.
- AI report review/game-plan usage is now server-side gated and counted with `ai_report_review`.
- Report AI plan-limit failures now open the same dismissible paywall modal as other paid actions.
- Admin data-spend controls are enforced inside the market-data router:
  - disable Databento fresh runs
  - cached-Databento-only mode
  - disable Yahoo/research provider
  - force daily candles
  - force futures proxy mode
  - disable long windows
- Oversized uploaded candle payloads are rejected before the engine runs.
- Route-specific JSON body limits replace the previous broad default.
- Production mode can serve the built React app from `dist` on the same origin as `/api`.
- The configured admin email can become admin during registration, not only at DB boot.

## Verification already covered by tests

- Register, authenticate, run backtest, save report, and reuse exact cache.
- Free user limits.
- Trial/pro entitlement behavior.
- Private/public report access.
- Unsupported/unsafe data windows producing explicit warnings instead of fake reports.
- Same-origin write protection.
- Login cooldown after failed attempts.
- Admin-only data kill switches.
- ORB known-answer tests:
  - no breakout = zero trades
  - long target = +3R
  - long stop = -1R
  - short target = +3R
  - short stop = -1R
  - first chronological breakout wins
  - same-candle stop/target conflicts counted ambiguous
  - 9:30 New York timezone conversion
  - cache key changes for ORB start time and reward/risk

## Commands run

```powershell
node --test server\*.test.mjs
node_modules\.bin\vitest run
node_modules\.bin\tsc --noEmit -p tsconfig.app.json
node_modules\.bin\vite build
```

Result: all tests and type/build checks passed. Vite still reports a non-blocking bundle-size warning for the main app chunk.

## Launch gates still worth doing before real money traffic

1. Add persistent hosting for SQLite, `data/market-cache`, and provider raw metadata. Do not deploy this on an ephemeral filesystem unless reports and market cache are intentionally disposable.
2. Put the Node server behind HTTPS with one canonical app origin. Set `NODE_ENV=production`, `EDGELAB_ADMIN_EMAIL`, `EDGELAB_DB_PATH`, and secret values from the host secret manager.
3. Add production monitoring for:
   - failed backtests by code
   - data provider failures
   - premium data cache misses
   - Stripe webhook failures
   - login throttling
   - 5xx rate
4. Add a real backup/restore procedure for the SQLite database and market cache.
5. Add e2e browser tests against the deployed URL for:
   - signup/login
   - run one free research-grade test
   - paywall modal on premium actions
   - public report share
   - private report rejection
   - admin data controls
6. Add stricter Content Security Policy once third-party scripts and payment redirects are final.
7. Code-split the front-end routes if bundle size becomes a load-time problem.

## Deployment notes

For same-origin deployment, build the web app first and run the API server in production:

```powershell
node_modules\.bin\vite build
$env:NODE_ENV = "production"
$env:EDGELAB_STATIC_DIR = "dist"
$env:EDGELAB_ADMIN_EMAIL = "Phillip.petiprin@gmail.com"
node server\server.mjs
```

The server will serve `/api/*` as JSON routes and non-API paths from the built React app.

