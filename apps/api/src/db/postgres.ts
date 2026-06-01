import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";
import { apiConfig, isPostgresEnabled } from "../config/env.js";

let pool: Pool | null = null;

export function getPgPool() {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL or POSTGRES_URL is required for Postgres operations.");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: apiConfig.postgres.url,
      max: apiConfig.postgres.poolMax,
      idleTimeoutMillis: apiConfig.postgres.idleTimeoutMillis,
      connectionTimeoutMillis: apiConfig.postgres.connectionTimeoutMillis,
      statement_timeout: apiConfig.postgres.statementTimeoutMillis,
      query_timeout: apiConfig.postgres.statementTimeoutMillis,
      ssl: apiConfig.postgres.ssl ? { rejectUnauthorized: false } : undefined
    });
  }
  return pool;
}

export async function pgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = []
): Promise<QueryResult<T>> {
  return getPgPool().query<T>(text, values);
}

export async function withPgTransaction<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function closePgPool() {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
