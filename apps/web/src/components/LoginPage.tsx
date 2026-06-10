import { useEffect, useRef, useState } from "react";
import {
  complete2FASetup,
  get2FASetup,
  loginWithPassword,
  verify2FACode,
} from "../lib/studioApi";

type Step = "credentials" | "setup_qr" | "setup_code" | "verify_code";

interface LoginPageProps {
  platformName?: string;
  onLoginSuccess: () => void;
}

// ── Inline design tokens ──────────────────────────────────────────────────────
const T = {
  bg:          "var(--bg, #F8FAFC)",
  surface:     "var(--surface, #ffffff)",
  border:      "var(--border, #E5E7EB)",
  brand:       "#0d7c66",
  brandDark:   "#065F46",
  brandLight:  "var(--brand-light, #ECFDF5)",
  brandBorder: "var(--brand-border, #A7F3D0)",
  text:        "var(--text, #111827)",
  textSoft:    "var(--text-soft, #6B7280)",
  danger:      "#DC2626",
  dangerBg:    "var(--error-bg, #FEF2F2)",
  dangerBorder:"var(--error-border, #FECACA)",
  font:        "'Inter','Segoe UI',system-ui,sans-serif",
  radius:      "12px",
};

// ── IMPORTANT: Card and ErrorBox are defined OUTSIDE LoginPage.
// Defining components inside another component creates a new function reference
// on every render, causing React to unmount+remount the children (losing input focus).

function LoginCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100dvh",
      background: T.bg,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "24px 16px",
      fontFamily: T.font,
    }}>
      <div style={{
        width: "100%",
        maxWidth: 420,
        background: T.surface,
        border: `1px solid ${T.border}`,
        borderRadius: 18,
        boxShadow: "0 4px 24px rgba(0,0,0,0.08)",
        overflow: "hidden",
      }}>
        <div style={{ height: 4, background: `linear-gradient(90deg, ${T.brand}, #10B981)` }} />
        {children}
      </div>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <div style={{
      padding: "10px 14px",
      borderRadius: 8,
      background: T.dangerBg,
      border: `1px solid ${T.dangerBorder}`,
      color: T.danger,
      fontSize: 13,
      lineHeight: 1.4,
    }}>
      {msg}
    </div>
  );
}

export function LoginPage({ platformName = "Reporting Portal", onLoginSuccess }: LoginPageProps) {
  const [step, setStep] = useState<Step>("credentials");

  // Credentials step
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");

  // 2FA state
  const [pendingToken, setPendingToken] = useState("");
  const [qrDataUrl, setQrDataUrl]       = useState("");
  const [manualSecret, setManualSecret] = useState("");
  const [issuer, setIssuer]             = useState("");
  const [code, setCode]                 = useState("");

  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const emailInputRef = useRef<HTMLInputElement>(null);
  const codeInputRef  = useRef<HTMLInputElement>(null);

  // Focus email on mount — but NEVER steal focus from an element the user is already typing in.
  // Without this guard, if LoginPage remounts (authState cycle) the email steals focus mid-typing.
  useEffect(() => {
    const active = document.activeElement;
    const userIsTyping = active && active !== document.body && active !== document.documentElement;
    if (!userIsTyping) {
      emailInputRef.current?.focus();
    }
  }, []); // empty deps = mount only, but guard prevents theft on remount

  // Auto-focus code input when we reach a code entry step
  useEffect(() => {
    if (step === "setup_code" || step === "verify_code") {
      setCode("");
      setTimeout(() => codeInputRef.current?.focus(), 100);
    }
  }, [step]);

  // ── Step 1: email + password ──────────────────────────────────────────────
  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setLoading(true);
    setError("");
    try {
      const result = await loginWithPassword(email.trim(), password);
      setPendingToken(result.pendingToken);

      if (result.step === "2fa_setup_required") {
        // Load QR code
        const setup = await get2FASetup(result.pendingToken);
        setQrDataUrl(setup.qrCodeDataUrl);
        setManualSecret(setup.secret);
        setIssuer(setup.issuer);
        setPendingToken(setup.pendingToken); // refreshed token from setup endpoint
        setStep("setup_qr");
      } else {
        // 2FA already configured — ask for code
        setStep("verify_code");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2a: user has scanned QR, now enter code ──────────────────────────
  function handleQrScanned() {
    setStep("setup_code");
  }

  // ── Step 2b: verify setup code ────────────────────────────────────────────
  async function handleSetupCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, "");
    if (trimmed.length !== 6) { setError("Enter all 6 digits."); return; }
    setLoading(true);
    setError("");
    try {
      await complete2FASetup(pendingToken, trimmed);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2c: verify existing TOTP code ───────────────────────────────────
  async function handleVerifyCode(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = code.replace(/\s/g, "");
    if (trimmed.length !== 6) { setError("Enter all 6 digits."); return; }
    setLoading(true);
    setError("");
    try {
      await verify2FACode(pendingToken, trimmed);
      onLoginSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Incorrect code.");
    } finally {
      setLoading(false);
    }
  }

  // ── Step 1 render: email + password ──────────────────────────────────────
  if (step === "credentials") {
    return (
      <LoginCard>
        <div style={{ padding: "32px 32px 28px" }}>
          {/* Logo / title */}
          <div style={{ textAlign: "center", marginBottom: 28 }}>
            <div style={{
              width: 48, height: 48, borderRadius: 12,
              background: T.brandLight, border: `1px solid ${T.brandBorder}`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 22, margin: "0 auto 14px",
            }}>⚡</div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em" }}>
              {platformName}
            </div>
            <div style={{ fontSize: 13, color: T.textSoft, marginTop: 4 }}>
              Sign in to your account
            </div>
          </div>

          <form onSubmit={(e) => { void handleCredentials(e); }} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Email address</label>
              <input
                ref={emailInputRef}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
                disabled={loading}
                required
                style={inputStyle}
                onFocus={(e) => focusInput(e)}
                onBlur={(e) => blurInput(e)}
              />
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.text }}>Password</label>
              <div style={{ position: "relative" }}>
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={loading}
                  required
                  style={{ ...inputStyle, paddingRight: 44 }}
                  onFocus={(e) => focusInput(e)}
                  onBlur={(e) => blurInput(e)}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    background: "none", border: "none", cursor: "pointer",
                    padding: "4px", color: T.textSoft, lineHeight: 1,
                    display: "flex", alignItems: "center",
                  }}
                >
                  {showPassword
                    ? /* eye-off */ (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    )
                    : /* eye */ (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )
                  }
                </button>
              </div>
            </div>

            <ErrorBox msg={error} />

            <button
              type="submit"
              disabled={loading || !email.trim() || !password}
              style={submitStyle(loading || !email.trim() || !password)}
            >
              {loading ? "Signing in…" : "Continue →"}
            </button>
          </form>

          <p style={{ textAlign: "center", fontSize: 11, color: T.textSoft, marginTop: 20, marginBottom: 0 }}>
            After signing in you'll be asked for your<br />
            <strong style={{ color: T.text }}>Microsoft Authenticator</strong> 6-digit code.
          </p>
        </div>
      </LoginCard>
    );
  }

  // ── Step 2 render: QR code setup screen ───────────────────────────────────
  if (step === "setup_qr") {
    return (
      <LoginCard>
        <div style={{ padding: "32px 32px 28px", display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
              Set up two-factor authentication
            </div>
            <div style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.6 }}>
              This is a one-time setup. Open <strong style={{ color: T.text }}>Microsoft Authenticator</strong> on
              your phone, tap <strong style={{ color: T.text }}>+</strong> → <em>Other account</em>, then
              scan the QR code below.
            </div>
          </div>

          {/* QR code */}
          {qrDataUrl ? (
            <div style={{ textAlign: "center" }}>
              <img
                src={qrDataUrl}
                alt="2FA QR code"
                width={200}
                height={200}
                style={{
                  border: `3px solid ${T.brand}`,
                  borderRadius: 12,
                  padding: 8,
                  background: "#fff",
                }}
              />
            </div>
          ) : (
            <div style={{ height: 216, display: "flex", alignItems: "center", justifyContent: "center", color: T.textSoft }}>
              Loading QR code…
            </div>
          )}

          {/* Manual entry fallback */}
          <details style={{ fontSize: 12, color: T.textSoft }}>
            <summary style={{ cursor: "pointer", fontWeight: 600, color: T.text, userSelect: "none" }}>
              Can't scan? Enter the code manually
            </summary>
            <div style={{ marginTop: 10, padding: "10px 12px", background: T.bg, borderRadius: 8, border: `1px solid ${T.border}` }}>
              <div style={{ marginBottom: 4 }}>Account: <strong style={{ color: T.text }}>{email}</strong></div>
              <div style={{ marginBottom: 4 }}>Issuer: <strong style={{ color: T.text }}>{issuer}</strong></div>
              <div>Secret key:</div>
              <code style={{
                display: "block", marginTop: 4, padding: "6px 10px",
                background: T.surface, border: `1px solid ${T.border}`,
                borderRadius: 6, fontSize: 13, letterSpacing: "0.1em",
                wordBreak: "break-all", color: T.brand, fontWeight: 700,
              }}>
                {manualSecret}
              </code>
            </div>
          </details>

          <ErrorBox msg={error} />

          <button
            type="button"
            onClick={handleQrScanned}
            style={submitStyle(false)}
          >
            I've scanned the code →
          </button>

          <button type="button" onClick={() => { setStep("credentials"); setError(""); }} style={backStyle}>
            ← Back to sign in
          </button>
        </div>
      </LoginCard>
    );
  }

  // ── Step 3a render: enter code to confirm setup ───────────────────────────
  if (step === "setup_code") {
    return (
      <LoginCard>
        <div style={{ padding: "32px 32px 28px" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
              Confirm your authenticator
            </div>
            <div style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.6 }}>
              Enter the <strong style={{ color: T.text }}>6-digit code</strong> showing in
              Microsoft Authenticator to confirm setup.
            </div>
          </div>

          <form onSubmit={(e) => { void handleSetupCode(e); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CodeInput
              value={code}
              onChange={setCode}
              inputRef={codeInputRef}
              disabled={loading}
            />

            <ErrorBox msg={error} />

            <button
              type="submit"
              disabled={loading || code.replace(/\s/g, "").length !== 6}
              style={submitStyle(loading || code.replace(/\s/g, "").length !== 6)}
            >
              {loading ? "Verifying…" : "Verify & sign in →"}
            </button>
          </form>

          <button type="button" onClick={() => { setStep("setup_qr"); setError(""); }} style={{ ...backStyle, marginTop: 12 }}>
            ← Back to QR code
          </button>
        </div>
      </LoginCard>
    );
  }

  // ── Step 3b render: enter existing TOTP code ──────────────────────────────
  if (step === "verify_code") {
    return (
      <LoginCard>
        <div style={{ padding: "32px 32px 28px" }}>
          <div style={{ marginBottom: 24 }}>
            <div style={{ textAlign: "center", marginBottom: 16 }}>
              <div style={{
                width: 48, height: 48, borderRadius: 12,
                background: T.brandLight, border: `1px solid ${T.brandBorder}`,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 22, margin: "0 auto",
              }}>🔐</div>
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.text, letterSpacing: "-0.02em", marginBottom: 4 }}>
              Two-factor authentication
            </div>
            <div style={{ fontSize: 13, color: T.textSoft, lineHeight: 1.6 }}>
              Open <strong style={{ color: T.text }}>Microsoft Authenticator</strong> and enter
              the 6-digit code for <strong style={{ color: T.text }}>{issuer || "this platform"}</strong>.
            </div>
          </div>

          <form onSubmit={(e) => { void handleVerifyCode(e); }} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CodeInput
              value={code}
              onChange={setCode}
              inputRef={codeInputRef}
              disabled={loading}
            />

            <ErrorBox msg={error} />

            <button
              type="submit"
              disabled={loading || code.replace(/\s/g, "").length !== 6}
              style={submitStyle(loading || code.replace(/\s/g, "").length !== 6)}
            >
              {loading ? "Verifying…" : "Sign in →"}
            </button>
          </form>

          <button type="button" onClick={() => { setStep("credentials"); setError(""); setPendingToken(""); }} style={{ ...backStyle, marginTop: 12 }}>
            ← Use a different account
          </button>
        </div>
      </LoginCard>
    );
  }

  return null;
}

// ── 6-digit code input ────────────────────────────────────────────────────────

function CodeInput({
  value,
  onChange,
  inputRef,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef: React.RefObject<HTMLInputElement>;
  disabled: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text, #111827)" }}>
        Authenticator code
      </label>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        pattern="[0-9 ]*"
        maxLength={7}
        value={value}
        onChange={(e) => {
          // Only allow digits and spaces, max 6 digits
          const raw = e.target.value.replace(/[^0-9]/g, "").slice(0, 6);
          onChange(raw);
        }}
        placeholder="000 000"
        autoComplete="one-time-code"
        disabled={disabled}
        style={{
          width: "100%",
          padding: "14px 16px",
          borderRadius: 10,
          border: "1.5px solid var(--border, #D1D5DB)",
          fontSize: 28,
          fontWeight: 700,
          letterSpacing: "0.3em",
          textAlign: "center",
          fontFamily: "monospace",
          color: "var(--text, #111827)",
          outline: "none",
          boxSizing: "border-box" as const,
          transition: "border-color 100ms",
          background: value.replace(/\s/g, "").length === 6 ? "var(--brand-light, #ECFDF5)" : "var(--surface, #fff)",
          borderColor: value.replace(/\s/g, "").length === 6 ? "#0d7c66" : "var(--border-md, #D1D5DB)",
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = "#0d7c66"; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
        onBlur={(e) => {
          const full = value.replace(/\s/g, "").length === 6;
          e.currentTarget.style.borderColor = full ? "#0d7c66" : "";
          e.currentTarget.style.boxShadow = "none";
        }}
      />
      <div style={{ fontSize: 11, color: "var(--text-soft, #9CA3AF)", textAlign: "center" }}>
        Code refreshes every 30 seconds
      </div>
    </div>
  );
}

// ── Shared style helpers ──────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 13px",
  borderRadius: 8,
  border: "1.5px solid var(--border, #D1D5DB)",
  fontSize: 14,
  fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
  color: "var(--text, #111827)",
  background: "var(--surface, #fff)",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 100ms, box-shadow 100ms",
};

function focusInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "#0d7c66";
  e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)";
}

function blurInput(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.style.borderColor = "";
  e.currentTarget.style.boxShadow = "none";
}

function submitStyle(disabled: boolean): React.CSSProperties {
  return {
    width: "100%",
    padding: "12px 16px",
    borderRadius: 10,
    border: "none",
    background: disabled ? "#D1D5DB" : "#0d7c66",
    color: "#fff",
    fontSize: 15,
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
    transition: "background 100ms",
    opacity: disabled ? 0.65 : 1,
  };
}

const backStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "8px 0",
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  color: "#6B7280",
  textAlign: "center",
  fontFamily: "'Inter','Segoe UI',system-ui,sans-serif",
};
