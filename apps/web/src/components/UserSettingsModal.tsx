import { useState, useEffect } from "react";
import { updateMyPreferences, changeMyPassword, type PlatformUser } from "../lib/studioApi";

interface Props {
  user: PlatformUser;
  onClose: () => void;
  onThemeChange: (theme: string) => void;
  onUserChange?: (updates: Partial<PlatformUser>) => void;
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const T = {
  surface:     "var(--surface, #fff)",
  border:      "var(--border, #E5E7EB)",
  brand:       "var(--brand, #0d7c66)",
  brandDeep:   "var(--brand-deep, #065F46)",
  brandLight:  "var(--brand-light, #ECFDF5)",
  brandBorder: "var(--brand-border, #A7F3D0)",
  text:        "var(--text, #111827)",
  textSoft:    "var(--text-soft, #6B7280)",
  textSec:     "var(--text-secondary, #374151)",
  bg:          "var(--bg, #F1F5F9)",
  font:        "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const ROLE_BADGE: Record<string, { bg: string; color: string; border: string }> = {
  admin:  { bg: "#ECFDF5", color: "#065F46", border: "#A7F3D0" },
  editor: { bg: "#EFF6FF", color: "#1D4ED8", border: "#BFDBFE" },
  viewer: { bg: "#F9FAFB", color: "#374151", border: "#E5E7EB" },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined): string {
  if (!value) return "Unknown";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "long", day: "numeric", year: "numeric",
    });
  } catch {
    return "Unknown";
  }
}

function avatarColor(email: string): string {
  const palette = ["#0d7c66", "#1D4ED8", "#7C3AED", "#B45309", "#DC2626", "#0891B2"];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

// ── Component ─────────────────────────────────────────────────────────────────

export function UserSettingsModal({ user, onClose, onThemeChange, onUserChange }: Props) {
  // Profile
  const [displayName, setDisplayName]     = useState(user.displayName || "");
  const [displayNameSaved, setDisplayNameSaved] = useState(false);
  const [displayNameSaving, setDisplayNameSaving] = useState(false);

  // Appearance
  const [theme, setTheme]       = useState(user.theme || "system");
  const [themeSaving, setThemeSaving] = useState(false);

  // Password
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [currentPw, setCurrentPw]   = useState("");
  const [newPw, setNewPw]           = useState("");
  const [confirmPw, setConfirmPw]   = useState("");
  const [pwError, setPwError]       = useState("");
  const [pwSuccess, setPwSuccess]   = useState(false);
  const [pwSaving, setPwSaving]     = useState(false);

  // Sync external user prop -> local state when user object changes
  useEffect(() => {
    setDisplayName(user.displayName || "");
    setTheme(user.theme || "system");
  }, [user.id]);

  // Close on Escape
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleSaveDisplayName() {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === user.displayName) return;
    setDisplayNameSaving(true);
    try {
      await updateMyPreferences({ displayName: trimmed });
      onUserChange?.({ displayName: trimmed });
      setDisplayNameSaved(true);
      setTimeout(() => setDisplayNameSaved(false), 2500);
    } catch {
      // silently ignore — user can retry
    } finally {
      setDisplayNameSaving(false);
    }
  }

  async function handleThemeChange(next: string) {
    setTheme(next);
    setThemeSaving(true);
    try {
      await updateMyPreferences({ theme: next });
      onThemeChange(next);
    } catch {
      // still propagate locally even if the server call failed
      onThemeChange(next);
    } finally {
      setThemeSaving(false);
    }
  }

  async function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPwError("");
    if (newPw.length < 8) {
      setPwError("New password must be at least 8 characters.");
      return;
    }
    if (newPw !== confirmPw) {
      setPwError("Passwords do not match.");
      return;
    }
    setPwSaving(true);
    try {
      await changeMyPassword(currentPw, newPw);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      setShowPasswordForm(false);
      setPwSuccess(true);
      setTimeout(() => setPwSuccess(false), 3000);
    } catch (err) {
      setPwError(err instanceof Error ? err.message : "Failed to change password.");
    } finally {
      setPwSaving(false);
    }
  }

  // ── Styles ───────────────────────────────────────────────────────────────────

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 11px",
    borderRadius: 7,
    border: `1px solid ${T.border}`,
    fontSize: 13,
    fontFamily: T.font,
    color: T.text,
    background: T.surface,
    outline: "none",
    boxSizing: "border-box",
    transition: "border-color 120ms, box-shadow 120ms",
  };

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: T.textSec,
    marginBottom: 5,
    letterSpacing: "0.01em",
    textTransform: "uppercase",
  };

  const sectionHeadingStyle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: T.textSec,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    marginBottom: 12,
  };

  const sectionStyle: React.CSSProperties = {
    paddingBottom: 20,
    marginBottom: 20,
    borderBottom: `1px solid ${T.border}`,
  };

  const roleStyle = ROLE_BADGE[user.role] || ROLE_BADGE.viewer;
  const avatarBg  = avatarColor(user.email);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <div
        style={{
          position: "fixed", inset: 0,
          background: "rgba(0,0,0,0.22)",
          zIndex: 200,
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Account Settings"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 300,
          zIndex: 201,
          background: T.surface,
          borderLeft: `1px solid ${T.border}`,
          boxShadow: "-8px 0 32px rgba(0,0,0,0.12)",
          display: "flex", flexDirection: "column",
          fontFamily: T.font,
          animation: "slide-in-right 180ms ease",
        }}
      >
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 18px",
          borderBottom: `1px solid ${T.border}`,
          flexShrink: 0,
        }}>
          <strong style={{ fontSize: 14, fontWeight: 700, color: T.text }}>
            Account Settings
          </strong>
          <button
            onClick={onClose}
            aria-label="Close settings"
            style={{
              width: 28, height: 28, borderRadius: 7,
              border: `1px solid ${T.border}`,
              background: "transparent",
              cursor: "pointer", fontSize: "0.9rem",
              color: T.textSoft,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontFamily: T.font,
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "20px 18px" }}>

          {/* ── Section 1: Profile ─────────────────────────────────────────── */}
          <div style={sectionStyle}>
            <div style={sectionHeadingStyle}>Profile</div>

            {/* Avatar + email row */}
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 16 }}>
              <div style={{
                width: 42, height: 42, borderRadius: "50%",
                background: avatarBg,
                color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 17, fontWeight: 700, flexShrink: 0,
                letterSpacing: "0.02em",
              }}>
                {(displayName || user.email).charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {displayName || user.email}
                </div>
                <div style={{ fontSize: 12, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {user.email}
                </div>
              </div>
            </div>

            {/* Display name */}
            <div style={{ marginBottom: 14 }}>
              <label style={labelStyle}>Display name</label>
              <div style={{ display: "flex", gap: 7 }}>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { void handleSaveDisplayName(); } }}
                  placeholder="Your name"
                  style={{ ...inputStyle, flex: 1 }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = T.brand;
                    e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.1)";
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = T.border;
                    e.currentTarget.style.boxShadow = "none";
                  }}
                />
                <button
                  type="button"
                  onClick={() => { void handleSaveDisplayName(); }}
                  disabled={displayNameSaving || !displayName.trim() || displayName.trim() === user.displayName}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 7,
                    border: "none",
                    background: T.brand,
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: displayNameSaving ? "wait" : "pointer",
                    fontFamily: T.font,
                    flexShrink: 0,
                    opacity: (displayNameSaving || !displayName.trim() || displayName.trim() === user.displayName) ? 0.5 : 1,
                    transition: "opacity 120ms",
                  }}
                >
                  {displayNameSaving ? "…" : "Save"}
                </button>
              </div>
              {displayNameSaved && (
                <div style={{ fontSize: 11, color: T.brand, marginTop: 4, fontWeight: 600 }}>
                  Name updated
                </div>
              )}
            </div>

            {/* Email (read-only) */}
            <div>
              <label style={labelStyle}>Email address</label>
              <input
                type="email"
                value={user.email}
                readOnly
                style={{ ...inputStyle, background: T.bg, color: T.textSoft, cursor: "default" }}
              />
            </div>
          </div>

          {/* ── Section 2: Appearance ──────────────────────────────────────── */}
          <div style={sectionStyle}>
            <div style={sectionHeadingStyle}>Appearance</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {[
                { value: "light",  icon: "☀️",  label: "Light"  },
                { value: "dark",   icon: "🌙",  label: "Dark"   },
                { value: "system", icon: "💻",  label: "System" },
              ].map((opt) => {
                const active = theme === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={themeSaving}
                    onClick={() => { void handleThemeChange(opt.value); }}
                    style={{
                      padding: "9px 4px",
                      borderRadius: 8,
                      border: active ? `2px solid ${T.brand}` : `1px solid ${T.border}`,
                      background: active ? T.brandLight : T.surface,
                      cursor: themeSaving ? "wait" : "pointer",
                      fontFamily: T.font,
                      textAlign: "center",
                      transition: "background 120ms, border-color 120ms",
                      outline: "none",
                    }}
                  >
                    <div style={{ fontSize: 15, marginBottom: 3 }}>{opt.icon}</div>
                    <div style={{
                      fontSize: 11, fontWeight: 600,
                      color: active ? T.brandDeep : T.textSoft,
                    }}>
                      {opt.label}
                    </div>
                  </button>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: T.textSoft, marginTop: 8 }}>
              {theme === "system" ? "Follows your operating system setting." : theme === "dark" ? "Always uses the dark theme." : "Always uses the light theme."}
            </div>
          </div>

          {/* ── Section 3: Security (change password) ─────────────────────── */}
          <div style={sectionStyle}>
            <div style={sectionHeadingStyle}>Security</div>
            {pwSuccess && (
              <div style={{
                padding: "8px 12px", borderRadius: 7, marginBottom: 12,
                background: T.brandLight, border: `1px solid ${T.brandBorder}`,
                color: T.brandDeep, fontSize: 12, fontWeight: 600,
              }}>
                Password changed successfully.
              </div>
            )}
            {!showPasswordForm ? (
              <button
                type="button"
                onClick={() => setShowPasswordForm(true)}
                style={{
                  fontSize: 13, fontWeight: 600, color: T.brand,
                  background: "transparent", border: "none",
                  cursor: "pointer", padding: 0, fontFamily: T.font,
                }}
              >
                Change password &rarr;
              </button>
            ) : (
              <form
                onSubmit={(e) => { void handlePasswordSubmit(e); }}
                style={{ display: "flex", flexDirection: "column", gap: 10 }}
              >
                {pwError && (
                  <div style={{
                    padding: "8px 12px", borderRadius: 7,
                    background: "#FEF2F2", border: "1px solid #FECACA",
                    color: "#991B1B", fontSize: 12,
                  }}>
                    {pwError}
                  </div>
                )}
                <div>
                  <label style={labelStyle}>Current password</label>
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    autoComplete="current-password"
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.1)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>New password</label>
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    autoComplete="new-password"
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.1)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
                <div>
                  <label style={labelStyle}>Confirm new password</label>
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    autoComplete="new-password"
                    style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.1)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="submit"
                    disabled={pwSaving}
                    style={{
                      flex: 1, padding: "9px 0", borderRadius: 7,
                      border: "none", background: T.brand,
                      color: "#fff", fontSize: 13, fontWeight: 700,
                      cursor: pwSaving ? "wait" : "pointer",
                      fontFamily: T.font,
                      opacity: pwSaving ? 0.75 : 1,
                    }}
                  >
                    {pwSaving ? "Updating…" : "Update password"}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowPasswordForm(false); setPwError(""); setCurrentPw(""); setNewPw(""); setConfirmPw(""); }}
                    style={{
                      padding: "9px 14px", borderRadius: 7,
                      border: `1px solid ${T.border}`,
                      background: "transparent", fontSize: 13,
                      cursor: "pointer", fontFamily: T.font, color: T.text,
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* ── Section 4: Account ────────────────────────────────────────── */}
          <div>
            <div style={sectionHeadingStyle}>Account</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 5, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.01em" }}>Role</div>
                <span style={{
                  display: "inline-flex", alignItems: "center",
                  padding: "3px 11px", borderRadius: 99,
                  fontSize: 11, fontWeight: 700,
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  background: roleStyle.bg, color: roleStyle.color,
                  border: `1px solid ${roleStyle.border}`,
                }}>
                  {user.role}
                </span>
              </div>
              <div>
                <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.01em" }}>Member since</div>
                <div style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>
                  {formatDate(user.createdAt)}
                </div>
              </div>
              {user.lastLoginAt && (
                <div>
                  <div style={{ fontSize: 11, color: T.textSoft, marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.01em" }}>Last sign-in</div>
                  <div style={{ fontSize: 13, color: T.textSec, fontWeight: 500 }}>
                    {formatDate(user.lastLoginAt)}
                  </div>
                </div>
              )}
            </div>
          </div>

        </div>
        {/* End scrollable body */}
      </div>
    </>
  );
}
