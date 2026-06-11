import { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { getInvitation, acceptInvitation } from "../lib/studioApi";
import type { PendingInvitation } from "../lib/studioApi";

const T = {
  bg: "#F1F5F9", surface: "#FFFFFF", border: "#E5E7EB", borderFocus: "#0d7c66",
  brand: "#0d7c66", brandDeep: "#065F46", brandLight: "#ECFDF5", brandBorder: "#A7F3D0",
  text: "#111827", textSoft: "#6B7280", textSecondary: "#374151",
  errorBg: "#FEF2F2", errorBorder: "#FECACA", errorText: "#991B1B",
  font: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator — full access to all features and user management",
  editor: "Editor — can create and edit reports and dashboards",
  viewer: "Viewer — can read and use shared reports and dashboards",
};

export function AcceptInvitationPage() {
  // useParams() only works inside a <Route> — fall back to parsing the URL directly
  // since this component may be rendered from App.tsx's early-return path check.
  const params = useParams<{ token: string }>();
  const location = useLocation();
  // Extract token from multiple sources — useParams only works inside a <Route>,
  // so fall back to location.pathname, then window.location for guaranteed extraction.
  const token = params.token
    || location.pathname.split("/accept-invitation/")[1]?.split("/")[0]
    || window.location.pathname.split("/accept-invitation/")[1]?.split("/")[0];
  const navigate = useNavigate();

  const [status, setStatus] = useState<"loading" | "valid" | "invalid" | "success">("loading");
  const [invalidReason, setInvalidReason] = useState<"canceled" | "expired" | "accepted" | "unknown">("unknown");
  const [invitation, setInvitation] = useState<PendingInvitation | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setInvalidReason("unknown"); setStatus("invalid"); return; }
    getInvitation(token)
      .then((result) => {
        setInvitation(result.invitation);
        setDisplayName(result.invitation.displayName || "");
        setStatus("valid");
      })
      .catch((err) => {
        const reason = (err as { reason?: string } | undefined)?.reason;
        setInvalidReason(reason === "expired" ? "expired" : reason === "accepted" ? "accepted" : "canceled");
        setStatus("invalid");
      });
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setSubmitting(true); setError("");
    try {
      await acceptInvitation(token, { displayName: displayName.trim(), password });
      setStatus("success");
      setTimeout(() => { window.location.href = "/"; }, 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: `1px solid ${T.border}`, fontSize: 13,
    fontFamily: T.font, color: T.text, background: T.surface,
    outline: "none", boxSizing: "border-box" as const,
    transition: "border-color 100ms, box-shadow 100ms",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", background: T.bg, padding: 24, fontFamily: T.font }}>
      <div style={{ width: "100%", maxWidth: 460, background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${T.brand}, ${T.brandDeep})` }} />
        <div style={{ padding: "32px 32px 28px" }}>

          {/* Loading */}
          {status === "loading" && (
            <div style={{ textAlign: "center", color: T.textSoft, padding: "32px 0" }}>
              Verifying your invitation…
            </div>
          )}

          {/* Invalid */}
          {status === "invalid" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>
                {invalidReason === "expired" ? "⏰" : invalidReason === "accepted" ? "✅" : "🚫"}
              </div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: T.text }}>
                {invalidReason === "expired" && "Invitation expired"}
                {invalidReason === "accepted" && "Already accepted"}
                {invalidReason === "canceled" && "Invitation canceled"}
                {invalidReason === "unknown" && "Invitation not found"}
              </h2>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textSoft, lineHeight: 1.6 }}>
                {invalidReason === "expired" && "This invitation link has expired. Please contact your administrator to send a new invitation."}
                {invalidReason === "accepted" && "This invitation has already been used to create an account. If that was you, sign in below."}
                {invalidReason === "canceled" && "This invitation has been canceled by an administrator. Please reach out to them if you still need access."}
                {invalidReason === "unknown" && "This invitation link is invalid or was not found. Ask your administrator to send a new invitation."}
              </p>
              <button onClick={() => { window.location.href = "/"; }} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                {invalidReason === "accepted" ? "Go to sign-in" : "Back to sign-in"}
              </button>
            </div>
          )}

          {/* Success */}
          {status === "success" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: T.text }}>You're all set!</h2>
              <p style={{ margin: 0, fontSize: 13, color: T.textSoft }}>Your account has been created. Redirecting you now…</p>
            </div>
          )}

          {/* Valid — show the form */}
          {status === "valid" && invitation && (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: T.brandLight, border: `1px solid ${T.brandBorder}`, marginBottom: 14 }}>
                  <span style={{ fontSize: 24 }}>👋</span>
                </div>
                <h1 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em", color: T.text }}>
                  Welcome!
                </h1>
                <p style={{ margin: "0 0 4px", fontSize: 13, color: T.textSoft }}>
                  You've been invited to join the platform.
                </p>
                <p style={{ margin: 0, fontSize: 12, color: T.textSoft }}>
                  Signing in as: <strong style={{ color: T.text }}>{invitation.email}</strong>
                </p>
              </div>

              {/* Role info */}
              <div style={{ padding: "10px 14px", borderRadius: 8, background: T.brandLight, border: `1px solid ${T.brandBorder}`, marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.brand, marginBottom: 3 }}>Your role</div>
                <div style={{ fontSize: 12, color: T.brandDeep, fontWeight: 500 }}>
                  {ROLE_LABELS[invitation.role] || invitation.role}
                </div>
              </div>

              {error && (
                <div style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.errorBorder}`, background: T.errorBg, color: T.errorText, fontSize: 13, marginBottom: 14 }}>
                  {error}
                </div>
              )}

              <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 5 }}>Your name</label>
                  <input
                    type="text" value={displayName} onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Full name" autoFocus style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.borderFocus; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 5 }}>Choose a password</label>
                  <input
                    type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 8 characters" style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  {password.length > 0 && password.length < 8 && (
                    <div style={{ fontSize: 11, color: "#D97706", marginTop: 4 }}>Password must be at least 8 characters</div>
                  )}
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 5 }}>Confirm password</label>
                  <input
                    type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your password" style={inputStyle}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.border; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  {confirmPassword.length > 0 && password !== confirmPassword && (
                    <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>Passwords do not match</div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={submitting || !displayName.trim() || password.length < 8 || password !== confirmPassword}
                  style={{
                    marginTop: 4, padding: "11px 16px", borderRadius: 8, border: "none",
                    background: submitting ? T.brandDeep : T.brand, color: "#fff",
                    fontSize: 14, fontWeight: 700, cursor: submitting ? "wait" : "pointer",
                    fontFamily: T.font, opacity: (!displayName.trim() || password.length < 8 || password !== confirmPassword) ? 0.55 : 1,
                    transition: "opacity 100ms, background 100ms",
                  }}
                >
                  {submitting ? "Setting up your account…" : "Set up my account"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
