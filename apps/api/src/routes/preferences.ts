import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import type { FastifyInstance } from "fastify";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

export async function registerPreferencesRoutes(app: FastifyInstance) {

  // ── GET /api/me — current user profile + role + preferences ───────────────
  app.get("/api/me", async (request, reply) => {
    const sess = (request as unknown as { session: {
      userEmail?: string; userId?: string; userRole?: string;
      displayName?: string; impersonatingUserId?: string;
      impersonatingUserEmail?: string; impersonatingUserRole?: string;
    } }).session;
    if (!sess?.userEmail) { reply.code(401); return { message: "Not authenticated." }; }

    const effectiveUserId = sess.impersonatingUserId || sess.userId || "";
    const effectiveEmail = sess.impersonatingUserEmail || sess.userEmail;
    const effectiveRole = sess.impersonatingUserRole || sess.userRole || "viewer";
    const isImpersonating = Boolean(sess.impersonatingUserId);

    let displayName = isImpersonating ? (sess.impersonatingUserEmail || "") : (sess.displayName || "");
    let theme = "system";

    if (isPostgresEnabled() && effectiveUserId) {
      const userResult = await pgQuery<{ display_name: string }>(
        "SELECT display_name FROM users WHERE id = $1", [effectiveUserId]
      ).catch(() => null);
      if (userResult?.rows[0]) displayName = userResult.rows[0].display_name;

      const prefResult = await pgQuery<{ theme: string }>(
        "SELECT theme FROM user_preferences WHERE user_id = $1", [effectiveUserId]
      ).catch(() => null);
      theme = prefResult?.rows[0]?.theme || "system";
    }

    const response: Record<string, unknown> = {
      user: { id: effectiveUserId, email: effectiveEmail, displayName, role: effectiveRole, theme }
    };
    if (isImpersonating) {
      response.impersonating = true;
      response.realUser = { email: sess.userEmail };
    }
    return response;
  });

  // ── PUT /api/me/preferences ────────────────────────────────────────────────
  app.put("/api/me/preferences", async (request, reply) => {
    const sess = (request as unknown as { session: { userId?: string; displayName?: string } }).session;
    if (!isPostgresEnabled() || !sess?.userId) {
      reply.code(503); return { message: "Postgres required." };
    }
    const body = (request.body as { theme?: string; displayName?: string; preferences?: Record<string, unknown> } | undefined) || {};
    const userId = sess.userId;

    if (body.displayName !== undefined) {
      await pgQuery("UPDATE users SET display_name = $1, updated_at = now() WHERE id = $2", [body.displayName.trim(), userId]);
      sess.displayName = body.displayName.trim();
    }

    const validThemes = ["light", "dark", "system"];
    const theme = validThemes.includes(String(body.theme || "")) ? String(body.theme) : undefined;

    await pgQuery(`
      INSERT INTO user_preferences (user_id, theme, preferences, updated_at)
      VALUES ($1, $2, $3::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET
        theme = COALESCE($2, user_preferences.theme),
        preferences = CASE WHEN $3::jsonb IS NOT NULL
          THEN user_preferences.preferences || $3::jsonb
          ELSE user_preferences.preferences END,
        updated_at = now()
    `, [userId, theme || null, body.preferences ? JSON.stringify(body.preferences) : null]);

    return { ok: true };
  });

  // ── PUT /api/me/password ───────────────────────────────────────────────────
  app.put("/api/me/password", async (request, reply) => {
    const sess = (request as unknown as { session: { userId?: string } }).session;
    if (!isPostgresEnabled() || !sess?.userId) {
      reply.code(503); return { message: "Postgres required." };
    }
    const body = (request.body as { currentPassword?: string; newPassword?: string } | undefined) || {};
    const currentPassword = String(body.currentPassword || "");
    const newPassword = String(body.newPassword || "");

    if (newPassword.length < 8) { reply.code(400); return { message: "New password must be at least 8 characters." }; }

    const result = await pgQuery<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE id = $1", [sess.userId]
    );
    if (!result.rows.length) { reply.code(404); return { message: "User not found." }; }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) { reply.code(401); return { message: "Current password is incorrect." }; }

    const newHash = await bcrypt.hash(newPassword, 12);
    await pgQuery("UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2", [newHash, sess.userId]);
    return { ok: true };
  });
}
