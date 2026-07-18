import pg from "pg";

const { Pool } = pg;

let pool;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error("DATABASE_URL is not configured.");
    }

    pool = new Pool({
      connectionString,
      ssl:
        process.env.NODE_ENV === "production"
          ? { rejectUnauthorized: false }
          : false
    });
  }

  return pool;
}

export async function query(text, values = []) {
  return getPool().query(text, values);
}
