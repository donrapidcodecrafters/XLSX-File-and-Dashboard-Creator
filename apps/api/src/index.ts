import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { registerSessionAuth } from "./auth/session-auth.js";
import { apiConfig } from "./config/env.js";
import { ensureEnterpriseSchema } from "./db/schema.js";
import { closePgPool } from "./db/postgres.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { registerInvitationRoutes } from "./routes/invitations.js";
import { registerPreferencesRoutes } from "./routes/preferences.js";
import { registerQuickbaseRoutes } from "./routes/quickbase.js";
import { registerRenderRoutes } from "./routes/render.js";
import { registerReportConfigRoutes } from "./routes/report-configs.js";
import { registerStudioRoutes } from "./routes/studio.js";
import { registerRolesRoutes } from "./routes/roles.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerWorkbookProfileRoutes } from "./routes/workbook-profiles.js";
import { checkAndTriggerScheduledRefreshes, startRefreshScheduler } from "./services/refresh-cache.js";
import { processDueConfigs, startReportScheduler } from "./services/report-scheduler.js";
import { startJobQueue, stopJobQueue } from "./services/job-queue.js";
import { recoverExportJobsOnStartup } from "./services/export-jobs.js";
import { studioStore } from "./services/studio-store.js";

const app = Fastify({
  logger: true,
  bodyLimit: apiConfig.uploads.maxFileBytes
});

// ── Security headers ─────────────────────────────────────────────────────────
await app.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],   // React dev needs inline scripts
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: [],
    }
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: "deny" },
  noSniff: true,
  xssFilter: true,
});

// ── Global rate limiting ──────────────────────────────────────────────────────
await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: "1 minute",
  allowList: ["127.0.0.1", "::1"],
  errorResponseBuilder: (_req, context) => ({
    statusCode: 429,
    error: "Too Many Requests",
    message: `Rate limit exceeded. Retry after ${Math.ceil(context.ttl / 1000)}s.`,
  }),
});

await app.register(cors, {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const allowedOrigins: RegExp[] = [
      /^https?:\/\/localhost(?::\d+)?$/i,
      /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
      /^https:\/\/donrapidcodecrafters\.github\.io$/i,
      /^https:\/\/donaldlundgren\.github\.io$/i,
      /^https:\/\/[a-z0-9-]+\.github\.io$/i
    ];
    if (apiConfig.server.publicUrl) {
      try {
        const { origin: publicOrigin } = new URL(apiConfig.server.publicUrl);
        if (publicOrigin && publicOrigin !== "null") {
          const escaped = publicOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          allowedOrigins.push(new RegExp(`^${escaped}$`, "i"));
        }
      } catch {}
    }
    callback(null, allowedOrigins.some((pattern) => pattern.test(origin)));
  },
  credentials: true,      // required — lets browser send session cookies cross-origin
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Cookie", "X-Requested-With"],
  exposedHeaders: ["Set-Cookie"],
  maxAge: 60 * 60,
  preflight: true,        // respond to OPTIONS preflight automatically
  strictPreflight: false  // don't reject preflights from unrecognised origins
});
await app.register(formbody);
await app.register(multipart, {
  limits: {
    fileSize: apiConfig.uploads.maxFileBytes
  }
});

// Retry DB connection — Postgres may not be ready immediately after system boot
{
  const maxAttempts = 12;
  const delayMs = 5000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await ensureEnterpriseSchema(app.log);
      lastError = null;
      break;
    } catch (err) {
      lastError = err;
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== "ECONNREFUSED" && code !== "ENOENT" && code !== "ENOTFOUND") throw err;
      app.log.warn({ attempt, maxAttempts, code }, "DB not ready yet, retrying in 5s…");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  if (lastError) {
    app.log.warn({ err: (lastError as Error).message }, "Postgres unavailable after all startup retries — API starting without DB. DB-dependent endpoints will fail until Postgres recovers.");
  }
}
await recoverExportJobsOnStartup();
await registerSessionAuth(app);

await registerCatalogRoutes(app);
await registerInvitationRoutes(app);
await registerPreferencesRoutes(app);
await registerQuickbaseRoutes(app);
await registerRenderRoutes(app);
await registerReportConfigRoutes(app);
await registerStudioRoutes(app);
await registerUserRoutes(app);
await registerRolesRoutes(app);
await registerWorkbookProfileRoutes(app);

// ── Password reset endpoints (public) ────────────────────────────────────────
import { pgQuery } from "./db/postgres.js";
import bcrypt from "bcryptjs";

app.get("/api/auth/reset-password/:token", async (request, reply) => {
  const { token } = request.params as { token: string };
  const result = await pgQuery<{ user_id: string; email: string }>(
    `SELECT r.user_id, u.email FROM password_reset_tokens r
     JOIN users u ON u.id = r.user_id
     WHERE r.token = $1 AND r.expires_at > now() AND r.used_at IS NULL`,
    [token]
  );
  if (!result.rows[0]) { reply.code(404); return { valid: false }; }
  return { valid: true, email: result.rows[0].email };
});

app.post("/api/auth/reset-password", async (request, reply) => {
  const body = (request.body as { token?: string; password?: string }) || {};
  const token = String(body.token || "");
  const password = String(body.password || "");
  if (!token || password.length < 8) {
    reply.code(400);
    return { message: "Valid token and password (min 8 chars) required." };
  }
  const result = await pgQuery<{ user_id: string }>(
    "SELECT user_id FROM password_reset_tokens WHERE token = $1 AND expires_at > now() AND used_at IS NULL",
    [token]
  );
  if (!result.rows[0]) { reply.code(400); return { message: "Reset link is invalid or has expired." }; }
  const userId = result.rows[0].user_id;
  const hash = await bcrypt.hash(password, 12);
  await pgQuery("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [hash, userId]);
  await pgQuery("UPDATE password_reset_tokens SET used_at = now() WHERE token = $1", [token]);
  // Clear 2FA so user must re-setup after reset (security best practice)
  // await pgQuery("UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1", [userId]);
  return { ok: true };
});

// ── Admin restart endpoint (developer only) ──────────────────────────────────
app.post("/api/admin/restart", async (request, reply) => {
  const ip = request.ip || (request.socket as { remoteAddress?: string })?.remoteAddress || "";
  const isLocal = ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const email = request.session?.userEmail;
  if (!isLocal && email !== "don@rapidcodecrafters.com") {
    reply.code(403); return { message: "Forbidden." };
  }
  reply.send({ ok: true, message: "Restarting..." });
  setTimeout(() => process.exit(0), 200);
});

// ── Read-only platform config endpoint (admin/developer only) ────────────────
app.get("/api/admin/config", async (request, reply) => {
  const email = request.session?.userEmail;
  const isDev = email === "don@rapidcodecrafters.com";
  if (!email && apiConfig.auth.enabled) {
    reply.code(401); return { message: "Authentication required." };
  }
  // Sanitize DATABASE_URL — strip password
  const dbUrl = apiConfig.postgres.url || "";
  let dbUrlSanitized = dbUrl;
  try {
    const u = new URL(dbUrl);
    if (u.password) u.password = "***";
    dbUrlSanitized = u.toString();
  } catch {}

  return {
    postgres: {
      connected: Boolean(apiConfig.postgres.url),
      urlSanitized: dbUrlSanitized || "(not configured)",
      ssl: apiConfig.postgres.ssl,
      poolMax: apiConfig.postgres.poolMax,
      idleTimeoutMs: apiConfig.postgres.idleTimeoutMillis,
      connectionTimeoutMs: apiConfig.postgres.connectionTimeoutMillis,
      statementTimeoutMs: apiConfig.postgres.statementTimeoutMillis,
      legacyRowLoadLimit: apiConfig.postgres.legacyRowLoadLimit,
      autoMigrate: apiConfig.postgres.autoMigrate,
    },
    auth: {
      enabled: apiConfig.auth.enabled,
      sessionTtlHours: apiConfig.auth.sessionTtlHours,
      userCount: apiConfig.auth.allowedUsers.length,
    },
    server: {
      publicUrl: apiConfig.server.publicUrl || "(not set)",
      host: apiConfig.server.host,
      port: apiConfig.server.port,
    },
    automation: {
      enabled: apiConfig.automation.enabled,
      cronExpression: apiConfig.automation.cronExpression,
      sendgridConfigured: Boolean(apiConfig.automation.sendgridApiKey),
      fromEmail: apiConfig.automation.sendgridFromEmail || "(not set)",
    },
    isDeveloper: isDev,
  };
});

// ── Job queue (pg-boss) ──────────────────────────────────────────────────────
// Starts pg-boss against the same Postgres instance. Registers durable cron
// schedules for refresh checking and automated email sending. Falls back to
// in-process setInterval / node-cron when Postgres is not configured.

const boss = await startJobQueue(app.log);

if (boss) {
  // pg-boss v12 requires queues to be explicitly created before scheduling.
  await boss.createQueue("check-refresh-schedules");

  // ── Worker: check Quickbase refresh schedules (every minute) ────────────
  await boss.schedule("check-refresh-schedules", "* * * * *", {});
  await boss.work(
    "check-refresh-schedules",
    { localConcurrency: 1 },
    async () => {
      await checkAndTriggerScheduledRefreshes(app.log);
    }
  );
  app.log.info("pg-boss: refresh schedule checker registered");

  // ── Worker: automated email report sending ───────────────────────────────
  if (apiConfig.automation.enabled) {
    const emailCron = apiConfig.automation.cronExpression || "0 * * * *";
    await boss.createQueue("process-email-schedules");
    await boss.schedule("process-email-schedules", emailCron, {});
    await boss.work(
      "process-email-schedules",
      { localConcurrency: 1 },
      async () => {
        await processDueConfigs(app.log);
      }
    );
    app.log.info({ cron: emailCron }, "pg-boss: email schedule processor registered");
  }
}

// Start legacy in-process schedulers — they become no-ops when pg-boss is running.
startRefreshScheduler(app.log, boss !== null);
startReportScheduler(app.log, boss !== null);

// ── HTTP server ──────────────────────────────────────────────────────────────

const port = apiConfig.server.port;
const host = apiConfig.server.host;

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}; shutting down API.`);
  await app.close();
  await stopJobQueue(app.log);
  await studioStore.awaitPendingPostgresWrite();
  await closePgPool();
}

process.once("SIGTERM", () => {
  shutdown("SIGTERM").finally(() => process.exit(0));
});
process.once("SIGINT", () => {
  shutdown("SIGINT").finally(() => process.exit(0));
});

app.listen({ port, host }).then(() => {
  app.log.info("API running on http://" + host + ":" + port);
}).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
