import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

export async function logAuditEvent(
  action: string,
  options: {
    userEmail?: string;
    objectType?: string;
    objectId?: string;
    metadata?: Record<string, unknown>;
  } = {}
) {
  if (!isPostgresEnabled()) return;
  await pgQuery(
    `INSERT INTO audit_log (user_email, action, object_type, object_id, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [
      options.userEmail || "",
      action,
      options.objectType || "",
      options.objectId || "",
      JSON.stringify(options.metadata || {})
    ]
  ).catch(() => {}); // audit logging is best-effort — never block the request
}
