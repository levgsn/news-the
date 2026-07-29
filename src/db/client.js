import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set — copy .env.example to .env and fill it in, " +
    "or set it in Railway's Variables tab."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Railway's managed Postgres requires SSL outside their internal network.
  ssl: process.env.DATABASE_URL?.includes("railway")
    ? { rejectUnauthorized: false }
    : false,
});

export async function query(text, params) {
  return pool.query(text, params);
}
