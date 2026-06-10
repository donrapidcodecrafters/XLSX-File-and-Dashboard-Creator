import { useEffect, useState } from "react";
import {
  listUsers,
  inviteUser,
  deleteInvitation,
  sendPasswordReset,
  deleteUser,
  updateUserRole,
  deactivateUser,
  impersonateUser,
  stopImpersonating,
  type PlatformUser,
} from "../lib/studioApi";

// ── Design tokens ──────────────────────────────────────────────────────────────

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const PRIMARY = "#0d7c66";
const PRIMARY_DARK = "#065F46";
const PRIMARY_BG = "#ECFDF5";
const PRIMARY_BORDER = "#A7F3D0";

const ROLE_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  admin:     { bg: "#ECFDF5", color: "#065F46", border: "#A7F3D0", label: "Admin" },
  editor:    { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE", label: "Editor" },
  viewer:    { bg: "#F9FAFB", color: "var(--text-soft, #6B7280)", border: "#E5E7EB", label: "Viewer" },
  developer: { bg: "#F5F3FF", color: "#6D28D9", border: "#DDD6FE", label: "Developer" },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function initials(name: string, email: string): string {
  const src = name?.trim() || email || "?";
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function avatarColor(email: string): string {
  const colors = ["#0d7c66", "#1D4ED8", "#7C3AED", "#B45309", "#DC2626", "#0891B2"];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "Never";
  try { return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }); }
  catch { return "Unknown"; }
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Avatar({ user }: { user: PlatformUser }) {
  const bg = avatarColor(user.email);
  return (
    <div style={{
      width: 34,
      height: 34,
      borderRadius: "50%",
      background: bg,
      color: "#fff",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 12,
      fontWeight: 700,
      flexShrink: 0,
      letterSpacing: "0.03em",
    }}>
      {initials(user.displayName, user.email)}
    </div>
  );
}

function RoleBadge({ role }: { role: PlatformUser["role"] }) {
  const meta = ROLE_BADGE[role] || ROLE_BADGE.viewer;
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 9px",
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.04em",
      whiteSpace: "nowrap",
      background: meta.bg,
      color: meta.color,
      border: `1px solid ${meta.border}`,
      textTransform: "capitalize",
      flexShrink: 0,
    }}>
      {meta.label}
    </span>
  );
}

function StatusBadge({ active }: { active: boolean }) {
  return (
    <span style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 5,
      padding: "2px 9px",
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 600,
      whiteSpace: "nowrap",
      background: active ? "#ECFDF5" : "#F9FAFB",
      color: active ? "#065F46" : "#9CA3AF",
      border: `1px solid ${active ? "#A7F3D0" : "#E5E7EB"}`,
    }}>
      <span style={{
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: active ? "#10B981" : "#D1D5DB",
        flexShrink: 0,
      }} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

// ── Invite form ────────────────────────────────────────────────────────────────

interface InviteFormProps {
  onCancel: () => void;
  onSuccess: (msg: string) => void;
  onError: (msg: string) => void;
}

function InviteForm({ onCancel, onSuccess, onError }: InviteFormProps) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<PlatformUser["role"]>("viewer");
  const [submitting, setSubmitting] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 11px",
    borderRadius: 8,
    border: "1px solid #D1D5DB",
    fontSize: "13px",
    fontFamily: FONT,
    outline: "none",
    background: "var(--surface, #fff)",
    color: "var(--text, #111827)",
    boxSizing: "border-box",
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      onError("Please enter a valid email address.");
      return;
    }
    setSubmitting(true);
    try {
      await inviteUser({ email: trimmedEmail, displayName: displayName.trim() || trimmedEmail, role });
      onSuccess(`Invitation sent to ${trimmedEmail}.`);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to send invitation.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{
      background: "var(--brand-light, #ECFDF5)",
      border: "1px solid var(--brand-border, #A7F3D0)",
      borderRadius: 12,
      padding: "20px 24px",
      marginBottom: 20,
    }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
        <strong style={{ fontSize: 14, color: "var(--text, #111827)", fontFamily: FONT }}>Invite a new user</strong>
        <button
          type="button"
          onClick={onCancel}
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-soft, #6B7280)", fontSize: 18, lineHeight: 1, padding: "2px 4px" }}
          aria-label="Close invite form"
        >
          ×
        </button>
      </div>
      <form onSubmit={(e) => { void handleSubmit(e); }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto auto", gap: 10, alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>Email address *</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              required
              disabled={submitting}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = PRIMARY; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#D1D5DB"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>Display name</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Full name (optional)"
              disabled={submitting}
              style={inputStyle}
              onFocus={(e) => { e.currentTarget.style.borderColor = PRIMARY; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#D1D5DB"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-secondary, #374151)", letterSpacing: "0.01em" }}>Role</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as PlatformUser["role"])}
              disabled={submitting}
              style={{ ...inputStyle, paddingRight: 28, cursor: "pointer" }}
            >
              <option value="viewer">Viewer</option>
              <option value="editor">Editor</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <button
            type="submit"
            disabled={submitting || !email.trim()}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              background: PRIMARY,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: submitting || !email.trim() ? "not-allowed" : "pointer",
              opacity: submitting || !email.trim() ? 0.65 : 1,
              whiteSpace: "nowrap",
              height: 36,
              alignSelf: "flex-end",
            }}
            onMouseEnter={(e) => { if (!submitting) e.currentTarget.style.background = PRIMARY_DARK; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = PRIMARY; }}
          >
            {submitting ? "Sending…" : "Send invitation"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── User row ───────────────────────────────────────────────────────────────────

interface UserRowProps {
  user: PlatformUser;
  currentUserId: string;
  onRoleChange: (id: string, role: PlatformUser["role"]) => Promise<void>;
  onToggleActive: (user: PlatformUser) => Promise<void>;
  onToggleNotifications: (user: PlatformUser) => Promise<void>;
  onImpersonate: (user: PlatformUser) => Promise<void>;
  onPasswordReset: (userId: string, email: string) => Promise<void>;
  onDelete: (userId: string, email: string) => Promise<void>;
  isWorking: boolean;
}

function UserRow({ user, currentUserId, onRoleChange, onToggleActive, onToggleNotifications, onImpersonate, onPasswordReset, onDelete, isWorking }: UserRowProps) {
  const isSelf = user.id === currentUserId;
  const [roleChanging, setRoleChanging] = useState(false);

  async function handleRoleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const nextRole = e.target.value as PlatformUser["role"];
    setRoleChanging(true);
    try { await onRoleChange(user.id, nextRole); }
    finally { setRoleChanging(false); }
  }

  const cellStyle: React.CSSProperties = {
    padding: "12px 14px",
    borderBottom: "1px solid var(--border, #F3F4F6)",
    verticalAlign: "middle",
    fontSize: 13,
    color: "var(--text-secondary, #374151)",
  };

  return (
    <tr style={{ transition: "background 80ms" }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface-hover, #F9FAFB)"; }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLTableRowElement).style.background = ""; }}
    >
      {/* Avatar + identity */}
      <td style={{ ...cellStyle, paddingLeft: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar user={user} />
          <div>
            <div style={{ fontWeight: 600, color: "var(--text, #111827)", lineHeight: 1.3 }}>
              {user.displayName || user.email}
              {isSelf && (
                <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: PRIMARY, background: PRIMARY_BG, border: `1px solid ${PRIMARY_BORDER}`, borderRadius: 99, padding: "1px 6px", verticalAlign: "middle" }}>
                  You
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted, #9CA3AF)", marginTop: 1 }}>{user.email}</div>
          </div>
        </div>
      </td>

      {/* Role */}
      <td style={cellStyle}>
        <RoleBadge role={user.role} />
      </td>

      {/* Status */}
      <td style={{ ...cellStyle, whiteSpace: "nowrap" }}>
        <StatusBadge active={user.active} />
      </td>

      {/* Last login */}
      <td style={{ ...cellStyle, color: "var(--text-muted, #9CA3AF)", fontSize: 12 }}>
        {formatDate(user.lastLoginAt)}
      </td>

      {/* System notifications toggle */}
      <td style={{ ...cellStyle, textAlign: "center" }}>
        <button
          type="button"
          role="switch"
          aria-checked={user.systemNotificationsEnabled === true}
          onClick={() => { void onToggleNotifications(user); }}
          disabled={isWorking}
          title={user.systemNotificationsEnabled ? "System notifications ON — click to disable" : "System notifications OFF — click to enable"}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 6,
            border: `1px solid ${user.systemNotificationsEnabled ? "#A7F3D0" : "#E5E7EB"}`,
            background: user.systemNotificationsEnabled ? "#ECFDF5" : "#F9FAFB",
            color: user.systemNotificationsEnabled ? "#065F46" : "#9CA3AF",
            fontSize: 12,
            fontWeight: 600,
            fontFamily: FONT,
            cursor: isWorking ? "not-allowed" : "pointer",
            whiteSpace: "nowrap",
            transition: "all 120ms",
          }}
        >
          <span style={{
            display: "inline-block",
            width: 28,
            height: 16,
            borderRadius: 99,
            background: user.systemNotificationsEnabled ? "#10B981" : "#D1D5DB",
            position: "relative",
            transition: "background 150ms",
            flexShrink: 0,
          }}>
            <span style={{
              position: "absolute",
              top: 2,
              left: user.systemNotificationsEnabled ? 14 : 2,
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: "#fff",
              transition: "left 150ms",
            }} />
          </span>
          {user.systemNotificationsEnabled ? "On" : "Off"}
        </button>
      </td>

      {/* Actions */}
      <td style={{ ...cellStyle, paddingRight: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {/* Change role */}
          <select
            value={user.role}
            onChange={(e) => { void handleRoleChange(e); }}
            disabled={roleChanging || isWorking || isSelf}
            title={isSelf ? "You cannot change your own role" : "Change role"}
            style={{
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #D1D5DB",
              fontSize: 12,
              fontFamily: FONT,
              cursor: roleChanging || isWorking || isSelf ? "not-allowed" : "pointer",
              opacity: isSelf ? 0.45 : 1,
              background: "var(--surface, #fff)",
              color: "var(--text-secondary, #374151)",
            }}
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="admin">Admin</option>
          </select>

          {/* Deactivate / reactivate */}
          <button
            type="button"
            onClick={() => { void onToggleActive(user); }}
            disabled={isWorking || isSelf}
            title={isSelf ? "You cannot deactivate yourself" : user.active ? "Deactivate user" : "Reactivate user"}
            style={{
              padding: "4px 10px",
              borderRadius: 6,
              border: `1px solid ${user.active ? "#FECACA" : "#A7F3D0"}`,
              background: user.active ? "#FEF2F2" : "#ECFDF5",
              color: user.active ? "#B91C1C" : "#065F46",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: isWorking || isSelf ? "not-allowed" : "pointer",
              opacity: isSelf ? 0.45 : 1,
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { if (!isWorking && !isSelf) e.currentTarget.style.opacity = "0.8"; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = isSelf ? "0.45" : "1"; }}
          >
            {user.active ? "Deactivate" : "Reactivate"}
          </button>

          {/* Impersonate */}
          {!isSelf && (
            <button
              type="button"
              onClick={() => { void onImpersonate(user); }}
              disabled={isWorking}
              title={`View the app as ${user.displayName || user.email}`}
              style={{
                padding: "4px 10px",
                borderRadius: 6,
                border: "1px solid #E0E7FF",
                background: "#EEF2FF",
                color: "#3730A3",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: isWorking ? "not-allowed" : "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { if (!isWorking) e.currentTarget.style.opacity = "0.8"; }}
              onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
            >
              View as
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              onClick={() => { void onPasswordReset(user.id, user.email); }}
              disabled={isWorking}
              title="Send password reset email"
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #FDE68A", background: "#FFFBEB", color: "#92400E", fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: isWorking ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              Reset pwd
            </button>
          )}
          {!isSelf && (
            <button
              type="button"
              onClick={() => { void onDelete(user.id, user.email); }}
              disabled={isWorking}
              title="Permanently delete this user"
              style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #FECACA", background: "#FEF2F2", color: "#DC2626", fontSize: 12, fontWeight: 600, fontFamily: FONT, cursor: isWorking ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}
            >
              Delete
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface UserManagementPageProps {
  currentUser?: PlatformUser;
}

export function UserManagementPage({ currentUser }: UserManagementPageProps) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [pendingInvitations, setPendingInvitations] = useState<Array<{ id: string; email: string; role: string; displayName: string; expiresAt: string; status: string }>>([]);
  const [resendingEmail, setResendingEmail] = useState<string | null>(null);
  const [deletingInviteId, setDeletingInviteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [workingIds, setWorkingIds] = useState<Set<string>>(new Set());

  // Detect active impersonation from currentUser's context — we check if current
  // user id differs from what "stopImpersonating" would restore by examining a
  // flag we can infer: if the platform passes currentUser with an impersonation
  // flag, use it. Absence means we rely on a custom field or just offer the banner
  // when the page itself was loaded from an impersonation redirect.
  const isImpersonating = Boolean((currentUser as PlatformUser & { _impersonating?: boolean })._impersonating);
  const impersonatingName = isImpersonating ? (currentUser?.displayName || currentUser?.email || "") : "";

  useEffect(() => {
    void loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await listUsers();
      setUsers(result.users);
      setPendingInvitations((result as { users: PlatformUser[]; pendingInvitations?: typeof pendingInvitations }).pendingInvitations || []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load users.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSendPasswordReset(userId: string, email: string) {
    if (!window.confirm(`Send a password reset link to ${email}?`)) return;
    try {
      const result = await sendPasswordReset(userId);
      setBanner({ type: "success", message: result.message || `Reset link sent to ${email}.` });
    } catch (err) {
      setBanner({ type: "error", message: err instanceof Error ? err.message : "Failed to send reset link." });
    }
  }

  async function handleDeleteUser(userId: string, email: string) {
    if (!window.confirm(`Permanently delete user ${email}? This cannot be undone.`)) return;
    try {
      await deleteUser(userId);
      setBanner({ type: "success", message: `User ${email} deleted.` });
      void loadUsers();
    } catch (err) {
      setBanner({ type: "error", message: err instanceof Error ? err.message : "Failed to delete user." });
    }
  }

  async function handleDeleteInvite(id: string, email: string) {
    if (!window.confirm(`Cancel the invitation for ${email}?`)) return;
    setDeletingInviteId(id);
    try {
      await deleteInvitation(id);
      setBanner({ type: "success", message: `Invitation for ${email} cancelled.` });
      void loadUsers();
    } catch (err) {
      setBanner({ type: "error", message: err instanceof Error ? err.message : "Failed to cancel invitation." });
    } finally {
      setDeletingInviteId(null);
    }
  }

  async function handleResendInvite(email: string, role: string, displayName: string) {
    setResendingEmail(email);
    try {
      await inviteUser({ email, role, displayName: displayName || email });
      setBanner({ type: "success", message: `Invitation resent to ${email}.` });
      void loadUsers();
    } catch (err) {
      setBanner({ type: "error", message: err instanceof Error ? err.message : "Failed to resend invitation." });
    } finally {
      setResendingEmail(null);
    }
  }

  function setWorking(id: string, working: boolean) {
    setWorkingIds((prev) => {
      const next = new Set(prev);
      if (working) next.add(id); else next.delete(id);
      return next;
    });
  }

  function showBanner(type: "success" | "error", message: string) {
    setBanner({ type, message });
    window.setTimeout(() => setBanner(null), 5000);
  }

  async function handleRoleChange(id: string, role: PlatformUser["role"]) {
    setWorking(id, true);
    try {
      const result = await updateUserRole(id, role);
      setUsers((prev) => prev.map((u) => u.id === id ? result.user : u));
      showBanner("success", `Role updated to ${role}.`);
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to update role.");
    } finally {
      setWorking(id, false);
    }
  }

  async function handleToggleNotifications(user: PlatformUser) {
    setWorking(user.id, true);
    try {
      const { updateUser } = await import("../lib/studioApi");
      const result = await updateUser(user.id, { systemNotificationsEnabled: !user.systemNotificationsEnabled });
      setUsers((prev) => prev.map((u) => u.id === user.id ? result.user : u));
      showBanner("success", `System notifications ${result.user.systemNotificationsEnabled ? "enabled" : "disabled"} for ${user.displayName || user.email}.`);
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to update notification settings.");
    } finally {
      setWorking(user.id, false);
    }
  }

  async function handleToggleActive(user: PlatformUser) {
    setWorking(user.id, true);
    try {
      if (user.active) {
        await deactivateUser(user.id);
        setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, active: false } : u));
        showBanner("success", `${user.displayName || user.email} has been deactivated.`);
      } else {
        // Reactivate uses updateUser
        const { updateUser } = await import("../lib/studioApi");
        const result = await updateUser(user.id, { active: true });
        setUsers((prev) => prev.map((u) => u.id === user.id ? result.user : u));
        showBanner("success", `${user.displayName || user.email} has been reactivated.`);
      }
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to update user status.");
    } finally {
      setWorking(user.id, false);
    }
  }

  async function handleImpersonate(user: PlatformUser) {
    setWorking(user.id, true);
    try {
      await impersonateUser(user.id);
      window.location.reload();
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Failed to start impersonation.");
      setWorking(user.id, false);
    }
  }

  async function handleStopImpersonating() {
    try {
      await stopImpersonating();
      window.location.reload();
    } catch {
      // Reload anyway — session might have already reverted
      window.location.reload();
    }
  }

  function handleInviteSuccess(msg: string) {
    setShowInviteForm(false);
    showBanner("success", msg);
    void loadUsers();
  }

  function handleInviteError(msg: string) {
    showBanner("error", msg);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="user-mgmt-page" style={{ fontFamily: FONT, minHeight: "100dvh", background: "var(--bg, #F8FAFC)" }}>

      {/* Impersonation banner */}
      {isImpersonating && (
        <div style={{
          position: "sticky",
          top: 0,
          zIndex: 1000,
          background: "#F59E0B",
          color: "var(--text, #111827)",
          padding: "10px 20px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 16,
          fontSize: 14,
          fontWeight: 600,
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}>
          <span>
            Viewing as <strong>{impersonatingName}</strong> — you are in impersonation mode
          </span>
          <button
            type="button"
            onClick={() => { void handleStopImpersonating(); }}
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              border: "2px solid #111827",
              background: "#111827",
              color: "#F59E0B",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: "pointer",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "#374151"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#111827"; }}
          >
            Exit impersonation
          </button>
        </div>
      )}

      {/* Page content */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: "1.5rem", fontWeight: 800, color: "var(--text, #111827)", letterSpacing: "-0.025em" }}>
              User Management
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft, #6B7280)" }}>
              Manage who has access, control roles, and send invitations.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowInviteForm((v) => !v)}
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
            Invite user
          </button>
        </div>

        {/* Notification banner */}
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

        {/* Invite form */}
        {showInviteForm && (
          <InviteForm
            onCancel={() => setShowInviteForm(false)}
            onSuccess={handleInviteSuccess}
            onError={handleInviteError}
          />
        )}

        {/* Users card */}
        <div style={{
          background: "var(--surface, #fff)",
          borderRadius: 16,
          border: "1px solid #E5E7EB",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.03)",
          overflow: "hidden",
        }}>
          {/* Card header */}
          <div style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--border, #F3F4F6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}>
            <div>
              <strong style={{ fontSize: 14, color: "var(--text, #111827)" }}>All users</strong>
              {!loading && (
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-muted, #9CA3AF)" }}>
                  {users.length} {users.length === 1 ? "member" : "members"}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => { void loadUsers(); }}
              disabled={loading}
              style={{
                padding: "5px 12px",
                borderRadius: 6,
                border: "1px solid #E5E7EB",
                background: "var(--surface-alt, #F9FAFB)",
                color: "var(--text-secondary, #374151)",
                fontSize: 12,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          {/* Loading state */}
          {loading && (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-muted, #9CA3AF)", fontSize: 14 }}>
              Loading users…
            </div>
          )}

          {/* Error state */}
          {!loading && loadError && (
            <div style={{ padding: "32px 20px", textAlign: "center" }}>
              <div style={{
                display: "inline-block",
                padding: "12px 20px",
                borderRadius: 10,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                color: "#991B1B",
                fontSize: 13,
              }}>
                {loadError}
                <button
                  type="button"
                  onClick={() => { void loadUsers(); }}
                  style={{ marginLeft: 10, background: "none", border: "none", cursor: "pointer", color: "#B91C1C", fontWeight: 700, fontFamily: FONT, fontSize: 13 }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !loadError && users.length === 0 && (
            <div style={{ padding: "48px 20px", textAlign: "center", color: "var(--text-muted, #9CA3AF)", fontSize: 14 }}>
              No users found. Invite someone to get started.
            </div>
          )}

          {/* Table */}
          {!loading && !loadError && users.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ background: "var(--surface-alt, #F9FAFB)" }}>
                    {(["User", "Role", "Status", "Last login", "System Notifications", "Actions"] as const).map((heading, i) => (
                      <th
                        key={heading}
                        style={{
                          padding: "9px 14px",
                          textAlign: "left",
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: "0.06em",
                          color: "var(--text-muted, #9CA3AF)",
                          textTransform: "uppercase",
                          borderBottom: "1px solid var(--border, #E5E7EB)",
                          paddingLeft: i === 0 ? 20 : 14,
                          paddingRight: i === 5 ? 20 : 14,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <UserRow
                      key={user.id}
                      user={user}
                      currentUserId={currentUser?.id ?? ""}
                      onRoleChange={handleRoleChange}
                      onToggleActive={handleToggleActive}
                      onToggleNotifications={handleToggleNotifications}
                      onImpersonate={handleImpersonate}
                      onPasswordReset={handleSendPasswordReset}
                      onDelete={handleDeleteUser}
                      isWorking={workingIds.has(user.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pending invitations */}
        {pendingInvitations.length > 0 && (
          <div style={{
            background: "var(--surface, #fff)", borderRadius: 14,
            border: "1px solid #E5E7EB", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
            overflow: "hidden", marginTop: 20,
          }}>
            <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--border, #F3F4F6)", background: "#FFFBEB", display: "flex", alignItems: "center", gap: 8 }}>
              <strong style={{ fontSize: 14, color: "#92400E" }}>⏳ Pending invitations</strong>
              <span style={{ fontSize: 12, color: "#B45309" }}>{pendingInvitations.length} awaiting acceptance</span>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#FFFBEB" }}>
                  {["Email", "Role", "Expires", ""].map((h, i) => (
                    <th key={h + i} style={{ padding: "8px 14px", textAlign: "left", fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#B45309", textTransform: "uppercase" as const, paddingLeft: i === 0 ? 20 : 14 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingInvitations.map((inv) => (
                  <tr key={inv.id} style={{ borderTop: "1px solid #FEF3C7" }}>
                    <td style={{ padding: "10px 20px", fontSize: 13, color: "var(--text-secondary, #374151)" }}>{inv.email}</td>
                    <td style={{ padding: "10px 14px" }}>
                      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 4, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", textTransform: "capitalize" as const }}>
                        {inv.role}
                      </span>
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 12, color: "var(--text-soft, #6B7280)" }}>
                      {new Date(inv.expiresAt).toLocaleDateString()}
                    </td>
                    <td style={{ padding: "10px 20px 10px 14px", textAlign: "right", display: "flex", gap: 6, justifyContent: "flex-end" }}>
                      <button
                        type="button"
                        disabled={resendingEmail === inv.email}
                        onClick={() => { void handleResendInvite(inv.email, inv.role, inv.displayName); }}
                        style={{
                          padding: "5px 12px", borderRadius: 6, border: "1px solid #FDE68A",
                          background: resendingEmail === inv.email ? "#FEF3C7" : "#FFFBEB",
                          color: "#92400E", fontSize: 12, fontWeight: 600,
                          cursor: resendingEmail === inv.email ? "not-allowed" : "pointer",
                          fontFamily: FONT, opacity: resendingEmail === inv.email ? 0.6 : 1,
                        }}
                      >
                        {resendingEmail === inv.email ? "Sending…" : "↺ Resend"}
                      </button>
                      <button
                        type="button"
                        disabled={deletingInviteId === inv.id}
                        onClick={() => { void handleDeleteInvite(inv.id, inv.email); }}
                        style={{
                          padding: "5px 12px", borderRadius: 6, border: "1px solid #FECACA",
                          background: "#FEF2F2", color: "#DC2626", fontSize: 12, fontWeight: 600,
                          cursor: deletingInviteId === inv.id ? "not-allowed" : "pointer",
                          fontFamily: FONT, opacity: deletingInviteId === inv.id ? 0.6 : 1,
                        }}
                      >
                        {deletingInviteId === inv.id ? "…" : "✕ Cancel"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer hint */}
        <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--text-muted, #9CA3AF)", textAlign: "center" }}>
          Invited users will receive an email with a link to set up their account.
          Role changes take effect immediately.
        </p>
      </div>
    </div>
  );
}
