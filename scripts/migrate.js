import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const schemaPath = path.join(__dirname, "..", "src", "db", "schema.sql");
  const sql = fs.readFileSync(schemaPath, "utf8");
  console.log("[migrate] applying schema.sql ...");
  await pool.query(sql);
  console.log("[migrate] done.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
