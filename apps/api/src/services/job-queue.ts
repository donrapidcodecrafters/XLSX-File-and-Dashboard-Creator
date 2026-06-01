import { PgBoss } from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import { apiConfig, isPostgresEnabled } from "../config/env.js";

let boss: PgBoss | null = null;

export async function startJobQueue(logger?: FastifyBaseLogger): Promise<PgBoss | null> {
  if (!isPostgresEnabled()) {
    logger?.info("job-queue: Postgres not configured, pg-boss disabled — falling back to in-process schedulers");
    return null;
  }
  if (boss) return boss;

  boss = new PgBoss({
    connectionString: apiConfig.postgres.url,
    ssl: apiConfig.postgres.ssl ? { rejectUnauthorized: false } : undefined,
    max: 2,           // separate small pool from the main app pool
    schedule: true    // enable boss.schedule() cron support
  });

  boss.on("error", (err: Error) => {
    logger?.error({ err: err.message }, "pg-boss error");
  });

  await boss.start();
  logger?.info("pg-boss job queue started");
  return boss;
}

export function getJobQueue(): PgBoss | null {
  return boss;
}

export async function stopJobQueue(logger?: FastifyBaseLogger): Promise<void> {
  if (!boss) return;
  const current = boss;
  boss = null;
  await current.stop({ graceful: true });
  logger?.info("pg-boss job queue stopped");
}
