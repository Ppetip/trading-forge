import "./env.mjs";
import { createDatabase } from "./db.mjs";

const db = createDatabase();
try {
  await db.ready;
  const users = await db.prepare("SELECT COUNT(*) AS total FROM users").get();
  const reports = await db.prepare("SELECT COUNT(*) AS total FROM reports").get();
  console.log(JSON.stringify({ ok: true, dialect: db.dialect, users: Number(users.total), reports: Number(reports.total) }));
} finally {
  await db.close();
}
