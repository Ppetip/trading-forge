import { randomUUID } from "node:crypto";
import { parseCookies, readSession } from "./auth.mjs";
import { badRequest } from "./validation.mjs";

export const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin"
};

export function send(response, status, body, headers = {}) {
  response.writeHead(status, { ...jsonHeaders, ...headers });
  response.end(status === 204 ? undefined : JSON.stringify(body));
}

export async function readJson(request, limit = 25 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large.");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
}

export async function requireAuth(request, db) {
  const token = parseCookies(request.headers.cookie).edgelab_session;
  const account = await readSession(db, token);
  if (!account) {
    const error = new Error("Authentication required.");
    error.status = 401;
    error.code = "AUTH_REQUIRED";
    throw error;
  }
  return account;
}

export function requestId(response) {
  const id = randomUUID();
  response.setHeader("x-request-id", id);
  return id;
}

export function routeError(response, error, id) {
  const status = Number(error.status) || 500;
  if (status >= 500) console.error(`[${id}]`, error);
  send(response, status, {
    error: {
      code: error.code ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
      message: status >= 500 && !error.code ? "An internal server error occurred." : error.message,
      details: error.details
    }
  });
}

