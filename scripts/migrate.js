import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../src/database.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "database", "migrations");

const files = (await fs.readdir(migrationsDir))
  .filter((name) => name.endsWith(".sql"))
  .sort();

const pool = getPool();

try {
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    console.log(`Running ${file}`);
    await pool.query(sql);
  }
  console.log("Database migrations complete.");
} finally {
  await pool.end();
}
