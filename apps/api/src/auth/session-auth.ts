import cookie from "@fastify/cookie";
import session, { type SessionStore } from "@fastify/session";
import bcrypt from "bcryptjs";
import { generateSecret, generateURI, verifySync as _totpVerifySync } from "otplib";

// TOTP verifier with ±1 window (±30 s) clock drift tolerance.
// The functional verifySync always checks only the current 30-second window.
// We temporarily shift Date.now to check adjacent windows as well.
function totpVerify(token: string, secret: string): boolean {
  const PERIOD_MS = 30_000;
  const now = Date.now();
  for (const offset of [-PERIOD_MS, 0, PERIOD_MS]) {
    const origDateNow = Date.now;
    Date.now = () => now + offset;
    try {
      const result = _totpVerifySync({ token, secret, strategy: "totp" });
      if (result?.valid) return true;
    } catch {
      // continue
    } finally {
      Date.now = origDateNow;
    }
  }
  return false;
}
import QRCode from "qrcode";
import { randomUUID } from "node:crypto";
import type * as Fastify from "fastify";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { apiConfig, isPostgresEnabled } from "../config/env.js";
import { pgQuery } from "../db/postgres.js";
import { logAuditEvent } from "../services/audit-log.js";

/** The platform owner's email — always assigned the "developer" role. */
export const DEVELOPER_EMAIL = "don@rapidcodecrafters.com";

declare module "fastify" {
  interface Session {
    userEmail?: string;
    userId?: string;
    userRole?: string;
    displayName?: string;
    authenticatedAt?: string;
    impersonatingUserId?: string;
    impersonatingUserEmail?: string;
    impersonatingUserRole?: string;
  }
}

// ── Pending 2FA store (in-memory, 5-minute TTL) ──────────────────────────────
// Holds state between password check and TOTP verification.
// Safe for single-process PM2 fork mode.

interface PendingAuth {
  email: string;
  userId: string;
  userRole: string;
  displayName: string;
  /** True = user has no TOTP set up yet; secret is the newly-generated one */
  needsSetup: boolean;
  /** Pre-generated secret (stored here until setup is confirmed) */
  pendingSecret?: string;
  expiresAt: number;
}

const pending = new Map<string, PendingAuth>();

function cleanExpired() {
  const now = Date.now();
  for (const [token, entry] of pending) {
    if (entry.expiresAt < now) pending.delete(token);
  }
}

function createPendingToken(entry: Omit<PendingAuth, "expiresAt">): string {
  cleanExpired();
  const token = randomUUID();
  pending.set(token, { ...entry, expiresAt: Date.now() + 5 * 60 * 1000 });
  return token;
}

function consumePending(token: string): PendingAuth | null {
  const entry = pending.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pending.delete(token);
    return null;
  }
  return entry;
}

// ── TOTP helpers ─────────────────────────────────────────────────────────────

const TOTP_ISSUER = "Cadence Reporting Platform";

async function getTotpRecord(email: string, userId: string) {
  // Try users table first (DB users)
  if (userId && isPostgresEnabled()) {
    const r = await pgQuery<{ totp_secret: string | null; totp_enabled: boolean }>(
      "SELECT totp_secret, totp_enabled FROM users WHERE id = $1",
      [userId]
    );
    if (r.rows[0]) return r.rows[0];
  }
  // Fallback: user_totp table (whitelist users)
  if (isPostgresEnabled()) {
    const r = await pgQuery<{ totp_secret: string; totp_enabled: boolean }>(
      "SELECT totp_secret, totp_enabled FROM user_totp WHERE email = $1",
      [email]
    );
    if (r.rows[0]) return r.rows[0];
  }
  return null;
}

async function saveTotpSecret(email: string, userId: string, secret: string, enabled: boolean) {
  if (userId && isPostgresEnabled()) {
    await pgQuery(
      "UPDATE users SET totp_secret = $1, totp_enabled = $2, updated_at = now() WHERE id = $3",
      [secret, enabled, userId]
    );
    return;
  }
  if (isPostgresEnabled()) {
    await pgQuery(
      `INSERT INTO user_totp (email, totp_secret, totp_enabled)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET
         totp_secret = EXCLUDED.totp_secret,
         totp_enabled = EXCLUDED.totp_enabled,
         updated_at = now()`,
      [email, secret, enabled]
    );
  }
}

// ── Session store ─────────────────────────────────────────────────────────────

class PostgresSessionStore implements SessionStore {
  set(sessionId: string, sessionData: Fastify.Session, callback: (error?: unknown) => void) {
    const expires = sessionData.cookie?.expires instanceof Date
      ? sessionData.cookie.expires
      : new Date(Date.now() + apiConfig.auth.sessionTtlHours * 60 * 60 * 1000);
    pgQuery(
      `INSERT INTO session (sid, sess, expire) VALUES ($1, $2::json, $3)
       ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expire = EXCLUDED.expire`,
      [sessionId, JSON.stringify(sessionData), expires]
    ).then(() => callback()).catch(callback);
  }
  get(sessionId: string, callback: (error: unknown, result?: Fastify.Session | null) => void) {
    pgQuery<{ sess: Fastify.Session }>(
      "SELECT sess FROM session WHERE sid = $1 AND expire > now()",
      [sessionId]
    ).then((r) => callback(null, r.rows[0]?.sess || null)).catch((e) => callback(e));
  }
  destroy(sessionId: string, callback: (error?: unknown) => void) {
    pgQuery("DELETE FROM session WHERE sid = $1", [sessionId])
      .then(() => callback()).catch(callback);
  }
}

// ── Public paths (no session required) ──────────────────────────────────────

function isPublicAuthPath(path: string) {
  if (
    path === "/api/auth/login" ||
    path === "/api/auth/logout" ||
    path === "/api/auth/me" ||
    path === "/api/auth/2fa/setup" ||
    path === "/api/auth/2fa/setup/complete" ||
    path === "/api/auth/2fa/verify"
  ) return true;
  if (path.startsWith("/api/invitations/")) return true;
  if (path === "/api/admin/config") return true;
  return false;
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

// ── Main registration ─────────────────────────────────────────────────────────

export async function registerSessionAuth(app: FastifyInstance) {
  if (!apiConfig.auth.enabled) {
    if (process.env.NODE_ENV === "production") {
      app.log.warn("AUTH_ENABLED=false in production — all endpoints are unprotected.");
    }
    return;
  }
  if (apiConfig.auth.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters when AUTH_ENABLED=true.");
  }
  if (!isPostgresEnabled() && !apiConfig.auth.allowedUsers.length) {
    throw new Error("AUTH_WHITELIST_USERS required when AUTH_ENABLED=true and no DATABASE_URL.");
  }

  await app.register(cookie);
  await app.register(session, {
    secret: apiConfig.auth.sessionSecret,
    cookieName: apiConfig.auth.sessionCookieName,
    saveUninitialized: false,
    store: isPostgresEnabled() ? new PostgresSessionStore() : undefined,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: apiConfig.auth.sessionTtlHours * 60 * 60 * 1000
    }
  });

  // ── Step 1: POST /api/auth/login ──────────────────────────────────────────
  // Validates email + password. Does NOT create a session yet.
  // Returns { step: "2fa_required" | "2fa_setup_required", pendingToken }
  app.post("/api/auth/login", async (request, reply) => {
    const body = (request.body as { email?: string; password?: string } | undefined) || {};
    const email = normalizeEmail(body.email);
    const password = String(body.password || "");

    let userId = "";
    let userRole = "viewer";
    let displayName = "";
    let authenticated = false;

    // DB auth
    if (isPostgresEnabled()) {
      const result = await pgQuery<{
        id: string; password_hash: string; display_name: string; active: boolean;
      }>("SELECT id, password_hash, display_name, active FROM users WHERE email = $1 LIMIT 1", [email]);
      const dbUser = result.rows[0];
      if (dbUser && dbUser.active && await bcrypt.compare(password, dbUser.password_hash)) {
        userId = dbUser.id;
        displayName = dbUser.display_name;
        const roleResult = await pgQuery<{ role: string }>(
          "SELECT role FROM user_roles WHERE user_id = $1 LIMIT 1", [dbUser.id]
        );
        userRole = roleResult.rows[0]?.role || "viewer";
        await pgQuery("UPDATE users SET last_login_at = now(), updated_at = now() WHERE id = $1", [dbUser.id]);
        await pgQuery(
          `INSERT INTO user_preferences (user_id, theme) VALUES ($1, 'system') ON CONFLICT (user_id) DO NOTHING`,
          [dbUser.id]
        );
        authenticated = true;
      }
    }

    // Whitelist fallback — checked when:
    // a) Postgres is not configured, OR
    // b) Postgres is configured but this user was not found in the users table
    // This lets the developer account (in .env) work even before the DB has any users.
    if (!authenticated) {
      const wl = apiConfig.auth.allowedUsers.find((u) => u.email === email);
      if (wl && await bcrypt.compare(password, wl.passwordHash)) {
        authenticated = true;
        userRole = "admin";
      }
    }

    if (!authenticated) {
      reply.code(401);
      return { message: "Invalid email or password." };
    }

    if (email === DEVELOPER_EMAIL) userRole = "developer";

    // Check TOTP status
    const totpRecord = await getTotpRecord(email, userId);
    const totpSetup = Boolean(totpRecord?.totp_enabled && totpRecord?.totp_secret);

    if (!totpSetup) {
      // Generate a fresh TOTP secret for setup (not saved yet)
      const newSecret = generateSecret();
      const pendingToken = createPendingToken({
        email, userId, userRole, displayName,
        needsSetup: true,
        pendingSecret: newSecret,
      });
      return { step: "2fa_setup_required", pendingToken };
    }

    // TOTP already configured — ask for the 6-digit code
    const pendingToken = createPendingToken({
      email, userId, userRole, displayName,
      needsSetup: false,
    });
    return { step: "2fa_required", pendingToken };
  });

  // ── Step 2a (setup): GET /api/auth/2fa/setup ─────────────────────────────
  // Returns a QR code data URL so the user can scan with Microsoft Authenticator.
  app.get("/api/auth/2fa/setup", async (request, reply) => {
    const { pendingToken } = request.query as { pendingToken?: string };
    if (!pendingToken) {
      reply.code(400);
      return { message: "pendingToken is required." };
    }
    const entry = consumePending(pendingToken);
    if (!entry) {
      reply.code(401);
      return { message: "Session expired. Please sign in again." };
    }
    if (!entry.needsSetup || !entry.pendingSecret) {
      reply.code(400);
      return { message: "2FA is already configured for this account." };
    }

    // Re-create the token so it stays valid after this GET
    const refreshed = createPendingToken(entry);

    const otpauthUri = generateURI({ strategy: "totp", label: entry.email, issuer: TOTP_ISSUER, secret: entry.pendingSecret });
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUri, { width: 256, margin: 2 });

    return {
      pendingToken: refreshed,
      qrCodeDataUrl,
      secret: entry.pendingSecret,        // shown as manual-entry fallback
      issuer: TOTP_ISSUER,
      email: entry.email,
    };
  });

  // ── Step 2b (setup): POST /api/auth/2fa/setup/complete ───────────────────
  // User scanned the QR and entered the 6-digit code. Saves the secret + creates session.
  app.post("/api/auth/2fa/setup/complete", async (request, reply) => {
    const body = (request.body as { pendingToken?: string; code?: string } | undefined) || {};
    const pendingToken = String(body.pendingToken || "");
    const code = String(body.code || "").replace(/\s/g, "");

    if (!pendingToken || !code) {
      reply.code(400);
      return { message: "pendingToken and code are required." };
    }

    const entry = consumePending(pendingToken);
    if (!entry) {
      reply.code(401);
      return { message: "Session expired. Please sign in again." };
    }
    if (!entry.needsSetup || !entry.pendingSecret) {
      reply.code(400);
      return { message: "2FA is already configured for this account." };
    }

    const valid = totpVerify(code, entry.pendingSecret);
    if (!valid) {
      // Re-create token so user can retry
      createPendingToken(entry);
      reply.code(401);
      return { message: "Incorrect code. Check your authenticator app and try again." };
    }

    // Save the verified secret
    await saveTotpSecret(entry.email, entry.userId, entry.pendingSecret, true);
    void logAuditEvent("2fa_setup_complete", { userEmail: entry.email });

    // Create authenticated session
    await request.session.regenerate();
    request.session.userEmail = entry.email;
    request.session.userId = entry.userId;
    request.session.userRole = entry.userRole;
    request.session.displayName = entry.displayName;
    request.session.authenticatedAt = new Date().toISOString();
    void logAuditEvent("login", { userEmail: entry.email, metadata: { method: "2fa_setup", role: entry.userRole } });

    return { user: { email: entry.email, id: entry.userId, role: entry.userRole, displayName: entry.displayName } };
  });

  // ── Step 2c (existing): POST /api/auth/2fa/verify ────────────────────────
  // User already has 2FA set up. Verifies the 6-digit code and creates session.
  app.post("/api/auth/2fa/verify", async (request, reply) => {
    const body = (request.body as { pendingToken?: string; code?: string } | undefined) || {};
    const pendingToken = String(body.pendingToken || "");
    const code = String(body.code || "").replace(/\s/g, "");

    if (!pendingToken || !code) {
      reply.code(400);
      return { message: "pendingToken and code are required." };
    }

    const entry = consumePending(pendingToken);
    if (!entry) {
      reply.code(401);
      return { message: "Session expired. Please sign in again." };
    }

    // Load the saved TOTP secret
    const totpRecord = await getTotpRecord(entry.email, entry.userId);
    if (!totpRecord?.totp_secret || !totpRecord.totp_enabled) {
      reply.code(400);
      return { message: "2FA is not configured for this account." };
    }

    const valid = totpVerify(code, totpRecord.totp_secret);
    if (!valid) {
      // Re-create token so user can retry
      createPendingToken(entry);
      reply.code(401);
      return { message: "Incorrect code. Check your authenticator app and try again." };
    }

    // Create authenticated session
    await request.session.regenerate();
    request.session.userEmail = entry.email;
    request.session.userId = entry.userId;
    request.session.userRole = entry.userRole;
    request.session.displayName = entry.displayName;
    request.session.authenticatedAt = new Date().toISOString();
    void logAuditEvent("login", { userEmail: entry.email, metadata: { method: "2fa_verify", role: entry.userRole } });

    return { user: { email: entry.email, id: entry.userId, role: entry.userRole, displayName: entry.displayName } };
  });

  app.post("/api/auth/logout", async (request) => {
    const email = request.session.userEmail || "";
    await request.session.destroy();
    void logAuditEvent("logout", { userEmail: email });
    return { ok: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    if (!request.session.userEmail) {
      reply.code(401);
      return { authenticated: false };
    }
    const isImpersonating = Boolean(request.session.impersonatingUserId);
    const effectiveUserId = request.session.impersonatingUserId || request.session.userId || "";
    const effectiveEmail = request.session.impersonatingUserEmail || request.session.userEmail || "";

    let displayName = "";
    let effectiveRole = request.session.userRole || "viewer";
    let theme = "system";

    if (isPostgresEnabled() && effectiveUserId) {
      const [userRow, roleRow, prefRow] = await Promise.all([
        pgQuery<{ display_name: string }>("SELECT display_name FROM users WHERE id = $1", [effectiveUserId]),
        pgQuery<{ role: string }>("SELECT role FROM user_roles WHERE user_id = $1 LIMIT 1", [effectiveUserId]),
        pgQuery<{ theme: string }>("SELECT theme FROM user_preferences WHERE user_id = $1", [effectiveUserId])
      ]);
      displayName = userRow.rows[0]?.display_name ?? "";
      effectiveRole = roleRow.rows[0]?.role || effectiveRole;
      theme = prefRow.rows[0]?.theme || "system";
    }

    if (effectiveEmail === DEVELOPER_EMAIL) effectiveRole = "developer";

    const response: Record<string, unknown> = {
      authenticated: true,
      user: { email: effectiveEmail, id: effectiveUserId, role: effectiveRole, displayName, theme }
    };
    if (isImpersonating) {
      response.impersonating = true;
      response.realUser = { email: request.session.userEmail };
    }
    return response;
  });

  app.addHook("preHandler", async (request, reply) => {
    const path = request.url.split("?")[0] || "";
    if (!path.startsWith("/api/") || isPublicAuthPath(path)) return;

    if (!request.session.userEmail) {
      reply.code(401);
      return reply.send({ message: "Authentication required." });
    }

    if (isPostgresEnabled() && request.session.userId) {
      const result = await pgQuery<{ active: boolean }>(
        "SELECT active FROM users WHERE id = $1 LIMIT 1", [request.session.userId]
      );
      if (result.rows[0] && !result.rows[0].active) {
        await request.session.destroy();
        reply.code(401);
        return reply.send({ message: "Account is inactive." });
      }
    }
  });
}

export function getRealSessionUser(request: FastifyRequest) {
  const isImpersonating = Boolean(request.session.impersonatingUserId);
  return {
    email: isImpersonating ? (request.session.impersonatingUserEmail ?? "") : (request.session.userEmail ?? ""),
    id: isImpersonating ? (request.session.impersonatingUserId ?? "") : (request.session.userId ?? ""),
    role: request.session.userRole ?? "viewer",
    isImpersonating,
    realEmail: request.session.userEmail ?? ""
  };
}
