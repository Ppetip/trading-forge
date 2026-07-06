import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function loadLocalEnv(filename = process.env.EDGELAB_ENV_FILE ?? ".env") {
  const path = resolve(filename);
  let text = "";
  try { text = readFileSync(path, "utf8"); } catch { return false; }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [rawName, ...rest] = trimmed.split("=");
    const name = rawName.trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(name) || process.env[name] !== undefined) continue;
    const rawValue = rest.join("=").trim();
    process.env[name] = rawValue.replace(/^(['"])(.*)\1$/, "$2");
  }
  return true;
}

loadLocalEnv();

