import { useEffect, useState } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import { verifyPasswordResetToken, completePasswordReset } from "../lib/studioApi";

const T = {
  bg: "#F1F5F9", surface: "#FFFFFF", border: "#E5E7EB", borderFocus: "#0d7c66",
  brand: "#0d7c66", brandDeep: "#065F46", brandLight: "#ECFDF5", brandBorder: "#A7F3D0",
  text: "#111827", textSoft: "#6B7280", textSecondary: "#374151",
  errorBg: "#FEF2F2", errorBorder: "#FECACA", errorText: "#991B1B",
  font: "'Inter', 'Segoe UI', system-ui, sans-serif",
};

export function ResetPasswordPage() {
  const params = useParams<{ token: string }>();
  const location = useLocation();
  const token = params.token
    || location.pathname.split("/reset-password/")[1]?.split("/")[0]
    || window.location.pathname.split("/reset-password/")[1]?.split("/")[0];
  const navigate = useNavigate();

  const [status, setStatus] = useState<"loading" | "valid" | "invalid" | "success">("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) { setStatus("invalid"); return; }
    verifyPasswordResetToken(token)
      .then((r) => { if (r.valid) { setEmail(r.email); setStatus("valid"); } else setStatus("invalid"); })
      .catch(() => setStatus("invalid"));
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirmPassword) { setError("Passwords do not match."); return; }
    setSubmitting(true); setError("");
    try {
      await completePasswordReset(token, password);
      setStatus("success");
      setTimeout(() => { window.location.href = "/"; }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally { setSubmitting(false); }
  }

  const inputStyle = {
    width: "100%", padding: "9px 12px", borderRadius: 8,
    border: `1px solid ${T.border}`, fontSize: 13,
    fontFamily: T.font, color: T.text, background: T.surface,
    outline: "none", boxSizing: "border-box" as const,
  };

  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100dvh", background: T.bg, padding: 24, fontFamily: T.font }}>
      <div style={{ width: "100%", maxWidth: 440, background: T.surface, borderRadius: 16, border: `1px solid ${T.border}`, boxShadow: "0 4px 24px rgba(0,0,0,0.1)", overflow: "hidden" }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${T.brand}, ${T.brandDeep})` }} />
        <div style={{ padding: "32px 32px 28px" }}>

          {status === "loading" && (
            <div style={{ textAlign: "center", color: T.textSoft, padding: "32px 0" }}>Verifying your reset link…</div>
          )}

          {status === "invalid" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: T.text }}>Link expired or invalid</h2>
              <p style={{ margin: "0 0 20px", fontSize: 13, color: T.textSoft, lineHeight: 1.6 }}>
                This password reset link has expired or already been used. Ask your administrator to send a new one.
              </p>
              <button onClick={() => { window.location.href = "/"; }} style={{ padding: "10px 20px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font }}>
                Go to sign-in
              </button>
            </div>
          )}

          {status === "success" && (
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 40, marginBottom: 16 }}>✅</div>
              <h2 style={{ margin: "0 0 8px", fontSize: "1.25rem", fontWeight: 700, color: T.text }}>Password updated!</h2>
              <p style={{ margin: 0, fontSize: 13, color: T.textSoft }}>Your password has been changed. Redirecting to sign-in…</p>
            </div>
          )}

          {status === "valid" && (
            <>
              <div style={{ textAlign: "center", marginBottom: 24 }}>
                <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 52, height: 52, borderRadius: 14, background: T.brandLight, border: `1px solid ${T.brandBorder}`, marginBottom: 14 }}>
                  <span style={{ fontSize: 24 }}>🔑</span>
                </div>
                <h1 style={{ margin: "0 0 6px", fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em", color: T.text }}>Reset your password</h1>
                <p style={{ margin: 0, fontSize: 12, color: T.textSoft }}>
                  Setting a new password for <strong style={{ color: T.text }}>{email}</strong>
                </p>
              </div>

              {error && (
                <div style={{ padding: "10px 14px", borderRadius: 8, border: `1px solid ${T.errorBorder}`, background: T.errorBg, color: T.errorText, fontSize: 13, marginBottom: 14 }}>
                  {error}
                </div>
              )}

              <form onSubmit={(e) => { void handleSubmit(e); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 5 }}>New password</label>
                  <div style={{ position: "relative" }}>
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 8 characters"
                      autoFocus
                      style={{ ...inputStyle, paddingRight: 40 }}
                    />
                    <button type="button" tabIndex={-1} onClick={() => setShowPassword(v => !v)}
                      style={{ position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: T.textSoft, padding: 4 }}>
                      {showPassword ? "🙈" : "👁"}
                    </button>
                  </div>
                  {password.length > 0 && password.length < 8 && (
                    <div style={{ fontSize: 11, color: "#D97706", marginTop: 4 }}>Password must be at least 8 characters</div>
                  )}
                </div>
                <div>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: T.textSecondary, marginBottom: 5 }}>Confirm new password</label>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter your new password"
                    style={inputStyle}
                  />
                  {confirmPassword.length > 0 && password !== confirmPassword && (
                    <div style={{ fontSize: 11, color: "#DC2626", marginTop: 4 }}>Passwords do not match</div>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={submitting || password.length < 8 || password !== confirmPassword}
                  style={{
                    marginTop: 4, padding: "11px 16px", borderRadius: 8, border: "none",
                    background: T.brand, color: "#fff", fontSize: 14, fontWeight: 700,
                    cursor: submitting ? "wait" : "pointer", fontFamily: T.font,
                    opacity: (password.length < 8 || password !== confirmPassword) ? 0.55 : 1,
                  }}
                >
                  {submitting ? "Updating password…" : "Set new password"}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
