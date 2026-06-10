import { useEffect, useState } from "react";
import {
  listRoles,
  createRole,
  updateRole,
  deleteRole,
} from "../lib/studioApi";

// ── Design tokens ──────────────────────────────────────────────────────────────

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const PRIMARY = "#0d7c66";
const PRIMARY_DARK = "#065F46";
const PRIMARY_BG = "#ECFDF5";
const PRIMARY_BORDER = "#A7F3D0";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RolePermissions {
  // Content Access
  "home.view"?: boolean;
  "viewing.view"?: boolean;
  // Building
  "building.view"?: boolean;
  "building.create"?: boolean;
  "building.edit"?: boolean;
  "building.delete"?: boolean;
  // Data Management
  "data.view"?: boolean;
  "data.import"?: boolean;
  "data.delete"?: boolean;
  // Settings
  "settings.view"?: boolean;
  "settings.edit"?: boolean;
  // User Management
  "users.view"?: boolean;
  "users.invite"?: boolean;
  "users.edit"?: boolean;
  "users.delete"?: boolean;
  // Role Management
  "roles.view"?: boolean;
  "roles.manage"?: boolean;
  // Testing
  "testing.as_role"?: boolean;
  "testing.as_user"?: boolean;
  // Reporting
  "reports.export"?: boolean;
}

export interface PlatformRole {
  id: string;
  name: string;
  description: string;
  color: string;
  permissions: RolePermissions;
  isBuiltIn: boolean;
  createdAt?: string;
  updatedAt?: string;
}

// ── Permission group definitions ───────────────────────────────────────────────

interface PermissionDef {
  key: keyof RolePermissions;
  label: string;
  description: string;
}

interface PermissionGroup {
  id: string;
  label: string;
  permissions: PermissionDef[];
}

const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    id: "content",
    label: "Content Access",
    permissions: [
      { key: "home.view", label: "View Home", description: "Access the home and landing page" },
      { key: "viewing.view", label: "View Reports & Dashboards", description: "Open and interact with shared reports and dashboards" },
    ],
  },
  {
    id: "building",
    label: "Report & Dashboard Builder",
    permissions: [
      { key: "building.view", label: "Open the Builder", description: "Access the report and dashboard builder" },
      { key: "building.create", label: "Create Reports & Dashboards", description: "Build and save new reports and dashboards" },
      { key: "building.edit", label: "Edit Reports & Dashboards", description: "Modify existing reports and dashboards" },
      { key: "building.delete", label: "Delete Reports & Dashboards", description: "Permanently remove reports and dashboards" },
    ],
  },
  {
    id: "data",
    label: "Data Sources",
    permissions: [
      { key: "data.view", label: "View Data Sources", description: "Browse connected data sources and their contents" },
      { key: "data.import", label: "Import & Upload Data", description: "Upload Excel files or sync from connected sources" },
      { key: "data.delete", label: "Remove Data Sources", description: "Delete data sources and their cached records" },
    ],
  },
  {
    id: "settings",
    label: "Platform Settings",
    permissions: [
      { key: "settings.view", label: "View Settings", description: "See platform and workspace configuration" },
      { key: "settings.edit", label: "Change Settings", description: "Update platform name, branding, and configuration" },
    ],
  },
  {
    id: "users",
    label: "User Management",
    permissions: [
      { key: "users.view", label: "View Users", description: "See all users and their assigned roles" },
      { key: "users.invite", label: "Invite New Users", description: "Send email invitations to new users" },
      { key: "users.edit", label: "Edit User Profiles", description: "Update user display names and account status" },
      { key: "users.delete", label: "Remove Users", description: "Deactivate or permanently delete user accounts" },
    ],
  },
  {
    id: "roles",
    label: "Role & Permission Management",
    permissions: [
      { key: "roles.view", label: "View Roles", description: "See all roles and their permission settings" },
      { key: "roles.manage", label: "Create & Edit Roles", description: "Create, modify, and delete custom roles" },
    ],
  },
  {
    id: "testing",
    label: "Testing & Impersonation",
    permissions: [
      { key: "testing.as_role", label: "Preview as a Role", description: "See the app as a specific role would see it" },
      { key: "testing.as_user", label: "Impersonate a User", description: "Log in as another user to test their experience" },
    ],
  },
  {
    id: "reporting",
    label: "Exports",
    permissions: [
      { key: "reports.export", label: "Export Reports", description: "Download reports as Excel, PDF, or other file formats" },
    ],
  },
];

// ── Built-in role default permissions ──────────────────────────────────────────

const BUILT_IN_PERMISSIONS: Record<string, RolePermissions> = {
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
    "building.view": true, "building.create": true, "building.edit": true, "building.delete": false,
    "data.view": true, "data.import": true, "data.delete": false,
    "settings.view": false, "settings.edit": false,
    "users.view": false, "users.invite": false, "users.edit": false, "users.delete": false,
    "roles.view": false, "roles.manage": false,
    "testing.as_role": false, "testing.as_user": false,
    "reports.export": true,
  },
  viewer: {
    "home.view": true, "viewing.view": true,
    "building.view": false, "building.create": false, "building.edit": false, "building.delete": false,
    "data.view": false, "data.import": false, "data.delete": false,
    "settings.view": false, "settings.edit": false,
    "users.view": false, "users.invite": false, "users.edit": false, "users.delete": false,
    "roles.view": false, "roles.manage": false,
    "testing.as_role": false, "testing.as_user": false,
    "reports.export": false,
  },
  developer: {
    "home.view": true, "viewing.view": true,
    "building.view": true, "building.create": true, "building.edit": true, "building.delete": true,
    "data.view": true, "data.import": true, "data.delete": true,
    "settings.view": true, "settings.edit": true,
    "users.view": true, "users.invite": true, "users.edit": true, "users.delete": true,
    "roles.view": true, "roles.manage": true,
    "testing.as_role": true, "testing.as_user": true,
    "reports.export": true,
  },
};

const BUILT_IN_ROLES: PlatformRole[] = [
  {
    id: "admin",
    name: "Admin",
    description: "Full access to all features and user management.",
    color: "#065F46",
    permissions: BUILT_IN_PERMISSIONS.admin,
    isBuiltIn: true,
  },
  {
    id: "editor",
    name: "Editor",
    description: "Can create and edit reports and dashboards.",
    color: "#1D4ED8",
    permissions: BUILT_IN_PERMISSIONS.editor,
    isBuiltIn: true,
  },
  {
    id: "viewer",
    name: "Viewer",
    description: "Can read and use shared reports and dashboards.",
    color: "var(--text-soft, #6B7280)",
    permissions: BUILT_IN_PERMISSIONS.viewer,
    isBuiltIn: true,
  },
  {
    id: "developer",
    name: "Developer",
    description: "Full access to everything — reserved for the platform developer.",
    color: "#7C3AED",
    permissions: BUILT_IN_PERMISSIONS.developer,
    isBuiltIn: true,
  },
];

// ── Colour swatch options ──────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  "#0d7c66", "#065F46", "#1D4ED8", "#1E40AF", "#7C3AED", "#6D28D9",
  "#B45309", "#92400E", "#DC2626", "#991B1B", "#0891B2", "#0E7490",
  "#374151", "#111827", "#9CA3AF", "#6B7280",
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function countGranted(permissions: RolePermissions): number {
  return Object.values(permissions).filter(Boolean).length;
}

function totalPermissions(): number {
  return PERMISSION_GROUPS.reduce((sum, g) => sum + g.permissions.length, 0);
}

function emptyPermissions(): RolePermissions {
  const out: RolePermissions = {};
  for (const group of PERMISSION_GROUPS) {
    for (const perm of group.permissions) {
      out[perm.key] = false;
    }
  }
  return out;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function RoleListItem({
  role,
  selected,
  onClick,
}: {
  role: PlatformRole;
  selected: boolean;
  onClick: () => void;
}) {
  const granted = countGranted(role.permissions);
  const total = totalPermissions();

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "10px 14px",
        border: "none",
        borderRadius: 8,
        background: selected ? PRIMARY_BG : "transparent",
        cursor: "pointer",
        textAlign: "left",
        transition: "background 80ms",
        outline: selected ? `2px solid ${PRIMARY_BORDER}` : "none",
        outlineOffset: -2,
      }}
      onMouseEnter={(e) => {
        if (!selected) e.currentTarget.style.background = "var(--surface-hover, #F9FAFB)";
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = "transparent";
      }}
    >
      {/* Colour dot */}
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: role.color,
          flexShrink: 0,
          boxShadow: `0 0 0 2px ${role.color}33`,
        }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--text, #111827)",
          display: "flex",
          alignItems: "center",
          gap: 6,
        }}>
          {role.name}
          {role.isBuiltIn && (
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "var(--text-muted, #9CA3AF)",
              background: "var(--surface-hover, #F3F4F6)",
              border: "1px solid #E5E7EB",
              borderRadius: 4,
              padding: "1px 5px",
            }}>
              Built-in
            </span>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted, #9CA3AF)", marginTop: 1 }}>
          {granted}/{total} permissions
        </div>
      </div>
    </button>
  );
}

interface PermissionGroupCardProps {
  group: PermissionGroup;
  permissions: RolePermissions;
  readOnly: boolean;
  onChange: (key: keyof RolePermissions, value: boolean) => void;
}

function PermissionGroupCard({ group, permissions, readOnly, onChange }: PermissionGroupCardProps) {
  const grantedCount = group.permissions.filter((p) => permissions[p.key]).length;
  const allGranted = grantedCount === group.permissions.length;
  const noneGranted = grantedCount === 0;

  function handleToggleAll() {
    const next = !allGranted;
    for (const perm of group.permissions) {
      onChange(perm.key, next);
    }
  }

  return (
    <div style={{
      border: "1px solid #E5E7EB",
      borderRadius: 10,
      overflow: "hidden",
      background: "var(--surface, #FFFFFF)",
    }}>
      {/* Group header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "10px 14px",
        background: "var(--surface-alt, #F9FAFB)",
        borderBottom: "1px solid var(--border, #F3F4F6)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>
            {group.label}
          </span>
          <span style={{
            fontSize: 10,
            color: grantedCount > 0 ? PRIMARY_DARK : "#9CA3AF",
            background: grantedCount > 0 ? PRIMARY_BG : "#F3F4F6",
            border: `1px solid ${grantedCount > 0 ? PRIMARY_BORDER : "#E5E7EB"}`,
            borderRadius: 99,
            padding: "1px 7px",
            fontWeight: 600,
          }}>
            {grantedCount}/{group.permissions.length}
          </span>
        </div>
        {!readOnly && (
          <button
            type="button"
            onClick={handleToggleAll}
            style={{
              fontSize: 11,
              fontWeight: 600,
              fontFamily: FONT,
              color: allGranted ? "#DC2626" : PRIMARY,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "2px 6px",
              borderRadius: 4,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover, #F3F4F6)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
          >
            {allGranted ? "Remove all" : noneGranted ? "Grant all" : "Grant all"}
          </button>
        )}
      </div>

      {/* Permission rows */}
      <div>
        {group.permissions.map((perm, idx) => {
          const granted = Boolean(permissions[perm.key]);
          return (
            <label
              key={perm.key}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                padding: "9px 14px",
                cursor: readOnly ? "default" : "pointer",
                borderBottom: idx < group.permissions.length - 1 ? "1px solid #F3F4F6" : "none",
                background: granted && !readOnly ? "#FAFFFE" : "transparent",
                transition: "background 60ms",
              }}
              onMouseEnter={(e) => {
                if (!readOnly) (e.currentTarget as HTMLLabelElement).style.background = granted ? "var(--brand-light, #F0FDF9)" : "var(--surface-hover, #FAFAFA)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLLabelElement).style.background = granted && !readOnly ? "var(--brand-light, #FAFFFE)" : "transparent";
              }}
            >
              <input
                type="checkbox"
                className="check-native"
                checked={granted}
                disabled={readOnly}
                onChange={(e) => onChange(perm.key, e.target.checked)}
                style={{
                  marginTop: 2,
                  cursor: readOnly ? "not-allowed" : "pointer",
                }}
              />
              <div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: readOnly && !granted ? "#9CA3AF" : "#111827",
                  fontFamily: FONT,
                }}>
                  {perm.label}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-soft, #6B7280)", marginTop: 1, fontFamily: FONT }}>
                  {perm.description}
                </div>
              </div>
            </label>
          );
        })}
      </div>
    </div>
  );
}

// ── Delete confirmation dialog ─────────────────────────────────────────────────

function DeleteConfirmDialog({
  role,
  onConfirm,
  onCancel,
  deleting,
}: {
  role: PlatformRole;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}) {
  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 2000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.45)",
    }}>
      <div style={{
        background: "var(--surface, #fff)",
        borderRadius: 14,
        border: "1px solid #E5E7EB",
        boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        padding: "28px 32px",
        maxWidth: 420,
        width: "calc(100% - 40px)",
        fontFamily: FONT,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text, #111827)", marginBottom: 8 }}>
          Delete "{role.name}"?
        </div>
        <div style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", marginBottom: 22, lineHeight: 1.6 }}>
          This custom role will be permanently removed. Users currently assigned this role will lose these permissions.
          This action cannot be undone.
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={deleting}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid #E5E7EB",
              background: "var(--surface-alt, #F9FAFB)",
              color: "var(--text-secondary, #374151)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: deleting ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => { if (!deleting) e.currentTarget.style.background = "var(--surface-hover, #F3F4F6)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-alt, #F9FAFB)"; }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              background: "#DC2626",
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: deleting ? "not-allowed" : "pointer",
              opacity: deleting ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!deleting) e.currentTarget.style.background = "#B91C1C"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#DC2626"; }}
          >
            {deleting ? "Deleting…" : "Delete role"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RoleManagementPage() {
  const [customRoles, setCustomRoles] = useState<PlatformRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("admin");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteRole, setConfirmDeleteRole] = useState<PlatformRole | null>(null);
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);

  // Draft state for the right panel
  const [draftName, setDraftName] = useState("");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftColor, setDraftColor] = useState(COLOR_OPTIONS[0]);
  const [draftPermissions, setDraftPermissions] = useState<RolePermissions>(emptyPermissions());
  const [dirty, setDirty] = useState(false);

  // All roles: built-in first, then custom
  const allRoles: PlatformRole[] = [...BUILT_IN_ROLES, ...customRoles];
  const selectedRole = allRoles.find((r) => r.id === selectedId) ?? allRoles[0];

  // ── Load custom roles on mount ──────────────────────────────────────────────

  useEffect(() => {
    void loadCustomRoles();
  }, []);

  async function loadCustomRoles() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await listRoles();
      const allRoles: PlatformRole[] = [
        ...(result.builtIn || []).map((r): PlatformRole => ({
          id: `builtin-${r.name}`, name: r.name,
          description: (r as Record<string, unknown>).description as string || "",
          color: "var(--text-soft, #6B7280)",
          permissions: r.permissions as RolePermissions,
          isBuiltIn: true,
        })),
        ...(result.custom || []).map((r): PlatformRole => ({
          id: r.id, name: r.name, description: r.description,
          color: r.color, permissions: r.permissions as RolePermissions,
          isBuiltIn: false,
        })),
      ];
      const roles = allRoles.filter((r) => !r.isBuiltIn);
      setCustomRoles(roles);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load roles.");
    } finally {
      setLoading(false);
    }
  }

  // ── Populate editor when selection changes ──────────────────────────────────

  useEffect(() => {
    if (!selectedRole) return;
    setDraftName(selectedRole.name);
    setDraftDescription(selectedRole.description);
    setDraftColor(selectedRole.color);
    setDraftPermissions({ ...emptyPermissions(), ...selectedRole.permissions });
    setDirty(false);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function showBanner(type: "success" | "error", message: string) {
    setBanner({ type, message });
    window.setTimeout(() => setBanner(null), 5000);
  }

  // ── New role ────────────────────────────────────────────────────────────────

  function handleNewRole() {
    const tempId = `new-${Date.now()}`;
    const newRole: PlatformRole = {
      id: tempId,
      name: "New role",
      description: "",
      color: COLOR_OPTIONS[customRoles.length % COLOR_OPTIONS.length],
      permissions: emptyPermissions(),
      isBuiltIn: false,
    };
    setCustomRoles((prev) => [...prev, newRole]);
    setSelectedId(tempId);
  }

  // ── Permission toggle ────────────────────────────────────────────────────────

  function handlePermissionChange(key: keyof RolePermissions, value: boolean) {
    setDraftPermissions((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function handleFieldChange(field: "name" | "description" | "color", value: string) {
    if (field === "name") setDraftName(value);
    if (field === "description") setDraftDescription(value);
    if (field === "color") setDraftColor(value);
    setDirty(true);
  }

  // ── Save ─────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedRole || selectedRole.isBuiltIn) return;
    if (!draftName.trim()) {
      showBanner("error", "Role name is required.");
      return;
    }
    setSaving(true);
    try {
      const isNew = selectedRole.id.startsWith("new-");
      const payload = {
        name: draftName.trim(),
        description: draftDescription.trim(),
        color: draftColor,
        permissions: draftPermissions,
      };
      if (isNew) {
        const result = await createRole(payload as { name: string; description: string; color: string; permissions: Record<string, boolean> });
        const created = { ...result.role, isBuiltIn: false as const } as PlatformRole;
        setCustomRoles((prev) => prev.map((r) => r.id === selectedRole.id ? created : r));
        setSelectedId(created.id);
        showBanner("success", `Role "${created.name}" created successfully.`);
      } else {
        const result = await updateRole(selectedRole.id, payload as { name: string; description: string; color: string; permissions: Record<string, boolean> });
        const updated = { ...result.role, isBuiltIn: false as const } as PlatformRole;
        setCustomRoles((prev) => prev.map((r) => r.id === selectedRole.id ? updated : r));
        showBanner("success", `Role "${updated.name}" updated.`);
      }
      setDirty(false);
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to save role.");
    } finally {
      setSaving(false);
    }
  }

  // ── Discard new unsaved role ─────────────────────────────────────────────────

  function handleDiscardNew() {
    if (!selectedRole || !selectedRole.id.startsWith("new-")) return;
    setCustomRoles((prev) => prev.filter((r) => r.id !== selectedRole.id));
    setSelectedId("admin");
    setDirty(false);
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function handleDeleteConfirm() {
    if (!confirmDeleteRole) return;
    setDeleting(true);
    try {
      await deleteRole(confirmDeleteRole.id);
      setCustomRoles((prev) => prev.filter((r) => r.id !== confirmDeleteRole.id));
      setConfirmDeleteRole(null);
      setSelectedId("admin");
      showBanner("success", `Role "${confirmDeleteRole.name}" deleted.`);
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to delete role.");
    } finally {
      setDeleting(false);
    }
  }

  // ── Input style helpers ───────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 11px",
    borderRadius: 8,
    border: "1px solid #D1D5DB",
    fontSize: 13,
    fontFamily: FONT,
    outline: "none",
    background: "var(--surface, #fff)",
    color: "var(--text, #111827)",
    boxSizing: "border-box",
  };

  function focusInput(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    e.currentTarget.style.borderColor = PRIMARY;
    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)";
  }

  function blurInput(e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) {
    e.currentTarget.style.borderColor = "#D1D5DB";
    e.currentTarget.style.boxShadow = "none";
  }

  const isNewRole = selectedRole?.id.startsWith("new-") ?? false;
  const canEdit = !selectedRole?.isBuiltIn;
  const grantedCount = countGranted(draftPermissions);
  const total = totalPermissions();

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="role-mgmt-page" style={{ fontFamily: FONT, minHeight: "100dvh", background: "var(--bg, #F8FAFC)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: "1.5rem", fontWeight: 800, color: "var(--text, #111827)", letterSpacing: "-0.025em" }}>
              Role Management
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft, #6B7280)" }}>
              Create and manage custom roles with granular permission controls.
            </p>
          </div>
          <button
            type="button"
            onClick={handleNewRole}
            style={{
              padding: "9px 18px",
              borderRadius: 8,
              border: "none",
              background: PRIMARY,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = PRIMARY_DARK; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = PRIMARY; }}
          >
            <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
            New role
          </button>
        </div>

        {/* Banner */}
        {banner && (
          <div style={{
            padding: "11px 16px",
            borderRadius: 10,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            fontWeight: 500,
            background: banner.type === "success" ? "#ECFDF5" : "#FEF2F2",
            border: `1px solid ${banner.type === "success" ? "#A7F3D0" : "#FECACA"}`,
            color: banner.type === "success" ? "#065F46" : "#991B1B",
          }}>
            <span>{banner.type === "success" ? "✓" : "⚠"}</span>
            {banner.message}
            <button
              type="button"
              onClick={() => setBanner(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Two-column layout */}
        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 20, alignItems: "start" }}>

          {/* ── Left: role list ─────────────────────────────────────────────── */}
          <div style={{
            background: "var(--surface, #fff)",
            borderRadius: 14,
            border: "1px solid #E5E7EB",
            boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}>
            {/* List header */}
            <div style={{
              padding: "13px 14px",
              borderBottom: "1px solid var(--border, #F3F4F6)",
              background: "var(--surface-alt, #F9FAFB)",
            }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted, #9CA3AF)", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                Roles
              </span>
            </div>

            {/* Built-in section */}
            <div style={{ padding: "6px 6px 2px" }}>
              <div style={{ padding: "5px 8px 3px", fontSize: 10, fontWeight: 700, color: "var(--text-muted, #9CA3AF)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                Built-in
              </div>
              {BUILT_IN_ROLES.map((role) => (
                <RoleListItem
                  key={role.id}
                  role={role}
                  selected={selectedId === role.id}
                  onClick={() => setSelectedId(role.id)}
                />
              ))}
            </div>

            {/* Custom section */}
            <div style={{ padding: "4px 6px 8px", borderTop: customRoles.length > 0 || loading ? "1px solid #F3F4F6" : "none", marginTop: customRoles.length > 0 || loading ? 4 : 0 }}>
              {(customRoles.length > 0 || loading) && (
                <div style={{ padding: "5px 8px 3px", fontSize: 10, fontWeight: 700, color: "var(--text-muted, #9CA3AF)", letterSpacing: "0.07em", textTransform: "uppercase" }}>
                  Custom
                </div>
              )}
              {loading && (
                <div style={{ padding: "8px 8px", fontSize: 12, color: "var(--text-muted, #9CA3AF)" }}>Loading…</div>
              )}
              {!loading && loadError && (
                <div style={{ padding: "8px 8px", fontSize: 12, color: "#DC2626" }}>
                  {loadError}{" "}
                  <button
                    type="button"
                    onClick={() => { void loadCustomRoles(); }}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "#B91C1C", fontWeight: 700, fontSize: 12, fontFamily: FONT, padding: 0 }}
                  >
                    Retry
                  </button>
                </div>
              )}
              {!loading && !loadError && customRoles.map((role) => (
                <RoleListItem
                  key={role.id}
                  role={{ ...role, name: role.id.startsWith("new-") ? draftName || "New role" : role.name }}
                  selected={selectedId === role.id}
                  onClick={() => setSelectedId(role.id)}
                />
              ))}
            </div>
          </div>

          {/* ── Right: role editor ──────────────────────────────────────────── */}
          {selectedRole && (
            <div style={{
              background: "var(--surface, #fff)",
              borderRadius: 14,
              border: "1px solid #E5E7EB",
              boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
              overflow: "hidden",
            }}>
              {/* Editor header */}
              <div style={{
                padding: "16px 20px",
                borderBottom: "1px solid var(--border, #F3F4F6)",
                background: "var(--surface-alt, #F9FAFB)",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                <span
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: "50%",
                    background: canEdit ? draftColor : selectedRole.color,
                    flexShrink: 0,
                    boxShadow: `0 0 0 3px ${(canEdit ? draftColor : selectedRole.color)}33`,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text, #111827)" }}>
                    {canEdit ? (draftName || "New role") : selectedRole.name}
                    {dirty && canEdit && (
                      <span style={{ marginLeft: 6, fontSize: 10, color: "#B45309", fontWeight: 600, background: "#FEF3C7", border: "1px solid #FDE68A", borderRadius: 4, padding: "1px 5px", verticalAlign: "middle" }}>
                        Unsaved
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted, #9CA3AF)", marginTop: 1 }}>
                    {selectedRole.id === "developer"
                      ? <span style={{ color: "#7C3AED", fontWeight: 600 }}>Full access to everything · Read-only</span>
                      : <>
                          {grantedCount}/{total} permissions granted
                          {selectedRole.isBuiltIn && <span style={{ marginLeft: 8 }}>· Read-only</span>}
                        </>
                    }
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                  {canEdit && isNewRole && (
                    <button
                      type="button"
                      onClick={handleDiscardNew}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 7,
                        border: "1px solid #E5E7EB",
                        background: "var(--surface-alt, #F9FAFB)",
                        color: "var(--text-soft, #6B7280)",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: FONT,
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-hover, #F3F4F6)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "var(--surface-alt, #F9FAFB)"; }}
                    >
                      Discard
                    </button>
                  )}
                  {canEdit && !isNewRole && (
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteRole(selectedRole)}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 7,
                        border: "1px solid #FECACA",
                        background: "#FEF2F2",
                        color: "#B91C1C",
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: FONT,
                        cursor: "pointer",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                    >
                      Delete role
                    </button>
                  )}
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => { void handleSave(); }}
                      disabled={saving || !dirty}
                      style={{
                        padding: "6px 16px",
                        borderRadius: 7,
                        border: "none",
                        background: saving || !dirty ? "#D1FAE5" : PRIMARY,
                        color: saving || !dirty ? PRIMARY_DARK : "#fff",
                        fontSize: 12,
                        fontWeight: 700,
                        fontFamily: FONT,
                        cursor: saving || !dirty ? "not-allowed" : "pointer",
                        opacity: !dirty ? 0.6 : 1,
                        transition: "background 80ms, opacity 80ms",
                      }}
                      onMouseEnter={(e) => { if (!saving && dirty) e.currentTarget.style.background = PRIMARY_DARK; }}
                      onMouseLeave={(e) => { if (!saving && dirty) e.currentTarget.style.background = PRIMARY; }}
                    >
                      {saving ? "Saving…" : isNewRole ? "Create role" : "Save changes"}
                    </button>
                  )}
                </div>
              </div>

              <div style={{ padding: 20 }}>

                {/* Role meta fields */}
                {canEdit ? (
                  <div style={{ marginBottom: 22 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>Role name *</span>
                        <input
                          type="text"
                          value={draftName}
                          onChange={(e) => handleFieldChange("name", e.target.value)}
                          placeholder="e.g. Regional Manager"
                          style={inputStyle}
                          onFocus={focusInput}
                          onBlur={blurInput}
                        />
                      </label>
                      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>Description</span>
                        <input
                          type="text"
                          value={draftDescription}
                          onChange={(e) => handleFieldChange("description", e.target.value)}
                          placeholder="Short description of this role's purpose"
                          style={inputStyle}
                          onFocus={focusInput}
                          onBlur={blurInput}
                        />
                      </label>
                    </div>

                    {/* Colour picker */}
                    <div>
                      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em", display: "block", marginBottom: 6 }}>
                        Colour
                      </span>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {COLOR_OPTIONS.map((color) => (
                          <button
                            key={color}
                            type="button"
                            onClick={() => handleFieldChange("color", color)}
                            aria-label={color}
                            title={color}
                            style={{
                              width: 24,
                              height: 24,
                              borderRadius: "50%",
                              background: color,
                              border: draftColor === color ? `3px solid #111827` : "2px solid transparent",
                              cursor: "pointer",
                              outline: draftColor === color ? `2px solid #fff` : "none",
                              outlineOffset: -4,
                              padding: 0,
                              flexShrink: 0,
                            }}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    marginBottom: 20,
                    padding: "12px 14px",
                    borderRadius: 10,
                    background: "var(--surface-alt, #F9FAFB)",
                    border: "1px solid #E5E7EB",
                  }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text, #111827)", marginBottom: 3 }}>
                      {selectedRole.name}
                    </div>
                    {selectedRole.description && (
                      <div style={{ fontSize: 12, color: "var(--text-soft, #6B7280)" }}>
                        {selectedRole.description}
                      </div>
                    )}
                    <div style={{
                      marginTop: 8,
                      fontSize: 11,
                      color: "var(--text-muted, #9CA3AF)",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}>
                      <span style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: selectedRole.color,
                        flexShrink: 0,
                      }} />
                      Built-in role — permissions are fixed and cannot be changed
                    </div>
                  </div>
                )}

                {/* Permission groups — developer gets a "full access" banner instead */}
                {selectedRole.id === "developer" ? (
                  <div style={{
                    padding: "20px 20px",
                    borderRadius: 12,
                    background: "rgba(124,58,237,0.06)",
                    border: "1px solid rgba(124,58,237,0.2)",
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 14,
                  }}>
                    <div style={{ fontSize: 28, flexShrink: 0 }}>⚡</div>
                    <div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: "#5B21B6", marginBottom: 4 }}>
                        Developer — Unrestricted Access
                      </div>
                      <div style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", lineHeight: 1.5 }}>
                        The Developer role automatically has full access to every feature and setting in the platform.
                        No configuration is needed — this role bypasses all permission checks and is reserved for <strong>don@rapidcodecrafters.com</strong>.
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {PERMISSION_GROUPS.map((group) => (
                      <PermissionGroupCard
                        key={group.id}
                        group={group}
                        permissions={draftPermissions}
                        readOnly={!canEdit}
                        onChange={handlePermissionChange}
                      />
                    ))}
                  </div>
                )}

                {/* Bottom save bar for convenience */}
                {canEdit && dirty && (
                  <div style={{
                    marginTop: 18,
                    padding: "12px 16px",
                    borderRadius: 10,
                    background: "#FFF7ED",
                    border: "1px solid #FDE68A",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}>
                    <span style={{ fontSize: 12, color: "#92400E" }}>
                      You have unsaved changes.
                    </span>
                    <div style={{ display: "flex", gap: 8 }}>
                      {isNewRole && (
                        <button
                          type="button"
                          onClick={handleDiscardNew}
                          style={{
                            padding: "6px 14px",
                            borderRadius: 7,
                            border: "1px solid #E5E7EB",
                            background: "var(--surface, #fff)",
                            color: "var(--text-soft, #6B7280)",
                            fontSize: 12,
                            fontWeight: 600,
                            fontFamily: FONT,
                            cursor: "pointer",
                          }}
                        >
                          Discard
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { void handleSave(); }}
                        disabled={saving}
                        style={{
                          padding: "6px 16px",
                          borderRadius: 7,
                          border: "none",
                          background: PRIMARY,
                          color: "#fff",
                          fontSize: 12,
                          fontWeight: 700,
                          fontFamily: FONT,
                          cursor: saving ? "not-allowed" : "pointer",
                          opacity: saving ? 0.7 : 1,
                        }}
                        onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = PRIMARY_DARK; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = PRIMARY; }}
                      >
                        {saving ? "Saving…" : isNewRole ? "Create role" : "Save changes"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--text-muted, #9CA3AF)", textAlign: "center" }}>
          Built-in roles cannot be modified. Custom roles can be assigned to users from the User Management page.
        </p>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteRole && (
        <DeleteConfirmDialog
          role={confirmDeleteRole}
          onConfirm={() => { void handleDeleteConfirm(); }}
          onCancel={() => setConfirmDeleteRole(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
