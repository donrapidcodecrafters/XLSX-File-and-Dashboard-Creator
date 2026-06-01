import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

// ── Permission model ─────────────────────────────────────────────────────────

export const PERMISSION_KEYS = [
  "home.view",
  "viewing.view",
  "building.view", "building.create", "building.edit", "building.delete",
  "data.view", "data.import", "data.delete",
  "settings.view", "settings.edit",
  "users.view", "users.invite", "users.edit", "users.delete",
  "roles.view", "roles.manage",
  "testing.as_role", "testing.as_user",
  "reports.export",
] as const;

export type PermissionKey = typeof PERMISSION_KEYS[number];
export type PermissionMap = Partial<Record<PermissionKey, boolean>>;

export const BUILT_IN_ROLE_PERMISSIONS: Record<string, PermissionMap> = {
  developer: Object.fromEntries(PERMISSION_KEYS.map(k => [k, true])) as PermissionMap,
  admin: {
    "home.view": true, "viewing.view": true,
    "building.view": true, "building.create": true, "building.edit": true, "building.delete": true,
    "data.view": true, "data.import": true, "data.delete": true,
    "settings.view": true, "settings.edit": true,
    "users.view": true, "users.invite": true, "users.edit": true, "users.delete": true,
    "roles.view": true, "roles.manage": true,
    "testing.as_role": true, "testing.as_user": true,
    "reports.export": true,
  },
  editor: {
    "home.view": true, "viewing.view": true,
    "building.view": true, "building.create": true, "building.edit": true,
    "data.view": true, "data.import": true,
    "reports.export": true,
  },
  viewer: {
    "home.view": true, "viewing.view": true,
  },
};

export function getEffectivePermissions(role: string, customRolePermissions?: PermissionMap): PermissionMap {
  // Developer always gets everything
  if (role === "developer") return BUILT_IN_ROLE_PERMISSIONS.developer;
  const base = BUILT_IN_ROLE_PERMISSIONS[role] || {};
  return { ...base, ...(customRolePermissions || {}) };
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEVELOPER_EMAIL = "don@rapidcodecrafters.com";

const BUILT_IN_ROLE_NAMES = new Set(["developer", "admin", "editor", "viewer"]);

// ── Types ────────────────────────────────────────────────────────────────────

interface CustomRoleRow {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: PermissionMap;
  is_system: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Middleware that verifies the session user is an admin or developer.
 * Sends 401 if not authenticated, 403 if insufficient role.
 */
async function requireAdminOrDeveloper(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const email = request.session.userEmail;
  if (!email) {
    reply.code(401);
    await reply.send({ message: "Authentication required." });
    return;
  }

  // Developer email bypass
  if (email === DEVELOPER_EMAIL) return;

  if (!isPostgresEnabled()) {
    // Without Postgres, treat any authenticated user as admin
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

export async function registerRolesRoutes(app: FastifyInstance) {
  // ── GET /api/roles — list all built-in + custom roles with permissions ──────
  app.get(
    "/api/roles",
    async (_request, reply) => {
      // Build the built-in roles list
      const builtInRoles = Object.entries(BUILT_IN_ROLE_PERMISSIONS).map(([name, permissions]) => ({
        id: name,
        name,
        description: getBuiltInRoleDescription(name),
        color: getBuiltInRoleColor(name),
        permissions,
        isBuiltIn: true,
        is_system: true,
      }));

      if (!isPostgresEnabled()) {
        return { roles: builtInRoles };
      }

      const result = await pgQuery<CustomRoleRow>(
        `SELECT id, name, description, color, permissions, is_system, created_by, created_at, updated_at
         FROM custom_roles
         ORDER BY created_at`
      );

      const customRoles = result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        color: row.color,
        permissions: row.permissions,
        isBuiltIn: false,
        is_system: row.is_system,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
      }));

      return { roles: [...builtInRoles, ...customRoles] };
    }
  );

  // ── POST /api/roles — create a custom role (admin only) ───────────────────
  app.post(
    "/api/roles",
    { preHandler: requireAdminOrDeveloper },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for custom role management." };
      }

      const body = (request.body as {
        name?: unknown;
        description?: unknown;
        color?: unknown;
        permissions?: unknown;
      }) || {};

      const name = String(body.name || "").trim();
      const description = String(body.description || "").trim();
      const color = String(body.color || "#6B7280").trim();
      const permissions = (body.permissions && typeof body.permissions === "object" && !Array.isArray(body.permissions))
        ? body.permissions as PermissionMap
        : {};

      if (!name) {
        reply.code(400);
        return { message: "Role name is required." };
      }

      if (BUILT_IN_ROLE_NAMES.has(name.toLowerCase())) {
        reply.code(400);
        return { message: `"${name}" is a reserved built-in role name.` };
      }

      // Validate permission keys
      const invalidKeys = Object.keys(permissions).filter(
        (k) => !PERMISSION_KEYS.includes(k as PermissionKey)
      );
      if (invalidKeys.length > 0) {
        reply.code(400);
        return { message: `Unknown permission keys: ${invalidKeys.join(", ")}` };
      }

      const sessionEmail = request.session.userEmail || "";
      const id = randomUUID();

      const result = await pgQuery<CustomRoleRow>(
        `INSERT INTO custom_roles (id, name, description, color, permissions, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6)
         RETURNING id, name, description, color, permissions, is_system, created_by, created_at, updated_at`,
        [id, name, description, color, JSON.stringify(permissions), sessionEmail]
      );

      if (result.rows.length === 0) {
        reply.code(500);
        return { message: "Failed to create role." };
      }

      reply.code(201);
      return { role: { ...result.rows[0], isBuiltIn: false } };
    }
  );

  // ── PUT /api/roles/:id — update a custom role (admin/developer only) ───────
  app.put(
    "/api/roles/:id",
    { preHandler: requireAdminOrDeveloper },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for custom role management." };
      }

      const { id } = request.params as { id: string };

      // Prevent editing built-in roles
      if (BUILT_IN_ROLE_NAMES.has(id.toLowerCase())) {
        reply.code(400);
        return { message: "Built-in roles cannot be modified." };
      }

      const body = (request.body as {
        name?: unknown;
        description?: unknown;
        color?: unknown;
        permissions?: unknown;
      }) || {};

      const updates: string[] = [];
      const values: unknown[] = [];

      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) {
          reply.code(400);
          return { message: "Role name cannot be empty." };
        }
        if (BUILT_IN_ROLE_NAMES.has(name.toLowerCase())) {
          reply.code(400);
          return { message: `"${name}" is a reserved built-in role name.` };
        }
        values.push(name);
        updates.push(`name = $${values.length}`);
      }

      if (body.description !== undefined) {
        values.push(String(body.description).trim());
        updates.push(`description = $${values.length}`);
      }

      if (body.color !== undefined) {
        values.push(String(body.color).trim());
        updates.push(`color = $${values.length}`);
      }

      if (body.permissions !== undefined) {
        if (typeof body.permissions !== "object" || Array.isArray(body.permissions) || body.permissions === null) {
          reply.code(400);
          return { message: "permissions must be an object." };
        }
        const permissions = body.permissions as PermissionMap;
        const invalidKeys = Object.keys(permissions).filter(
          (k) => !PERMISSION_KEYS.includes(k as PermissionKey)
        );
        if (invalidKeys.length > 0) {
          reply.code(400);
          return { message: `Unknown permission keys: ${invalidKeys.join(", ")}` };
        }
        values.push(JSON.stringify(permissions));
        updates.push(`permissions = $${values.length}::jsonb`);
      }

      if (updates.length === 0) {
        reply.code(400);
        return { message: "Nothing to update. Provide name, description, color, and/or permissions." };
      }

      // Always bump updated_at without adding a bound parameter
      updates.push("updated_at = now()");

      values.push(id);
      const result = await pgQuery<CustomRoleRow>(
        `UPDATE custom_roles SET ${updates.join(", ")} WHERE id = $${values.length}
         RETURNING id, name, description, color, permissions, is_system, created_by, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "Custom role not found." };
      }

      return { role: { ...result.rows[0], isBuiltIn: false } };
    }
  );

  // ── DELETE /api/roles/:id — delete a custom role (cannot delete built-in) ──
  app.delete(
    "/api/roles/:id",
    { preHandler: requireAdminOrDeveloper },
    async (request, reply) => {
      if (!isPostgresEnabled()) {
        reply.code(503);
        return { message: "Postgres is required for custom role management." };
      }

      const { id } = request.params as { id: string };

      if (BUILT_IN_ROLE_NAMES.has(id.toLowerCase())) {
        reply.code(400);
        return { message: "Built-in roles cannot be deleted." };
      }

      const result = await pgQuery<{ id: string }>(
        "DELETE FROM custom_roles WHERE id = $1 RETURNING id",
        [id]
      );

      if (result.rows.length === 0) {
        reply.code(404);
        return { message: "Custom role not found." };
      }

      return { ok: true };
    }
  );

  // ── GET /api/me/permissions — current user's effective permission map ────────
  app.get(
    "/api/me/permissions",
    async (request, reply) => {
      const email = request.session.userEmail;
      if (!email) {
        reply.code(401);
        return { message: "Authentication required." };
      }

      const isDeveloper = email === DEVELOPER_EMAIL;

      // Developer always gets all permissions
      if (isDeveloper) {
        return {
          permissions: BUILT_IN_ROLE_PERMISSIONS.developer,
          role: "developer",
          isDeveloper: true,
        };
      }

      if (!isPostgresEnabled()) {
        // Without Postgres, return admin-level permissions for any authenticated user
        return {
          permissions: BUILT_IN_ROLE_PERMISSIONS.admin,
          role: "admin",
          isDeveloper: false,
        };
      }

      // Fetch the user's role and optional custom_role_id
      const userResult = await pgQuery<{ role: string; custom_role_id: string | null }>(
        `SELECT COALESCE(r.role, 'viewer') AS role, r.custom_role_id
         FROM users u
         LEFT JOIN user_roles r ON r.user_id = u.id
         WHERE u.email = $1 AND u.active = true`,
        [email]
      );

      if (userResult.rows.length === 0) {
        reply.code(403);
        return { message: "User not found or inactive." };
      }

      const { role, custom_role_id } = userResult.rows[0];

      // Get base permissions for the built-in role
      const basePermissions = BUILT_IN_ROLE_PERMISSIONS[role] || {};

      // If the user has a custom_role_id, fetch and merge those permissions
      let customPermissions: PermissionMap = {};
      if (custom_role_id) {
        const customResult = await pgQuery<{ permissions: PermissionMap }>(
          "SELECT permissions FROM custom_roles WHERE id = $1",
          [custom_role_id]
        );
        if (customResult.rows.length > 0) {
          customPermissions = customResult.rows[0].permissions || {};
        }
      }

      const effectivePermissions: PermissionMap = { ...basePermissions, ...customPermissions };

      return {
        permissions: effectivePermissions,
        role,
        isDeveloper: false,
      };
    }
  );
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function getBuiltInRoleDescription(role: string): string {
  switch (role) {
    case "developer": return "Full system access including developer tools.";
    case "admin":     return "Full access to manage users, roles, and all content.";
    case "editor":    return "Can create and edit content and import data.";
    case "viewer":    return "Read-only access to home and viewing sections.";
    default:          return "";
  }
}

function getBuiltInRoleColor(role: string): string {
  switch (role) {
    case "developer": return "#7C3AED";
    case "admin":     return "#DC2626";
    case "editor":    return "#2563EB";
    case "viewer":    return "#16A34A";
    default:          return "#6B7280";
  }
}
