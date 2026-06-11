import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import bcrypt from "bcryptjs";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

// ── Types ────────────────────────────────────────────────────────────────────

interface InvitationRow {
  id: string;
  email: string;
  role: string;
  display_name: string;
  invited_by: string;
  expires_at: Date;
}

// ── Route registration ───────────────────────────────────────────────────────

export async function registerInvitationRoutes(app: FastifyInstance) {
  // ── GET /api/invitations/:token — verify a token is valid ─────────────────
  app.get("/api/invitations/:token", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is required for invitation management." };
    }

    const { token } = request.params as { token: string };

    // Fetch the row regardless of status so we can give a specific reason.
    const result = await pgQuery<InvitationRow & { accepted_at: Date | null }>(
      `SELECT id, email, role, display_name, invited_by, expires_at, accepted_at
       FROM user_invitations
       WHERE token = $1`,
      [token]
    );

    const invitation = result.rows[0];
    if (!invitation) {
      reply.code(404);
      return { message: "This invitation has been canceled or does not exist.", reason: "canceled" };
    }
    if (invitation.accepted_at) {
      reply.code(410);
      return { message: "This invitation has already been accepted.", reason: "accepted" };
    }
    if (new Date(invitation.expires_at) <= new Date()) {
      reply.code(410);
      return { message: "This invitation has expired.", reason: "expired" };
    }

    return {
      invitation: {
        email: invitation.email,
        role: invitation.role,
        displayName: invitation.display_name,
        expiresAt: invitation.expires_at
      }
    };
  });

  // ── POST /api/invitations/:token/accept — accept invitation, create user ───
  app.post("/api/invitations/:token/accept", async (request, reply) => {
    if (!isPostgresEnabled()) {
      reply.code(503);
      return { message: "Postgres is required for invitation management." };
    }

    const { token } = request.params as { token: string };
    const body = (request.body as { displayName?: unknown; password?: unknown }) || {};
    const password = String(body.password || "");
    const displayName = String(body.displayName || "").trim();

    // Validate password length.
    if (password.length < 8) {
      reply.code(400);
      return { message: "Password must be at least 8 characters." };
    }

    // Find the invitation — must be valid, not accepted, and not expired.
    const inviteResult = await pgQuery<InvitationRow>(
      `SELECT id, email, role, display_name, invited_by, expires_at
       FROM user_invitations
       WHERE token = $1
         AND accepted_at IS NULL
         AND expires_at > now()`,
      [token]
    );

    const invitation = inviteResult.rows[0];
    if (!invitation) {
      reply.code(404);
      return { message: "Invitation not found, already accepted, or expired." };
    }

    const email = invitation.email;

    // Check no user already exists with this email.
    const existingUser = await pgQuery<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (existingUser.rows.length > 0) {
      reply.code(409);
      return { message: "A user with that email address already exists." };
    }

    // Hash the password.
    const passwordHash = await bcrypt.hash(password, 12);

    // Generate user ID.
    const userId = randomUUID();

    // Use the provided displayName if given, otherwise fall back to the
    // display_name stored on the invitation.
    const resolvedDisplayName = displayName || invitation.display_name || "";

    // INSERT user.
    await pgQuery(
      `INSERT INTO users (id, email, password_hash, display_name)
       VALUES ($1, $2, $3, $4)`,
      [userId, email, passwordHash, resolvedDisplayName]
    );

    // INSERT user_roles.
    await pgQuery(
      `INSERT INTO user_roles (id, user_id, role, granted_by)
       VALUES ($1, $2, $3, $4)`,
      [randomUUID(), userId, invitation.role, invitation.invited_by]
    );

    // INSERT user_preferences.
    await pgQuery(
      `INSERT INTO user_preferences (user_id, theme)
       VALUES ($1, 'system')`,
      [userId]
    );

    // Mark invitation as accepted.
    await pgQuery(
      "UPDATE user_invitations SET accepted_at = now() WHERE id = $1",
      [invitation.id]
    );

    // Create a session so the user is logged in immediately after accepting.
    await request.session.regenerate();
    request.session.userId = userId;
    request.session.userEmail = email;
    request.session.userRole = invitation.role;
    request.session.displayName = resolvedDisplayName;
    request.session.authenticatedAt = new Date().toISOString();

    return {
      user: {
        id: userId,
        email,
        displayName: resolvedDisplayName,
        role: invitation.role
      }
    };
  });
}
