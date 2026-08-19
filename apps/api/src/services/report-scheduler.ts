import cron from "node-cron"; // fallback only — pg-boss preferred when Postgres is available
import sgMail from "@sendgrid/mail";
import { CronExpressionParser } from "cron-parser";
import type { FastifyBaseLogger } from "fastify";
import { buildDashboardFilters, type DashboardDefinition, type ReportDefinition, type ReportRunResult, type TableDefinition } from "@studio/shared";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";
import { studioStore } from "./studio-store.js";
import { logAuditEvent } from "./audit-log.js";
import { sendSystemNotification } from "./notification-service.js";
import { fetchReportExportBundle, executeDashboard } from "./report-runner.js";
import { buildReportFileName, buildDashboardFileName } from "./xlsx-export.js";
import { exportReportNativeChartWorkbook, exportDashboardNativeChartWorkbook } from "./nativeExcelExport.js";

// @sendgrid/mail's ResponseError sets .message to the bare HTTP status text (e.g.
// "Unauthorized" for any 401, whether from a bad key or one missing Mail Send scope),
// discarding SendGrid's actual diagnostic body. Pull that detail back out so failures
// are actionable instead of a generic status phrase.
function describeSendGridError(error: unknown): string {
  const base = error instanceof Error ? error.message : "Unknown error";
  const body = (error as { response?: { body?: { errors?: Array<{ message?: string; field?: string }> } } })?.response?.body;
  const detail = body?.errors?.map((e) => [e.field, e.message].filter(Boolean).join(": ")).filter(Boolean).join("; ");
  return detail ? `${base} — ${detail}` : base;
}

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
  email_subject: string;
  email_body: string;
  created_by: string;
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

function describeScheduleExpr(expr: string): string {
  if (!expr || expr === "0 * * * *") return "Every hour";
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [, hourStr, domStr, , dowStr] = parts;
  const h24 = Number(hourStr);
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12 = h24 === 0 ? 12 : h24 > 12 ? h24 - 12 : h24;
  const timeLabel = `${h12}:00 ${ampm}`;
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  if (dowStr !== "*") return `Every ${days[Number(dowStr)] || dowStr} at ${timeLabel}`;
  if (domStr !== "*") {
    const suffix = Number(domStr) === 1 ? "st" : Number(domStr) === 2 ? "nd" : Number(domStr) === 3 ? "rd" : "th";
    return `${domStr}${suffix} of every month at ${timeLabel}`;
  }
  return `Every day at ${timeLabel}`;
}

function buildScheduledReportHtml(opts: {
  platformName: string;
  platformUrl: string;
  objName: string;
  objectTypeLabel: string;
  filename: string;
  bodyText: string;
  sentAt: string;
  scheduleLabel: string;
}): string {
  const { platformName, platformUrl, objName, objectTypeLabel, filename, bodyText, sentAt, scheduleLabel } = opts;
  const ctaHref = platformUrl || "#";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${objName} — Scheduled ${objectTypeLabel}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px">
<tr><td>
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px;margin:0 auto;border-radius:10px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)">

  <!-- Header -->
  <tr><td style="background:#0f172a;padding:28px 36px">
    <div style="font-size:18px;font-weight:800;color:#ffffff;letter-spacing:-0.02em;line-height:1">${platformName}</div>
    <div style="font-size:11px;font-weight:600;color:#64748b;margin-top:6px;text-transform:uppercase;letter-spacing:0.07em">Scheduled ${objectTypeLabel}</div>
  </td></tr>

  <!-- Object name + type badge -->
  <tr><td style="background:#ffffff;padding:32px 36px 0">
    <table cellpadding="0" cellspacing="0">
      <tr><td style="padding-bottom:14px">
        <span style="display:inline-block;padding:4px 12px;background:#ecfdf5;border:1px solid #a7f3d0;border-radius:99px;font-size:11px;font-weight:700;color:#065f46;text-transform:uppercase;letter-spacing:0.06em">${objectTypeLabel}</span>
      </td></tr>
      <tr><td>
        <div style="font-size:22px;font-weight:800;color:#0f172a;line-height:1.2;letter-spacing:-0.025em">${objName}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- Body -->
  <tr><td style="background:#ffffff;padding:20px 36px 32px">
    <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.75">${bodyText}</p>

    <!-- Attachment card -->
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:28px">
      <tr>
        <td style="padding:14px 16px;width:52px;vertical-align:middle">
          <div style="width:44px;height:44px;background:#d1fae5;border-radius:8px;text-align:center;line-height:44px;font-size:22px">&#128202;</div>
        </td>
        <td style="padding:14px 8px 14px 0;vertical-align:middle">
          <div style="font-size:13px;font-weight:700;color:#111827">${filename}</div>
          <div style="font-size:12px;color:#6b7280;margin-top:3px">Microsoft Excel attachment</div>
        </td>
      </tr>
    </table>

    <!-- CTA button -->
    <a href="${ctaHref}" style="display:inline-block;padding:12px 26px;background:#0d7c66;color:#ffffff;text-decoration:none;font-size:13px;font-weight:700;border-radius:7px;letter-spacing:-0.01em">Open ${platformName} &#8594;</a>
  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e5e7eb;padding:16px 36px">
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td style="font-size:11px;color:#9ca3af">Sent: ${sentAt}</td>
        <td style="font-size:11px;color:#9ca3af;text-align:right">Schedule: ${scheduleLabel}</td>
      </tr>
    </table>
    <div style="font-size:11px;color:#d1d5db;margin-top:10px;line-height:1.6">You are receiving this because you are subscribed to scheduled reports from ${platformName}. Contact your administrator to manage your preferences.</div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

async function runReportConfig(config: ReportConfigRow, logger: FastifyBaseLogger) {
  // Guard: recipients and SendGrid key must be present before doing any expensive work.
  // These throw (rather than silently returning) so processDueConfigs treats them as real
  // failures — notifying and retrying next cycle instead of marking last_run_at as a success.
  const recipients = (config.send_to || []).filter(Boolean);
  if (!recipients.length) {
    throw new Error("No recipients configured for this scheduled report.");
  }
  if (!apiConfig.automation.sendgridApiKey) {
    throw new Error("SENDGRID_API_KEY is not set — scheduled report emails cannot be sent.");
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
    buffer = await exportReportNativeChartWorkbook(report, table, result);
  } else {
    const dashboard = obj as DashboardDefinition;
    filename = buildDashboardFileName(dashboard);
    const rendered = await executeDashboard(config.object_id, {});
    const tablesById = buildTablesById();
    const exportResultsByWidgetId: Record<string, ReportRunResult> = {};
    for (const tab of rendered.tabs) {
      for (const widget of tab.widgets) {
        if (!widget.report || widget.status === "failed") continue;
        try {
          const filters = buildDashboardFilters(dashboard, widget.report.id, {}, widget.report.sourceTableId, widget.widget, tab.id);
          const widgetMode = widget.widget.displayMode !== "inherit" ? widget.widget.displayMode : widget.report.view.mode;
          const needsDetailSheet = widgetMode !== "table" && widget.widget.showDetails;
          let effectiveReport = widget.report;
          if (needsDetailSheet && !widget.report.selectedFieldIds.length) {
            const srcTable = tablesById[widget.report.sourceTableId];
            if (srcTable?.fields.length) {
              effectiveReport = { ...widget.report, selectedFieldIds: srcTable.fields.map((f) => String(f.id)) };
            }
          }
          exportResultsByWidgetId[widget.widgetId] = await fetchReportExportBundle(effectiveReport, filters);
        } catch { /* use widget.result fallback */ }
      }
    }
    buffer = await exportDashboardNativeChartWorkbook(dashboard, rendered, exportResultsByWidgetId, {
      tablesById,
      includeOverviewSheet: dashboard.includeExportOverviewSheet === true
    });
  }

  sgMail.setApiKey(apiConfig.automation.sendgridApiKey);

  let platformName = "Enterprise Platform";
  try { platformName = studioStore.getLiveDocument()?.branding?.platformName || platformName; } catch { /* use default */ }
  const platformUrl = apiConfig.server?.publicUrl || "";

  const sentAt = new Date().toLocaleString("en-US", {
    timeZone: config.time_zone || "UTC",
    dateStyle: "long",
    timeStyle: "short"
  });
  const scheduleLabel = describeScheduleExpr(config.cron_expression);
  const objectTypeLabel = config.object_type === "dashboard" ? "Dashboard" : "Report";

  const customSubject = (config.email_subject || "").trim();
  const customBody = (config.email_body || "").trim();

  const emailSubject = customSubject || `${obj.name} — ${objectTypeLabel} from ${platformName}`;
  const emailBodyText = customBody || `Your scheduled ${objectTypeLabel.toLowerCase()} is ready and attached to this email as an Excel file.`;

  const attachment = {
    content: buffer.toString("base64"),
    filename,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    disposition: "attachment" as const
  };

  const from = apiConfig.automation.sendgridFromEmail || "reports@example.com";

  if (config.sendgrid_template_id) {
    try {
      await sgMail.send({
        to: recipients,
        from,
        attachments: [attachment],
        templateId: config.sendgrid_template_id,
        dynamicTemplateData: {
          report_name: obj.name,
          filename,
          object_type: config.object_type,
          sent_at: sentAt
        }
      });
    } catch (error) {
      throw new Error(`SendGrid error: ${describeSendGridError(error)}`);
    }
  } else {
    const html = buildScheduledReportHtml({
      platformName,
      platformUrl,
      objName: obj.name,
      objectTypeLabel,
      filename,
      bodyText: emailBodyText,
      sentAt,
      scheduleLabel
    });
    const text = [
      `${platformName} — Scheduled ${objectTypeLabel}`,
      "=".repeat(50),
      "",
      obj.name,
      "",
      emailBodyText,
      "",
      `Attachment: ${filename}`,
      `Sent: ${sentAt}`,
      `Schedule: ${scheduleLabel}`,
      "",
      platformUrl ? `Open platform: ${platformUrl}` : "",
      "",
      "You are receiving this because you are subscribed to scheduled reports."
    ].filter((l) => l !== undefined).join("\n");

    try {
      await sgMail.send({
        to: recipients,
        from: { email: from, name: platformName },
        subject: emailSubject,
        html,
        text,
        attachments: [attachment]
      });
    } catch (error) {
      throw new Error(`SendGrid error: ${describeSendGridError(error)}`);
    }
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
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ configId: config.id, objectId: config.object_id, error: errorMessage }, "report-scheduler: config run failed");
      const nextRunAt = computeNextCronRun(config.cron_expression || "0 * * * *", config.time_zone || "UTC");
      await pgQuery(
        `UPDATE report_configs SET next_run_at = $1, updated_at = now() WHERE id = $2`,
        [nextRunAt || null, config.id]
      ).catch(() => {});
      const obj = resolveObject(config.object_id);
      void sendSystemNotification(
        {
          type: "scheduled_email_failed",
          title: "Scheduled Email Report Failed",
          status: "error",
          summary: `The scheduled ${config.object_type} email "${obj?.name || config.object_id}" failed to send.`,
          errors: [errorMessage],
          occurredAt: new Date().toISOString(),
          triggeredBy: "Scheduled email",
          details: [
            { label: "Object", value: obj?.name || config.object_id },
            { label: "Recipients", value: (config.send_to || []).join(", ") || "(none configured)" },
            { label: "Schedule", value: describeScheduleExpr(config.cron_expression) }
          ]
        },
        config.created_by ? [config.created_by] : []
      );
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
