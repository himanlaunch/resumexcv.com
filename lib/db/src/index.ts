import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema/index.js";

const { Pool } = pg;

const connectionString =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL ??
  process.env.POSTGRES_PRISMA_URL;

function getSslMode(value: string | undefined) {
  if (!value) return "";
  try {
    return new URL(value).searchParams.get("sslmode") ?? "";
  } catch {
    return "";
  }
}

function removeSslQueryParams(value: string | undefined) {
  if (!value) return value;
  try {
    const url = new URL(value);
    ["sslmode", "sslcert", "sslkey", "sslrootcert"].forEach((key) => url.searchParams.delete(key));
    return url.toString();
  } catch {
    return value;
  }
}

const sslMode = getSslMode(connectionString);

const sanitizedConnectionString = (() => {
  if (!connectionString) return "";
  if (sslMode === "disable") return connectionString;
  return removeSslQueryParams(connectionString) ?? connectionString;
})();

const useSsl = connectionString && sslMode !== "disable";

export const pool = connectionString
  ? new Pool({
      connectionString: sanitizedConnectionString,
      ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: Number(process.env.POSTGRES_POOL_MAX ?? 50),
      connectionTimeoutMillis: 8000,
      idleTimeoutMillis: 10000,
    })
  : ({
      query() {
        throw new Error("DATABASE_URL or POSTGRES_URL must be set before using database-backed endpoints.");
      },
    } as unknown as pg.Pool);
export const db = drizzle(pool, { schema });

export * from "./schema/index.js";
