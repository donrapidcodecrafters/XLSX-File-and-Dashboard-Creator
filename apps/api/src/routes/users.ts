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
  if (!row || row.role !== "admin") {
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

      const result = await pgQuery<UserWithRole>(
        `SELECT u.*, COALESCE(r.role, 'viewer') AS role
         FROM users u
         LEFT JOIN user_roles r ON r.user_id = u.id
         ORDER BY u.created_at`
      );

      return { users: result.rows };
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
      const inviteResult = await pgQuery<{ id: string; email: string; role: string; token: string; expires_at: Date }>(
        `INSERT INTO user_invitations (email, role, display_name, token, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '7 days')
         RETURNING id, email, role, token, expires_at`,
        [email, role, displayName || null, token]
      );

      const invitation = inviteResult.rows[0];
      const inviteLink = `${apiConfig.server.publicUrl}/accept-invitation/${token}`;

      // Send email via SendGrid if configured, otherwise log the link.
      if (apiConfig.automation.sendgridApiKey) {
        sgMail.setApiKey(apiConfig.automation.sendgridApiKey);
        const fromEmail = apiConfig.automation.sendgridFromEmail || "noreply@example.com";
        try {
          await sgMail.send({
            to: email,
            from: fromEmail,
            subject: "You have been invited",
            text: `You have been invited to join as a ${role}. Accept your invitation here:\n\n${inviteLink}\n\nThis link expires in 7 days.`,
            html: `<p>You have been invited to join as a <strong>${role}</strong>.</p><p><a href="${inviteLink}">Accept invitation</a></p><p>This link expires in 7 days.</p>`
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

  // ── DELETE /api/users/:id — deactivate user (cannot deactivate self) ───────
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

      // Resolve the requesting user's own ID to prevent self-deactivation.
      if (sessionEmail) {
        const selfResult = await pgQuery<{ id: string }>(
          "SELECT id FROM users WHERE email = $1",
          [sessionEmail]
        );
        const selfId = selfResult.rows[0]?.id;
        if (selfId && selfId === id) {
          reply.code(400);
          return { message: "You cannot deactivate your own account." };
        }
      }

      const result = await pgQuery<{ id: string }>(
        "UPDATE users SET active = false WHERE id = $1 RETURNING id",
        [id]
      );

      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "User not found." };
      }

      return { ok: true };
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
