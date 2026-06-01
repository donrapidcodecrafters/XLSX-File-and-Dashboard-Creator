import { PassThrough } from "node:stream";
import cron from "node-cron"; // fallback only — pg-boss preferred when Postgres is available
import sgMail from "@sendgrid/mail";
import { CronExpressionParser } from "cron-parser";
import type { FastifyBaseLogger } from "fastify";
import type { DashboardDefinition, ReportDefinition, TableDefinition } from "@studio/shared";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";
import { studioStore } from "./studio-store.js";
import { logAuditEvent } from "./audit-log.js";
import { fetchReportExportBundle, executeDashboard } from "./report-runner.js";
import {
  streamReportWorkbook,
  streamDashboardWorkbook,
  buildReportFileName,
  buildDashboardFileName
} from "./xlsx-export.js";

interface ReportConfigRow {
  id: string;
  object_id: string;
  object_type: "report" | "dashboard";
  enabled: boolean;
  cron_expression: string;
  time_zone: string;
  send_to: string[];
  sendgrid_template_id: string;
  export_format: string;
  config: Record<string, unknown>;
  last_run_at: Date | null;
  next_run_at: Date | null;
}

function computeNextCronRun(expression: string, timeZone: string, from = new Date()): string {
  try {
    const expr = CronExpressionParser.parse(expression, {
      tz: timeZone || "UTC",
      currentDate: from
    });
    return new Date(expr.next().toString()).toISOString();
  } catch {
    return "";
  }
}

async function workbookToBuffer(fn: (pass: PassThrough) => Promise<void>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const pass = new PassThrough();
    const chunks: Buffer[] = [];
    pass.on("data", (chunk: unknown) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)));
    pass.on("error", reject);
    pass.on("finish", () => resolve(Buffer.concat(chunks)));
    fn(pass).catch(reject);
  });
}

function resolveObject(objectId: string): ReportDefinition | DashboardDefinition | null {
  const document = studioStore.getLiveDocument();
  const obj = document.bundle.objects[objectId];
  if (!obj) return null;
  return obj as ReportDefinition | DashboardDefinition;
}

function resolveTable(tableId: string): TableDefinition | null {
  const document = studioStore.getLiveDocument();
  return document.bundle.tables.find(
    (t) => t.id === tableId || t.quickbaseTableId === tableId
  ) || null;
}

function buildTablesById(): Record<string, TableDefinition> {
  const document = studioStore.getLiveDocument();
  return Object.fromEntries(document.bundle.tables.map((t) => [t.id, t]));
}

async function runReportConfig(config: ReportConfigRow, logger: FastifyBaseLogger) {
  // Guard: recipients and SendGrid key must be present before doing any expensive work
  const recipients = (config.send_to || []).filter(Boolean);
  if (!recipients.length) {
    logger.warn({ configId: config.id }, "report-scheduler: no recipients configured, skipping");
    return;
  }
  if (!apiConfig.automation.sendgridApiKey) {
    logger.warn({ configId: config.id }, "report-scheduler: SENDGRID_API_KEY not set, skipping");
    return;
  }

  // Ensure the studio document is fresh before reading objects
  await studioStore.hydrateFromQuickbase();

  const obj = resolveObject(config.object_id);
  if (!obj) {
    throw new Error(`Object ${config.object_id} not found in studio document.`);
  }

  let buffer: Buffer;
  let filename: string;

  if (config.object_type === "report") {
    const report = obj as ReportDefinition;
    const result = await fetchReportExportBundle(report, []);
    const table = resolveTable(report.sourceTableId);
    if (!table) {
      throw new Error(`Source table ${report.sourceTableId} not found for report ${report.id}.`);
    }
    filename = buildReportFileName(report);
    buffer = await workbookToBuffer((pass) => streamReportWorkbook(pass, report, table, result));
  } else {
    const dashboard = obj as DashboardDefinition;
    filename = buildDashboardFileName(dashboard);
    const rendered = await executeDashboard(config.object_id, {});
    const tablesById = buildTablesById();
    buffer = await workbookToBuffer((pass) =>
      streamDashboardWorkbook(pass, dashboard, rendered, {}, tablesById)
    );
  }

  sgMail.setApiKey(apiConfig.automation.sendgridApiKey);

  const attachment = {
    content: buffer.toString("base64"),
    filename,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    disposition: "attachment" as const
  };

  const baseMessage = {
    to: recipients,
    from: apiConfig.automation.sendgridFromEmail || "reports@example.com",
    attachments: [attachment]
  };

  // If a SendGrid Dynamic Template ID is configured, use it for branded HTML emails.
  // The template receives the report name and filename as template variables.
  if (config.sendgrid_template_id) {
    await sgMail.send({
      ...baseMessage,
      templateId: config.sendgrid_template_id,
      dynamicTemplateData: {
        report_name: obj.name,
        filename,
        object_type: config.object_type,
        sent_at: new Date().toLocaleString("en-US", { timeZone: config.time_zone || "UTC" })
      }
    });
  } else {
    await sgMail.send({
      ...baseMessage,
      subject: `Scheduled Report: ${obj.name}`,
      text: `Your scheduled export of "${obj.name}" is attached.\n\nSent: ${new Date().toLocaleString()}`
    });
  }

  logger.info({ configId: config.id, objectId: config.object_id, recipients }, "report-scheduler: email sent");
  void logAuditEvent("scheduled_email.sent", { objectType: config.object_type, objectId: config.object_id, metadata: { configId: config.id, recipients, filename } });
}

/** Run a specific report_config immediately by its ID (used for test-send). */
export async function runReportConfigById(configId: string, logger: FastifyBaseLogger) {
  const result = await pgQuery<ReportConfigRow>(
    `SELECT * FROM report_configs WHERE id = $1`, [configId]
  );
  const config = result.rows[0];
  if (!config) throw new Error(`Report config ${configId} not found.`);
  await runReportConfig(config, logger);
}

// Exported so pg-boss workers can call it directly.
export async function processDueConfigs(logger: FastifyBaseLogger) {
  const result = await pgQuery<ReportConfigRow>(
    `SELECT * FROM report_configs WHERE enabled = true AND (next_run_at IS NULL OR next_run_at <= now()) ORDER BY next_run_at ASC NULLS FIRST`
  );

  for (const config of result.rows) {
    try {
      logger.info({ configId: config.id, objectId: config.object_id }, "report-scheduler: running config");
      await runReportConfig(config, logger);
      const nextRunAt = computeNextCronRun(config.cron_expression || "0 * * * *", config.time_zone || "UTC");
      await pgQuery(
        `UPDATE report_configs SET last_run_at = now(), next_run_at = $1, updated_at = now() WHERE id = $2`,
        [nextRunAt || null, config.id]
      );
    } catch (error) {
      logger.error({ configId: config.id, objectId: config.object_id, error: error instanceof Error ? error.message : error }, "report-scheduler: config run failed");
      const nextRunAt = computeNextCronRun(config.cron_expression || "0 * * * *", config.time_zone || "UTC");
      await pgQuery(
        `UPDATE report_configs SET next_run_at = $1, updated_at = now() WHERE id = $2`,
        [nextRunAt || null, config.id]
      ).catch(() => {});
    }
  }
}

let schedulerStarted = false;

export function startReportScheduler(logger: FastifyBaseLogger, pgBossRunning = false) {
  if (schedulerStarted) return;
  if (!apiConfig.automation.enabled) {
    logger.info("report-scheduler: AUTOMATION_ENABLED=false, scheduler is off");
    return;
  }
  if (!isPostgresEnabled()) {
    logger.info("report-scheduler: Postgres not configured, scheduler is off");
    return;
  }

  const expression = apiConfig.automation.cronExpression || "0 * * * *";

  if (!cron.validate(expression)) {
    logger.error({ expression }, "report-scheduler: invalid AUTOMATION_CRON expression, scheduler not started");
    return;
  }

  schedulerStarted = true;

  if (pgBossRunning) {
    // Scheduling is delegated to pg-boss — no in-process cron needed.
    logger.info({ expression }, "report-scheduler: pg-boss is active, email cron delegated to Postgres");
    return;
  }

  // Fallback: node-cron when pg-boss is not available.
  cron.schedule(expression, () => {
    processDueConfigs(logger).catch((error) => {
      logger.error({ error: error instanceof Error ? error.message : error }, "report-scheduler: poll failed");
    });
  }, { timezone: "UTC" });

  logger.info({ expression }, "report-scheduler: started (node-cron fallback)");
}
