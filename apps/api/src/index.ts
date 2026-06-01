import Fastify from "fastify";
import cors from "@fastify/cors";
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
import { checkAndTriggerScheduledRefreshes, startRefreshScheduler } from "./services/refresh-cache.js";
import { processDueConfigs, startReportScheduler } from "./services/report-scheduler.js";
import { startJobQueue, stopJobQueue } from "./services/job-queue.js";
import { recoverExportJobsOnStartup } from "./services/export-jobs.js";

const app = Fastify({
  logger: true,
  bodyLimit: apiConfig.uploads.maxFileBytes
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

await ensureEnterpriseSchema(app.log);
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
