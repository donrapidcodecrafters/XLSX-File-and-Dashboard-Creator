import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";
import { runReportConfigById } from "../services/report-scheduler.js";

export interface ReportConfigRow {
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
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}

function parseBody(body: unknown): Record<string, unknown> {
  return (body && typeof body === "object") ? body as Record<string, unknown> : {};
}

function sanitizeRecipients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(String).filter((email) => email.includes("@")).slice(0, 50);
}

function sanitizeCron(value: unknown): string {
  const expr = String(value || "0 * * * *").trim();
  return expr || "0 * * * *";
}

export async function registerReportConfigRoutes(app: FastifyInstance) {
  app.get("/api/report-configs", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not configured." };
    }
    const result = await pgQuery<ReportConfigRow>(
      `SELECT * FROM report_configs ORDER BY created_at DESC`
    );
    return { configs: result.rows };
  });

  app.post("/api/report-configs", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not configured." };
    }
    const body = parseBody(request.body);
    const objectId = String(body.object_id || "").trim();
    const objectType = body.object_type === "dashboard" ? "dashboard" : "report";
    if (!objectId) {
      reply.code(400);
      return { message: "object_id is required." };
    }
    const id = randomUUID();
    const cronExpression = sanitizeCron(body.cron_expression);
    const timeZone = String(body.time_zone || "UTC").trim() || "UTC";
    const sendTo = sanitizeRecipients(body.send_to);
    const enabled = body.enabled === true;
    const result = await pgQuery<ReportConfigRow>(
      `INSERT INTO report_configs (
        id, object_id, object_type, enabled, cron_expression, time_zone,
        send_to, sendgrid_template_id, export_format, config
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
      RETURNING *`,
      [
        id, objectId, objectType, enabled, cronExpression, timeZone,
        sendTo, String(body.sendgrid_template_id || ""),
        "xlsx", JSON.stringify(body.config || {})
      ]
    );
    return { config: result.rows[0] };
  });

  app.put("/api/report-configs/:id", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not configured." };
    }
    const { id } = request.params as { id: string };
    const body = parseBody(request.body);
    const existing = await pgQuery<{ id: string }>(
      `SELECT id FROM report_configs WHERE id = $1`, [id]
    );
    if (!existing.rows.length) {
      reply.code(404);
      return { message: "Config not found." };
    }
    const result = await pgQuery<ReportConfigRow>(
      `UPDATE report_configs SET
        enabled = $1,
        cron_expression = $2,
        time_zone = $3,
        send_to = $4,
        sendgrid_template_id = $5,
        updated_at = now()
      WHERE id = $6
      RETURNING *`,
      [
        body.enabled === true,
        sanitizeCron(body.cron_expression),
        String(body.time_zone || "UTC").trim() || "UTC",
        sanitizeRecipients(body.send_to),
        String(body.sendgrid_template_id || ""),
        id
      ]
    );
    return { config: result.rows[0] };
  });

  app.post("/api/report-configs/:id/test", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not configured." };
    }
    const { id } = request.params as { id: string };
    try {
      await runReportConfigById(id, request.log);
      return { ok: true, message: "Test email sent successfully." };
    } catch (error) {
      reply.code(400);
      return { message: error instanceof Error ? error.message : "Test email failed." };
    }
  });

  app.delete("/api/report-configs/:id", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is not configured." };
    }
    const { id } = request.params as { id: string };
    await pgQuery(`DELETE FROM report_configs WHERE id = $1`, [id]);
    return { ok: true };
  });
}
