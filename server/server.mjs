import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { extname, join, resolve, sep } from "node:path";
import { createDatabase, transaction } from "./db.mjs";
import { clearSessionCookie, createSession, hashPassword, parseCookies, sessionCookie, tokenHash, verifyPassword } from "./auth.mjs";
import { readJson, requestId, requireAuth, routeError, send } from "./http.mjs";
import { parseStrategyPrompt } from "./prompt-parser.mjs";
import { parseStrategyPromptWithOllama } from "./ollama-parser.mjs";
import { accountView, createStrategy, createStrategyVersion, listPublicReports, listReports, listStrategies, publicReportDetail, reportDetail, resolveOrbBacktest, strategyDetail, updateReportVisibility } from "./services.mjs";
import { assertUsage, recordUsage } from "./plans.mjs";
import { cleanEmail, cleanName, requireObject, badRequest } from "./validation.mjs";
import { ORB_ENGINE_VERSION } from "./orb-engine.mjs";
import { generateOrbPine } from "./pine-export.mjs";
import { applySubscriptionEvent, startTrial, verifyWebhook } from "./billing.mjs";
import { createTranscriptSource, listTranscriptSources } from "./transcripts.mjs";
import { comprehensiveAdminMetrics } from "./admin-metrics.mjs";
import { resolveDailyLevelBacktest } from "./daily-level-service.mjs";
import { handleStripeBilling } from "./stripe-routes.mjs";
import { routeMarketData } from "./market-data-router.mjs";
import { enforceRateLimit, enforceSameOrigin, assertLoginAllowed, recordLoginFailure, clearLoginFailures } from "./security.mjs";
import { auditEvent } from "./admin-controls.mjs";
import { handleAdminRoutes } from "./admin-routes.mjs";
import { reviewReportWithOllama } from "./ollama-review.mjs";

const now = () => new Date().toISOString();
const JSON_LIMITS = Object.freeze({
  auth: 32 * 1024,
  ai: 96 * 1024,
  transcript: 384 * 1024,
  strategy: 512 * 1024,
  backtest: 10 * 1024 * 1024,
  billing: 1024 * 1024,
  reportAction: 32 * 1024
});
const MAX_UPLOADED_CANDLES = 250_000;
const STATIC_TYPES = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon"
});
async function readRaw(request, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) { const error = new Error("Request body is too large."); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createEdgeLabServer({
  db = createDatabase(),
  secureCookies = process.env.NODE_ENV === "production",
  billingSecret = process.env.EDGELAB_BILLING_WEBHOOK_SECRET,
  stripeConfig,
  stripeFetch,
  aiParser = parseStrategyPromptWithOllama,
  marketDataRouter = routeMarketData,
  staticDir = process.env.EDGELAB_STATIC_DIR ? resolve(process.env.EDGELAB_STATIC_DIR) : process.env.NODE_ENV === "production" ? resolve("dist") : null
} = {}) {
  return createServer(async (request, response) => {
    const id = requestId(response);
    try {
      const url = new URL(request.url, "http://localhost"), method = request.method ?? "GET";
      enforceSameOrigin(request);
      if (method === "OPTIONS") return send(response, 204, {});
      if (url.pathname === "/api/health" && method === "GET") return send(response, 200, { ok: true, service: "edgelab-api", engineVersion: ORB_ENGINE_VERSION });
      const publicReportRoute = url.pathname.match(/^\/api\/public\/reports\/([^/]+)$/);
      if (publicReportRoute && method === "GET") {
        const report = publicReportDetail(db, publicReportRoute[1]);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Public report not found." } });
      }

      if (url.pathname === "/api/public/reports" && method === "GET") return send(response, 200, { reports: listPublicReports(db) });

      if (url.pathname === "/api/auth/register" && method === "POST") {
        enforceRateLimit(request, "auth");
        const body = requireObject(await readJson(request, JSON_LIMITS.auth));
        const email = cleanEmail(body.email), displayName = cleanName(body.displayName), passwordHash = await hashPassword(body.password);
        const configuredAdmin = String(process.env.EDGELAB_ADMIN_EMAIL ?? "").trim().toLowerCase();
        const role = configuredAdmin && email.toLowerCase() === configuredAdmin && !db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() ? "admin" : "user";
        const userId = randomUUID(), createdAt = now();
        try {
          transaction(db, () => {
            db.prepare("INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, email, passwordHash, displayName, role, createdAt, createdAt);
            db.prepare("INSERT INTO subscriptions (user_id, plan, status, updated_at) VALUES (?, 'free', 'active', ?)").run(userId, createdAt);
          });
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) throw badRequest("An account already exists for this email.", "EMAIL_EXISTS");
          throw error;
        }
        const session = createSession(db, userId);
        return send(response, 201, { user: { id: userId, email, displayName, plan: "free" } }, { "set-cookie": sessionCookie(session.token, session.expires, secureCookies) });
      }
      if (url.pathname === "/api/auth/login" && method === "POST") {
        enforceRateLimit(request, "auth");
        const body = requireObject(await readJson(request, JSON_LIMITS.auth)), email = cleanEmail(body.email);
        assertLoginAllowed(db, email);
        const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user || !await verifyPassword(body.password, user.password_hash)) {
          recordLoginFailure(db, email);
          const error = new Error("Invalid email or password."); error.status = 401; error.code = "INVALID_CREDENTIALS"; throw error;
        }
        clearLoginFailures(db, email);
        const session = createSession(db, user.id);
        return send(response, 200, { user: { id: user.id, email: user.email, displayName: user.display_name } }, { "set-cookie": sessionCookie(session.token, session.expires, secureCookies) });
      }
      if (url.pathname === "/api/auth/logout" && method === "POST") {
        const token = parseCookies(request.headers.cookie).edgelab_session;
        if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
        return send(response, 200, { ok: true }, { "set-cookie": clearSessionCookie(secureCookies) });
      }
      if (url.pathname === "/api/account" && method === "GET") return send(response, 200, { account: accountView(db, requireAuth(request, db)) });
      if (await handleStripeBilling({ pathname: url.pathname, method, request, response, db, stripeConfig, stripeFetch })) return;
      if (url.pathname === "/api/billing/trial" && method === "POST") {
        const account = requireAuth(request, db), trial = startTrial(db, account);
        recordUsage(db, account.id, "trial_started", { trialEndsAt: trial.trialEndsAt });
        return send(response, 201, { trial });
      }
      if (url.pathname === "/api/billing/webhook" && method === "POST") {
        const raw = await readRaw(request, JSON_LIMITS.billing);
        verifyWebhook(raw, request.headers["x-edgelab-signature"], billingSecret);
        let event;
        try { event = JSON.parse(raw.toString("utf8")); } catch { throw badRequest("Billing webhook body must be valid JSON."); }
        return send(response, 200, applySubscriptionEvent(db, event));
      }
      if (url.pathname === "/api/ai/parse-rules" && method === "POST") {
        enforceRateLimit(request, "ai");
        const account = requireAuth(request, db), body = requireObject(await readJson(request, JSON_LIMITS.ai)), parsed = await aiParser(body.prompt, body.defaults);
        recordUsage(db, account.id, "prompt_parse", { parser: parsed.parser });
        return send(response, 200, parsed);
      }
      if (url.pathname === "/api/transcripts" && method === "GET") {
        const account = requireAuth(request, db);
        return send(response, 200, { sources: listTranscriptSources(db, account.id) });
      }
      if (url.pathname === "/api/transcripts" && method === "POST") {
        const account = requireAuth(request, db);
        return send(response, 201, { source: createTranscriptSource(db, account, requireObject(await readJson(request, JSON_LIMITS.transcript))) });
      }
      if (url.pathname === "/api/strategies" && method === "GET") {
        const account = requireAuth(request, db);
        return send(response, 200, { strategies: listStrategies(db, account.id) });
      }
      if (url.pathname === "/api/strategies" && method === "POST") {
        const account = requireAuth(request, db);
        return send(response, 201, { strategy: createStrategy(db, account, requireObject(await readJson(request, JSON_LIMITS.strategy))) });
      }
      const versionsRoute = url.pathname.match(/^\/api\/strategies\/([^/]+)\/versions$/);
      if (versionsRoute && method === "POST") {
        const account = requireAuth(request, db), version = createStrategyVersion(db, account, versionsRoute[1], requireObject(await readJson(request, JSON_LIMITS.strategy)));
        return version ? send(response, 201, { version }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Strategy not found." } });
      }
      const strategyRoute = url.pathname.match(/^\/api\/strategies\/([^/]+)$/);
      if (strategyRoute && method === "GET") {
        const account = requireAuth(request, db), detail = strategyDetail(db, account.id, strategyRoute[1]);
        return detail ? send(response, 200, detail) : send(response, 404, { error: { code: "NOT_FOUND", message: "Strategy not found." } });
      }
      if (url.pathname === "/api/backtests/orb" && method === "POST") return await backtestResponse(request, response, db, resolveOrbBacktest, marketDataRouter);
      if (url.pathname === "/api/backtests/daily-level" && method === "POST") return await backtestResponse(request, response, db, resolveDailyLevelBacktest, marketDataRouter);
      if (url.pathname === "/api/reports" && method === "GET") {
        const account = requireAuth(request, db);
        return send(response, 200, { reports: listReports(db, account.id) });
      }
      const aiReviewRoute = url.pathname.match(/^\/api\/reports\/([^/]+)\/ai-review$/);
      if (aiReviewRoute && method === "POST") {
        enforceRateLimit(request, "ai");
        const account = requireAuth(request, db), report = reportDetail(db, account, aiReviewRoute[1]);
        if (!report) return send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
        assertUsage(db, account, "ai_report_review", "aiReportReviews");
        const body = requireObject(await readJson(request, JSON_LIMITS.reportAction));
        const review = await reviewReportWithOllama(report, { mode: body.mode === "plan" ? "plan" : "review", question: body.question });
        recordUsage(db, account.id, "ai_report_review", { reportId: report.id, mode: review.mode, model: review.model });
        return send(response, 200, { review });
      }      const pineRoute = url.pathname.match(/^\/api\/reports\/([^/]+)\/pine$/);
      if (pineRoute && method === "POST") {
        const account = requireAuth(request, db);
        assertUsage(db, account, "pine_export", "pineExports");
        const report = reportDetail(db, account, pineRoute[1]);
        if (!report) return send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
        if (report.rules.strategyType !== "opening_range_breakout") throw badRequest("Only ORB report exports are currently available.");
        const script = generateOrbPine(report.rules);
        recordUsage(db, account.id, "pine_export", { reportId: report.id });
        return send(response, 200, { filename: `${String(report.rules.name).replace(/\W+/g, "-").toLowerCase()}.pine`, script });
      }
      const reportRoute = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (reportRoute && method === "GET") {
        const account = requireAuth(request, db), report = reportDetail(db, account, reportRoute[1]);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
      }
      if (reportRoute && method === "PATCH") {
        const account = requireAuth(request, db), body = requireObject(await readJson(request, JSON_LIMITS.reportAction)), report = updateReportVisibility(db, account.id, reportRoute[1], body.visibility);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
      }
      if (url.pathname === "/api/admin/metrics" && method === "GET") {
        const account = requireAuth(request, db);
        if (account.role !== "admin") return send(response, 403, { error: { code: "FORBIDDEN", message: "Admin access required." } });
        return send(response, 200, { metrics: comprehensiveAdminMetrics(db) });
      }
      if (await handleAdminRoutes({ pathname: url.pathname, method, request, response, db })) return;
      if (await serveStaticApp({ request, response, url, method, staticDir })) return;
      return send(response, 404, { error: { code: "NOT_FOUND", message: "API route not found." } });
    } catch (error) {
      routeError(response, error, id);
    }
  });
}

async function backtestResponse(request, response, db, resolver, marketDataRouter) {
  enforceRateLimit(request, "backtest");
  const account = requireAuth(request, db);
  try {
    const body = requireObject(await readJson(request, JSON_LIMITS.backtest));
    if (Array.isArray(body.candles) && body.candles.length > MAX_UPLOADED_CANDLES) {
      const error = new Error(`Uploaded candle sets are limited to ${MAX_UPLOADED_CANDLES.toLocaleString()} rows per request. Split the file or use market-data routing.`);
      error.status = 413;
      error.code = "UPLOAD_CANDLES_TOO_LARGE";
      error.details = { limit: MAX_UPLOADED_CANDLES, received: body.candles.length };
      throw error;
    }
    const routed = await marketDataRouter({ db, account, rules: body.rules, candles: body.candles, preferredProvider: body.dataProvider });
    body.candles = routed.candles;
    body.dataProvenance = routed.dataProvenance;
    const resolved = await resolver(db, account, body);
    return send(response, resolved.status, { cached: resolved.cached, report: resolved.report, dataProvenance: body.dataProvenance });
  } catch (error) {
    recordUsage(db, account.id, "backtest_failed", { code: error.code ?? "ERROR" });
    throw error;
  }
}

async function serveStaticApp({ response, url, method, staticDir }) {
  if (!staticDir || !["GET", "HEAD"].includes(method) || url.pathname.startsWith("/api/")) return false;
  const root = resolve(staticDir);
  const pathname = decodeURIComponent(url.pathname);
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let target = resolve(root, relative);
  if (target !== root && !target.startsWith(`${root}${sep}`)) return false;
  try {
    const info = await stat(target);
    if (info.isDirectory()) target = join(target, "index.html");
  } catch {
    target = join(root, "index.html");
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) return false;
    const type = STATIC_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
    const cache = target.endsWith("index.html") ? "no-store" : "public, max-age=31536000, immutable";
    response.writeHead(200, { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff", "referrer-policy": "same-origin" });
    if (method === "HEAD") {
      response.end();
      return true;
    }
    createReadStream(target).pipe(response);
    return true;
  } catch {
    return false;
  }
}

export function startServer(options = {}) {
  const port = Number(options.port ?? process.env.PORT ?? 8787), host = options.host ?? process.env.HOST ?? "127.0.0.1";
  const server = createEdgeLabServer(options);
  server.listen(port, host, () => console.log(`EdgeLab API listening on http://${host}:${port}`));
  return server;
}
const isEntry = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isEntry) startServer();







