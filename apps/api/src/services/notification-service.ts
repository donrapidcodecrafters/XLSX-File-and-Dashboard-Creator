import sgMail from "@sendgrid/mail";
import { apiConfig } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";
import { studioStore } from "./studio-store.js";

export type SystemEventType =
  | "refresh_complete"
  | "refresh_failed"
  | "refresh_cancelled"
  | "scheduled_refresh_complete"
  | "scheduled_refresh_failed"
  | "export_complete"
  | "export_failed"
  | "scheduled_email_failed";

export interface SystemEventPayload {
  type: SystemEventType;
  title: string;
  status: "success" | "warning" | "error" | "info";
  summary: string;
  details?: Array<{ label: string; value: string }>;
  errors?: string[];
  tableCount?: number;
  rowCount?: number;
  durationSeconds?: number;
  triggeredBy?: string;
  occurredAt?: string;
}

const STATUS_COLORS: Record<SystemEventPayload["status"], string> = {
  success: "#16a34a",
  warning: "#ca8a04",
  error: "#dc2626",
  info: "#2563eb"
};

const STATUS_BG: Record<SystemEventPayload["status"], string> = {
  success: "#f0fdf4",
  warning: "#fefce8",
  error: "#fef2f2",
  info: "#eff6ff"
};

const STATUS_LABELS: Record<SystemEventPayload["status"], string> = {
  success: "SUCCESS",
  warning: "WARNING",
  error: "ERROR",
  info: "INFO"
};

function formatDuration(seconds?: number) {
  if (!seconds || seconds < 1) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function buildEventHtml(event: SystemEventPayload, platformName: string, platformUrl: string): string {
  const color = STATUS_COLORS[event.status];
  const bg = STATUS_BG[event.status];
  const label = STATUS_LABELS[event.status];
  const occurredAt = event.occurredAt
    ? new Date(event.occurredAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })
    : new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" });

  const detailRows = (event.details || []).map((d) => `
    <tr>
      <td style="padding:6px 0;color:#6b7280;font-size:13px;width:140px;vertical-align:top">${d.label}</td>
      <td style="padding:6px 0;color:#111827;font-size:13px;font-weight:500;vertical-align:top">${d.value}</td>
    </tr>`).join("");

  const statsRow = [
    event.tableCount != null ? `<div style="text-align:center;padding:10px 20px"><div style="font-size:22px;font-weight:700;color:#111827">${event.tableCount.toLocaleString()}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Tables</div></div>` : "",
    event.rowCount != null ? `<div style="text-align:center;padding:10px 20px;border-left:1px solid #e5e7eb"><div style="font-size:22px;font-weight:700;color:#111827">${event.rowCount.toLocaleString()}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Records</div></div>` : "",
    event.durationSeconds != null ? `<div style="text-align:center;padding:10px 20px;border-left:1px solid #e5e7eb"><div style="font-size:22px;font-weight:700;color:#111827">${formatDuration(event.durationSeconds)}</div><div style="font-size:11px;color:#6b7280;margin-top:2px;text-transform:uppercase;letter-spacing:.05em">Duration</div></div>` : ""
  ].filter(Boolean).join("");

  const errorsBlock = event.errors?.length ? `
    <div style="margin-top:20px;padding:14px 18px;background:#fef2f2;border:1px solid #fecaca;border-radius:6px">
      <div style="font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px">Errors Encountered</div>
      ${event.errors.map((e) => `<div style="font-size:13px;color:#7f1d1d;margin-bottom:4px;line-height:1.5">• ${e}</div>`).join("")}
    </div>` : "";

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${event.title}</title></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td>
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto">

        <!-- Header -->
        <tr><td style="background:#1e293b;border-radius:8px 8px 0 0;padding:24px 32px">
          <div style="font-size:13px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em">${platformName}</div>
          <div style="font-size:11px;color:#475569;margin-top:4px">System Notification</div>
        </td></tr>

        <!-- Status banner -->
        <tr><td style="background:${bg};border-left:4px solid ${color};padding:16px 32px">
          <table cellpadding="0" cellspacing="0"><tr>
            <td style="padding-right:12px">
              <span style="display:inline-block;padding:3px 10px;background:${color};color:#fff;font-size:11px;font-weight:700;border-radius:4px;letter-spacing:.06em">${label}</span>
            </td>
            <td style="font-size:16px;font-weight:700;color:#111827">${event.title}</td>
          </tr></table>
        </td></tr>

        <!-- Body -->
        <tr><td style="background:#ffffff;padding:28px 32px">

          <p style="margin:0 0 20px;font-size:14px;color:#374151;line-height:1.6">${event.summary}</p>

          ${statsRow ? `<table cellpadding="0" cellspacing="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;margin-bottom:20px"><tr>${statsRow}</tr></table>` : ""}

          ${detailRows ? `<table cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #f3f4f6;margin-bottom:8px">${detailRows}</table>` : ""}

          ${errorsBlock}

          <div style="margin-top:24px;padding-top:20px;border-top:1px solid #e5e7eb">
            <a href="${platformUrl}" style="display:inline-block;padding:10px 22px;background:#1e293b;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;border-radius:6px">Open Platform</a>
          </div>

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;padding:16px 32px">
          <table width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-size:11px;color:#9ca3af">Occurred: ${occurredAt}</td>
            ${event.triggeredBy ? `<td style="font-size:11px;color:#9ca3af;text-align:right">Triggered by: ${event.triggeredBy}</td>` : ""}
          </tr></table>
          <div style="font-size:11px;color:#d1d5db;margin-top:8px">You are receiving this because system notifications are enabled for your account. Manage your preferences in the platform settings.</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEventText(event: SystemEventPayload, platformName: string): string {
  const lines = [
    `${platformName} — System Notification`,
    `${"=".repeat(50)}`,
    `[${(event.status).toUpperCase()}] ${event.title}`,
    "",
    event.summary,
    ""
  ];
  if (event.tableCount != null) lines.push(`Tables synced:  ${event.tableCount.toLocaleString()}`);
  if (event.rowCount != null) lines.push(`Records synced: ${event.rowCount.toLocaleString()}`);
  if (event.durationSeconds != null) lines.push(`Duration:       ${formatDuration(event.durationSeconds)}`);
  if (event.details?.length) {
    lines.push("");
    event.details.forEach((d) => lines.push(`${d.label}: ${d.value}`));
  }
  if (event.errors?.length) {
    lines.push("", "Errors:");
    event.errors.forEach((e) => lines.push(`  • ${e}`));
  }
  if (event.triggeredBy) lines.push("", `Triggered by: ${event.triggeredBy}`);
  if (event.occurredAt) {
    lines.push(`Occurred: ${new Date(event.occurredAt).toLocaleString()}`);
  }
  return lines.join("\n");
}

async function getNotificationRecipients(): Promise<string[]> {
  try {
    const result = await pgQuery<{ email: string }>(
      "SELECT email FROM users WHERE system_notifications_enabled = true AND active = true"
    );
    return result.rows.map((row) => row.email).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * @param extraRecipients Always notified regardless of their system_notifications_enabled
 * preference — e.g. the person who created the scheduled item that just failed, so they
 * find out even if they haven't opted into general system notifications.
 */
export async function sendSystemNotification(event: SystemEventPayload, extraRecipients: string[] = []): Promise<void> {
  const key = apiConfig.automation?.sendgridApiKey || "";
  const from = apiConfig.automation?.sendgridFromEmail || "";
  if (!key || !from) return;

  const broadcastRecipients = await getNotificationRecipients();
  const recipients = Array.from(new Set([...broadcastRecipients, ...extraRecipients.filter(Boolean)]));
  if (!recipients.length) return;

  let platformName = "Enterprise Platform";
  try { platformName = studioStore.getLiveDocument()?.branding?.platformName || platformName; } catch { /* use default */ }
  const platformUrl = apiConfig.server?.publicUrl || "";

  sgMail.setApiKey(key);
  const html = buildEventHtml(event, platformName, platformUrl);
  const text = buildEventText(event, platformName);

  for (const email of recipients) {
    try {
      await sgMail.send({
        to: email,
        from: { email: from, name: platformName },
        subject: `${event.title} — ${platformName}`,
        text,
        html
      });
    } catch {
      // Non-blocking — never let notification failure crash the main operation
    }
  }
}
