import "./env.mjs";
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
import { parseStrategyPromptWithOpenRouter } from "./openrouter-parser.mjs";
import { accountView, createStrategy, createStrategyVersion, listPublicReports, listReports, listStrategies, publicReportDetail, reportDetail, resolveOrbBacktest, strategyDetail, updateReportVisibility } from "./services.mjs";
import { assertUsage, recordUsage } from "./plans.mjs";
import { cleanEmail, cleanName, requireObject, badRequest } from "./validation.mjs";
import { ORB_ENGINE_VERSION } from "./orb-engine.mjs";
import { generateOrbPine } from "./pine-export.mjs";
import { applySubscriptionEvent, startTrial, verifyWebhook } from "./billing.mjs";
import { createTranscriptSource, listTranscriptSources } from "./transcripts.mjs";
import { resolveDailyLevelBacktest } from "./daily-level-service.mjs";
import { handleStripeBilling } from "./stripe-routes.mjs";
import { routeMarketData } from "./market-data-router.mjs";
import { enforceRateLimit, enforceSameOrigin, assertLoginAllowed, recordLoginFailure, clearLoginFailures } from "./security.mjs";
import { auditEvent } from "./admin-controls.mjs";
import { handleAdminRoutes } from "./admin-routes.mjs";
import { reviewReportWithOpenRouter } from "./openrouter-review.mjs";
import { classifyPreflight } from "./preflight-classifier.mjs";

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
  aiParser = parseStrategyPromptWithOpenRouter,
  marketDataRouter = routeMarketData,
  preflightClassifier = classifyPreflight,
  enableAdminApi = process.env.EDGELAB_ENABLE_ADMIN_API === "true",
  staticDir = process.env.EDGELAB_STATIC_DIR ? resolve(process.env.EDGELAB_STATIC_DIR) : process.env.NODE_ENV === "production" ? resolve("dist") : null
} = {}) {
  return createServer(async (request, response) => {
    const id = requestId(response);
    try {
      await db.ready;
      const url = new URL(request.url, "http://localhost"), method = request.method ?? "GET";
      enforceSameOrigin(request);
      if (method === "OPTIONS") return send(response, 204, {});
      if (url.pathname === "/api/health" && method === "GET") return send(response, 200, { ok: true, service: "edgelab-api", engineVersion: ORB_ENGINE_VERSION });
      const publicReportRoute = url.pathname.match(/^\/api\/public\/reports\/([^/]+)$/);
      if (publicReportRoute && method === "GET") {
        const report = await publicReportDetail(db, publicReportRoute[1]);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Public report not found." } });
      }

      if (url.pathname === "/api/public/reports" && method === "GET") return send(response, 200, { reports: await listPublicReports(db) });

      if (url.pathname === "/api/auth/register" && method === "POST") {
        enforceRateLimit(request, "auth");
        const body = requireObject(await readJson(request, JSON_LIMITS.auth));
        const email = cleanEmail(body.email), displayName = cleanName(body.displayName), passwordHash = await hashPassword(body.password);
        const configuredAdmin = String(process.env.EDGELAB_ADMIN_EMAIL ?? "").trim().toLowerCase();
        const role = configuredAdmin && email.toLowerCase() === configuredAdmin && !await db.prepare("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1").get() ? "admin" : "user";
        const userId = randomUUID(), createdAt = now();
        try {
          await transaction(db, async () => {
            await db.prepare("INSERT INTO users (id, email, password_hash, display_name, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(userId, email, passwordHash, displayName, role, createdAt, createdAt);
            await db.prepare("INSERT INTO subscriptions (user_id, plan, status, updated_at) VALUES (?, 'free', 'active', ?)").run(userId, createdAt);
          });
        } catch (error) {
          if (String(error.message).includes("UNIQUE")) throw badRequest("An account already exists for this email.", "EMAIL_EXISTS");
          throw error;
        }
        const session = await createSession(db, userId);
        return send(response, 201, { user: { id: userId, email, displayName, plan: "free" } }, { "set-cookie": sessionCookie(session.token, session.expires, secureCookies) });
      }
      if (url.pathname === "/api/auth/login" && method === "POST") {
        enforceRateLimit(request, "auth");
        const body = requireObject(await readJson(request, JSON_LIMITS.auth)), email = cleanEmail(body.email);
        await assertLoginAllowed(db, email);
        const user = await db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (!user || !await verifyPassword(body.password, user.password_hash)) {
          await recordLoginFailure(db, email);
          const error = new Error("Invalid email or password."); error.status = 401; error.code = "INVALID_CREDENTIALS"; throw error;
        }
        await clearLoginFailures(db, email);
        const session = await createSession(db, user.id);
        return send(response, 200, { user: { id: user.id, email: user.email, displayName: user.display_name } }, { "set-cookie": sessionCookie(session.token, session.expires, secureCookies) });
      }
      if (url.pathname === "/api/auth/logout" && method === "POST") {
        const token = parseCookies(request.headers.cookie).edgelab_session;
        if (token) await db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash(token));
        return send(response, 200, { ok: true }, { "set-cookie": clearSessionCookie(secureCookies) });
      }
      if (url.pathname === "/api/account" && method === "GET") return send(response, 200, { account: await accountView(db, await requireAuth(request, db)) });
      if (await handleStripeBilling({ pathname: url.pathname, method, request, response, db, stripeConfig, stripeFetch })) return;
      if (url.pathname === "/api/billing/trial" && method === "POST") {
        const account = await requireAuth(request, db), trial = await startTrial(db, account);
        await recordUsage(db, account.id, "trial_started", { trialEndsAt: trial.trialEndsAt });
        return send(response, 201, { trial });
      }
      if (url.pathname === "/api/billing/webhook" && method === "POST") {
        const raw = await readRaw(request, JSON_LIMITS.billing);
        verifyWebhook(raw, request.headers["x-edgelab-signature"], billingSecret);
        let event;
        try { event = JSON.parse(raw.toString("utf8")); } catch { throw badRequest("Billing webhook body must be valid JSON."); }
        return send(response, 200, await applySubscriptionEvent(db, event));
      }
      if (url.pathname === "/api/ai/parse-rules" && method === "POST") {
        enforceRateLimit(request, "ai");
        const account = await requireAuth(request, db), body = requireObject(await readJson(request, JSON_LIMITS.ai));
        const preflight = await preflightClassifier(body.prompt, { defaults: body.defaults });
        await recordUsage(db, account.id, "prompt_preflight", { inputTier: preflight.inputTier, nextWorkflowTier: preflight.nextWorkflowTier, confidence: preflight.confidence, fallbackUsed: preflight.fallbackUsed });
        if (!preflight.shouldRunFullParser) {
          const error = new Error("This prompt needs clarification or a different workflow before strategy parsing.");
          error.status = 422;
          error.code = "PREFLIGHT_NOT_PARSEABLE";
          error.details = { preflight };
          throw error;
        }
        const parsed = await aiParser(body.prompt, body.defaults);
        await recordUsage(db, account.id, "prompt_parse", { parser: parsed.parser, preflight: { inputTier: preflight.inputTier, confidence: preflight.confidence } });
        return send(response, 200, parsed);
      }
      if (url.pathname === "/api/ai/preflight-classify" && method === "POST") {
        enforceRateLimit(request, "ai");
        const account = await requireAuth(request, db), body = requireObject(await readJson(request, JSON_LIMITS.ai));
        const preflight = await preflightClassifier(body.prompt, { defaults: body.defaults });
        await recordUsage(db, account.id, "prompt_preflight", { inputTier: preflight.inputTier, nextWorkflowTier: preflight.nextWorkflowTier, confidence: preflight.confidence, fallbackUsed: preflight.fallbackUsed });
        return send(response, 200, { preflight });
      }
      if (url.pathname === "/api/transcripts" && method === "GET") {
        const account = await requireAuth(request, db);
        return send(response, 200, { sources: await listTranscriptSources(db, account.id) });
      }
      if (url.pathname === "/api/transcripts" && method === "POST") {
        const account = await requireAuth(request, db);
        return send(response, 201, { source: await createTranscriptSource(db, account, requireObject(await readJson(request, JSON_LIMITS.transcript))) });
      }
      if (url.pathname === "/api/strategies" && method === "GET") {
        const account = await requireAuth(request, db);
        return send(response, 200, { strategies: await listStrategies(db, account.id) });
      }
      if (url.pathname === "/api/strategies" && method === "POST") {
        const account = await requireAuth(request, db);
        return send(response, 201, { strategy: await createStrategy(db, account, requireObject(await readJson(request, JSON_LIMITS.strategy))) });
      }
      const versionsRoute = url.pathname.match(/^\/api\/strategies\/([^/]+)\/versions$/);
      if (versionsRoute && method === "POST") {
        const account = await requireAuth(request, db), version = await createStrategyVersion(db, account, versionsRoute[1], requireObject(await readJson(request, JSON_LIMITS.strategy)));
        return version ? send(response, 201, { version }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Strategy not found." } });
      }
      const strategyRoute = url.pathname.match(/^\/api\/strategies\/([^/]+)$/);
      if (strategyRoute && method === "GET") {
        const account = await requireAuth(request, db), detail = await strategyDetail(db, account.id, strategyRoute[1]);
        return detail ? send(response, 200, detail) : send(response, 404, { error: { code: "NOT_FOUND", message: "Strategy not found." } });
      }
      if (url.pathname === "/api/backtests/orb" && method === "POST") return await backtestResponse(request, response, db, resolveOrbBacktest, marketDataRouter);
      if (url.pathname === "/api/backtests/daily-level" && method === "POST") return await backtestResponse(request, response, db, resolveDailyLevelBacktest, marketDataRouter);
      if (url.pathname === "/api/reports" && method === "GET") {
        const account = await requireAuth(request, db);
        return send(response, 200, { reports: await listReports(db, account.id) });
      }
      const aiReviewRoute = url.pathname.match(/^\/api\/reports\/([^/]+)\/ai-review$/);
      if (aiReviewRoute && method === "POST") {
        enforceRateLimit(request, "ai");
        const account = await requireAuth(request, db), report = await reportDetail(db, account, aiReviewRoute[1]);
        if (!report) return send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
        await assertUsage(db, account, "ai_report_review", "aiReportReviews");
        const body = requireObject(await readJson(request, JSON_LIMITS.reportAction));
        const review = await reviewReportWithOpenRouter(report, { mode: body.mode === "plan" ? "plan" : "review", question: body.question });
        await recordUsage(db, account.id, "ai_report_review", { reportId: report.id, mode: review.mode, model: review.model });
        return send(response, 200, { review });
      }      const pineRoute = url.pathname.match(/^\/api\/reports\/([^/]+)\/pine$/);
      if (pineRoute && method === "POST") {
        const account = await requireAuth(request, db);
        await assertUsage(db, account, "pine_export", "pineExports");
        const report = await reportDetail(db, account, pineRoute[1]);
        if (!report) return send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
        if (report.rules.strategyType !== "opening_range_breakout") throw badRequest("Only ORB report exports are currently available.");
        const script = generateOrbPine(report.rules);
        await recordUsage(db, account.id, "pine_export", { reportId: report.id });
        return send(response, 200, { filename: `${String(report.rules.name).replace(/\W+/g, "-").toLowerCase()}.pine`, script });
      }
      const reportRoute = url.pathname.match(/^\/api\/reports\/([^/]+)$/);
      if (reportRoute && method === "GET") {
        const account = await requireAuth(request, db), report = await reportDetail(db, account, reportRoute[1]);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
      }
      if (reportRoute && method === "PATCH") {
        const account = await requireAuth(request, db), body = requireObject(await readJson(request, JSON_LIMITS.reportAction)), report = await updateReportVisibility(db, account.id, reportRoute[1], body.visibility);
        return report ? send(response, 200, { report }) : send(response, 404, { error: { code: "NOT_FOUND", message: "Report not found." } });
      }
      if (enableAdminApi && await handleAdminRoutes({ pathname: url.pathname, method, request, response, db })) return;
      if (await serveStaticApp({ request, response, url, method, staticDir })) return;
      return send(response, 404, { error: { code: "NOT_FOUND", message: "API route not found." } });
    } catch (error) {
      routeError(response, error, id);
    }
  });
}

async function backtestResponse(request, response, db, resolver, marketDataRouter) {
  enforceRateLimit(request, "backtest");
  const account = await requireAuth(request, db);
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
    await recordUsage(db, account.id, "backtest_failed", { code: error.code ?? "ERROR" });
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








