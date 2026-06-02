import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import bcrypt from "bcryptjs";
import sgMail from "@sendgrid/mail";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";
import { apiConfig } from "../config/env.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  created_at: Date;
  last_login_at: Date | null;
}

interface UserWithRole extends UserRow {
  role: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const VALID_ROLES = ["admin", "editor", "viewer"] as const;
type Role = (typeof VALID_ROLES)[number];

function isValidRole(value: unknown): value is Role {
  return VALID_ROLES.includes(value as Role);
}

function normalizeEmail(value: unknown): string {
  return String(value || "").trim().toLowerCase();
}

/**
 * Middleware that verifies the session user is an admin in the DB.
 * Sends 401 if not authenticated, 403 if not an admin.
 */
async function requireAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const email = request.session.userEmail;
  if (!email) {
    reply.code(401);
    await reply.send({ message: "Authentication required." });
    return;
  }

  // Developer always has full access
  if (email === "don@rapidcodecrafters.com") return;

  // Session role set at login (covers whitelist users who may not have a DB row)
  const sessionRole = request.session.userRole;
  if (sessionRole === "admin" || sessionRole === "developer") return;

  if (!isPostgresEnabled()) {
    // Without Postgres there are no managed users; treat auth-whitelist users as admins.
    return;
  }

  const result = await pgQuery<{ role: string }>(
    `SELECT COALESCE(r.role, 'viewer') AS role
     FROM users u
     LEFT JOIN user_roles r ON r.user_id = u.id
     WHERE u.email = $1 AND u.active = true`,
    [email]
  );

  const row = result.rows[0];
  if (!row || (row.role !== "admin" && row.role !== "developer")) {
    reply.code(403);
    await reply.send({ message: "Admin access required." });
  }
}

// ── Route registration ───────────────────────────────────────────────────────

export async function registerUserRoutes(app: FastifyInstance) {
  // ── GET /api/users — list all users with their roles (admin only) ──────────
  app.get(
    "/api/users",
    { preHandler: requireAdmin },
    async (_request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const [usersResult, invitesResult] = await Promise.all([
        pgQuery<UserWithRole>(
          `SELECT u.*, COALESCE(r.role, 'viewer') AS role
           FROM users u
           LEFT JOIN user_roles r ON r.user_id = u.id
           ORDER BY u.created_at`
        ),
        pgQuery<{ id: string; email: string; role: string; display_name: string; expires_at: Date; created_at: Date }>(
          `SELECT id, email, role, display_name, expires_at, created_at
           FROM user_invitations
           WHERE expires_at > now() AND accepted_at IS NULL
           ORDER BY created_at DESC`
        )
      ]);

      return {
        users: usersResult.rows,
        pendingInvitations: invitesResult.rows.map(inv => ({
          id: inv.id,
          email: inv.email,
          role: inv.role,
          displayName: inv.display_name,
          expiresAt: inv.expires_at,
          createdAt: inv.created_at,
          status: "pending"
        }))
      };
    }
  );

  // ── POST /api/users/invite — invite a new user (admin only) ───────────────
  app.post(
    "/api/users/invite",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const body = (request.body as { email?: unknown; role?: unknown; displayName?: unknown }) || {};
      const email = normalizeEmail(body.email);
      const role = String(body.role || "").trim();
      const displayName = String(body.displayName || "").trim();

      if (!email.includes("@")) {
        reply.code(400);
        return { message: "A valid email address is required." };
      }

      if (!isValidRole(role)) {
        reply.code(400);
        return { message: `Role must be one of: ${VALID_ROLES.join(", ")}.` };
      }

      // Check the user doesn't already exist.
      const existing = await pgQuery<{ id: string }>(
        "SELECT id FROM users WHERE email = $1",
        [email]
      );
      if (existing.rows.length > 0) {
        reply.code(409);
        return { message: "A user with that email address already exists." };
      }

      // Delete any existing pending invitation for this email.
      await pgQuery("DELETE FROM user_invitations WHERE email = $1", [email]);

      // Generate a secure token (two UUIDs joined, dashes removed).
      const token = (randomUUID() + randomUUID()).replace(/-/g, "");

      // Insert the invitation.
      const inviteId = randomUUID();
      const inviteResult = await pgQuery<{ id: string; email: string; role: string; token: string; expires_at: Date }>(
        `INSERT INTO user_invitations (id, email, role, display_name, token, expires_at)
         VALUES ($1, $2, $3, $4, $5, now() + interval '7 days')
         RETURNING id, email, role, token, expires_at`,
        [inviteId, email, role, displayName || null, token]
      );

      const invitation = inviteResult.rows[0];
      const inviteLink = `${apiConfig.server.publicUrl}/accept-invitation/${token}`;

      // Send email via SendGrid if configured, otherwise log the link.
      if (apiConfig.automation.sendgridApiKey) {
        sgMail.setApiKey(apiConfig.automation.sendgridApiKey);
        const fromEmail = apiConfig.automation.sendgridFromEmail || "noreply@example.com";
        const platformName = "Cadence Reporting Studio";
        const platformUrl = apiConfig.server.publicUrl || "https://cadencereportingstudio.com";
        const roleLabel = role.charAt(0).toUpperCase() + role.slice(1);
        const recipientName = displayName || email.split("@")[0];

        const htmlEmail = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F1F5F9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F1F5F9;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);max-width:560px;width:100%;">
        <!-- Green accent bar -->
        <tr><td style="background:linear-gradient(90deg,#0d7c66,#065F46);height:5px;"></td></tr>
        <!-- Header -->
        <tr><td style="padding:40px 40px 28px;text-align:center;">
          <div style="display:inline-block;background:#ECFDF5;border:1px solid #A7F3D0;border-radius:12px;padding:14px 20px;margin-bottom:20px;">
            <span style="font-size:28px;">⚡</span>
          </div>
          <h1 style="margin:0 0 6px;font-size:24px;font-weight:800;color:#111827;letter-spacing:-0.02em;">You've been invited!</h1>
          <p style="margin:0;font-size:15px;color:#6B7280;">You have been invited to join <strong style="color:#111827;">${platformName}</strong></p>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:0 40px 32px;">
          <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
            Hi ${recipientName},<br><br>
            You've been invited to join <strong>${platformName}</strong> as a <strong style="color:#0d7c66;">${roleLabel}</strong>.
            This platform lets you view, build, and manage reports and dashboards.
          </p>
          <!-- Role badge -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#ECFDF5;border:1px solid #A7F3D0;border-radius:10px;margin-bottom:28px;">
            <tr><td style="padding:14px 18px;">
              <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:#0d7c66;margin-bottom:3px;">Your role</div>
              <div style="font-size:14px;font-weight:600;color:#065F46;">${roleLabel} — access to ${role === "admin" ? "all features and user management" : role === "editor" ? "create and edit reports and dashboards" : "view shared reports and dashboards"}</div>
            </td></tr>
          </table>
          <!-- CTA button -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td align="center" style="padding-bottom:24px;">
              <a href="${inviteLink}" style="display:inline-block;background:#0d7c66;color:#ffffff;font-size:16px;font-weight:700;text-decoration:none;padding:14px 36px;border-radius:10px;letter-spacing:0.01em;">
                Accept invitation →
              </a>
            </td></tr>
          </table>
          <!-- Link fallback -->
          <p style="margin:0 0 8px;font-size:12px;color:#9CA3AF;text-align:center;">
            Or copy and paste this link into your browser:
          </p>
          <p style="margin:0;font-size:11px;color:#6B7280;text-align:center;word-break:break-all;">
            <a href="${inviteLink}" style="color:#0d7c66;">${inviteLink}</a>
          </p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F9FAFB;border-top:1px solid #E5E7EB;padding:20px 40px;text-align:center;">
          <p style="margin:0 0 4px;font-size:12px;color:#9CA3AF;">This invitation expires in <strong>7 days</strong>.</p>
          <p style="margin:0;font-size:12px;color:#9CA3AF;">
            <a href="${platformUrl}" style="color:#0d7c66;text-decoration:none;">${platformUrl}</a>
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

        const plainText = `Hi ${recipientName},\n\nYou've been invited to join ${platformName} as a ${roleLabel}.\n\nAccept your invitation here:\n${inviteLink}\n\nThis link expires in 7 days.\n\n${platformUrl}`;

        try {
          await sgMail.send({
            to: email,
            from: { email: fromEmail, name: platformName },
            subject: `You've been invited to join ${platformName}`,
            text: plainText,
            html: htmlEmail,
          });
        } catch (error) {
          app.log.error({ error, email }, "Failed to send invitation email via SendGrid");
        }
      } else {
        app.log.info({ email, role, inviteLink }, "User invitation created (SendGrid not configured — link logged)");
      }

      return {
        invitation: {
          id: invitation.id,
          email: invitation.email,
          role: invitation.role,
          token: invitation.token,
          expiresAt: invitation.expires_at
        }
      };
    }
  );

  // ── DELETE /api/users/invite/:id — cancel a pending invitation (admin only) ─
  app.delete(
    "/api/users/invite/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required." };
      }
      const { id } = request.params as { id: string };
      const result = await pgQuery<{ id: string }>(
        "DELETE FROM user_invitations WHERE id = $1 RETURNING id",
        [id]
      );
      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "Invitation not found." };
      }
      return { ok: true };
    }
  );

  // ── PUT /api/users/invite/:id — update a pending invitation role (admin) ────
  app.put(
    "/api/users/invite/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required." };
      }
      const { id } = request.params as { id: string };
      const body = (request.body as { role?: string; displayName?: string }) || {};
      const updates: string[] = [];
      const values: unknown[] = [];
      if (body.role) { values.push(body.role); updates.push(`role = $${values.length}`); }
      if (body.displayName !== undefined) { values.push(body.displayName); updates.push(`display_name = $${values.length}`); }
      if (!updates.length) { reply.code(400); return { message: "Nothing to update." }; }
      values.push(id);
      const result = await pgQuery<{ id: string; email: string; role: string }>(
        `UPDATE user_invitations SET ${updates.join(", ")} WHERE id = $${values.length} AND expires_at > now() RETURNING id, email, role`,
        values
      );
      if (result.rows.length === 0) { reply.code(404); return { message: "Invitation not found or expired." }; }
      return { invitation: result.rows[0] };
    }
  );

  // ── PUT /api/users/:id/role — change a user's role (admin only) ───────────
  app.put(
    "/api/users/:id/role",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const { id } = request.params as { id: string };
      const body = (request.body as { role?: unknown }) || {};
      const role = String(body.role || "").trim();

      if (!isValidRole(role)) {
        reply.code(400);
        return { message: `Role must be one of: ${VALID_ROLES.join(", ")}.` };
      }

      // Verify user exists.
      const userCheck = await pgQuery<{ id: string }>("SELECT id FROM users WHERE id = $1", [id]);
      if (userCheck.rows.length === 0) {
        reply.code(404);
        return { message: "User not found." };
      }

      await pgQuery(
        `INSERT INTO user_roles (user_id, role)
         VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role`,
        [id, role]
      );

      return { ok: true, role };
    }
  );

  // ── PUT /api/users/:id — update display_name and/or active (admin only) ───
  app.put(
    "/api/users/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const { id } = request.params as { id: string };
      const body = (request.body as { displayName?: unknown; active?: unknown }) || {};

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.displayName !== undefined) {
        values.push(String(body.displayName).trim() || null);
        updates.push(`display_name = $${values.length}`);
      }

      if (body.active !== undefined) {
        values.push(Boolean(body.active));
        updates.push(`active = $${values.length}`);
      }

      if (updates.length === 0) {
        reply.code(400);
        return { message: "Nothing to update. Provide displayName and/or active." };
      }

      values.push(id);
      const result = await pgQuery<UserRow>(
        `UPDATE users SET ${updates.join(", ")} WHERE id = $${values.length} RETURNING *`,
        values
      );

      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "User not found." };
      }

      return { user: result.rows[0] };
    }
  );

  // ── DELETE /api/users/:id — hard-delete user (cannot delete self) ───────────
  app.delete(
    "/api/users/:id",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const { id } = request.params as { id: string };
      const sessionEmail = request.session.userEmail;

      if (sessionEmail) {
        const selfResult = await pgQuery<{ id: string }>(
          "SELECT id FROM users WHERE email = $1", [sessionEmail]
        );
        if (selfResult.rows[0]?.id === id) {
          reply.code(400);
          return { message: "You cannot delete your own account." };
        }
      }

      const result = await pgQuery<{ id: string }>(
        "DELETE FROM users WHERE id = $1 RETURNING id", [id]
      );

      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "User not found." };
      }

      return { ok: true };
    }
  );

  // ── POST /api/users/:id/reset-password — send password reset link ────────────
  app.post(
    "/api/users/:id/reset-password",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required." };
      }

      const { id } = request.params as { id: string };
      const userResult = await pgQuery<{ id: string; email: string; display_name: string }>(
        "SELECT id, email, display_name FROM users WHERE id = $1 AND active = true", [id]
      );
      const user = userResult.rows[0];
      if (!user) { reply.code(404); return { message: "User not found." }; }

      // Delete any existing reset tokens for this user
      await pgQuery("DELETE FROM password_reset_tokens WHERE user_id = $1", [id]);

      const token = (randomUUID() + randomUUID()).replace(/-/g, "");
      const tokenId = randomUUID();
      await pgQuery(
        "INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')",
        [tokenId, id, token]
      );

      const resetLink = `${apiConfig.server.publicUrl}/reset-password/${token}`;

      if (apiConfig.automation.sendgridApiKey) {
        const { default: sgMail } = await import("@sendgrid/mail");
        sgMail.setApiKey(apiConfig.automation.sendgridApiKey);
        try {
          await sgMail.send({
            to: user.email,
            from: apiConfig.automation.sendgridFromEmail,
            subject: "Reset your password",
            text: `Hi ${user.display_name || user.email},\n\nClick the link below to reset your password. It expires in 1 hour.\n\n${resetLink}`,
            html: `<p>Hi ${user.display_name || user.email},</p><p>Click the link below to reset your password. It expires in 1 hour.</p><p><a href="${resetLink}">Reset password</a></p>`
          });
        } catch (err) {
          app.log.error({ error: err, email: user.email }, "Failed to send password reset email");
        }
      } else {
        app.log.info({ email: user.email, resetLink }, "Password reset link (SendGrid not configured)");
      }

      return { ok: true, message: `Password reset link sent to ${user.email}.` };
    }
  );

  // ── POST /api/users/:id/impersonate — admin impersonates another user ──────
  app.post(
    "/api/users/:id/impersonate",
    { preHandler: requireAdmin },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for user management." };
      }

      const { id } = request.params as { id: string };

      const userResult = await pgQuery<{ id: string; email: string }>(
        "SELECT id, email FROM users WHERE id = $1 AND active = true",
        [id]
      );

      if (userResult.rows.length === 0) {
        reply.code(404);
        return { message: "User not found or inactive." };
      }

      const target = userResult.rows[0];
      request.session.impersonatingUserId = target.id;
      request.session.impersonatingUserEmail = target.email;

      return { ok: true, impersonating: { id: target.id, email: target.email } };
    }
  );

  // ── DELETE /api/users/impersonate — stop impersonating ────────────────────
  app.delete(
    "/api/users/impersonate",
    { preHandler: requireAdmin },
    async (request) => {
      delete request.session.impersonatingUserId;
      delete request.session.impersonatingUserEmail;
      return { ok: true };
    }
  );
}
