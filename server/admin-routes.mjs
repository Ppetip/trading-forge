import { requireAuth, readJson, send } from "./http.mjs";
import { comprehensiveAdminMetrics } from "./admin-metrics.mjs";
import { requireAdmin, updateDataControls } from "./admin-controls.mjs";

export async function handleAdminRoutes({ pathname, method, request, response, db }) {
  if (pathname === "/api/admin/metrics" && method === "GET") {
    requireAdmin(await requireAuth(request, db));
    send(response, 200, { metrics: await comprehensiveAdminMetrics(db) }); return true;
  }
  if (pathname === "/api/admin/data-controls" && method === "PATCH") {
    const account = requireAdmin(await requireAuth(request, db));
    const controls = await updateDataControls(db, account, await readJson(request, 64 * 1024));
    send(response, 200, { controls }); return true;
  }
  return false;
}
