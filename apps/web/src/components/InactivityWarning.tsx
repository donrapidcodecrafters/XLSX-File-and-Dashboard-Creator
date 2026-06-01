interface Props {
  secondsLeft: number;
  onStay: () => void;
  onLogout: () => void;
}

export function InactivityWarning({ secondsLeft, onStay, onLogout }: Props) {
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const timeStr = mins > 0
    ? `${mins}:${String(secs).padStart(2, "0")}`
    : `${secs}s`;

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 99999,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 400,
        background: "var(--surface, #fff)",
        border: "1px solid var(--border, #E5E7EB)",
        borderRadius: 16,
        boxShadow: "0 20px 40px rgba(0,0,0,0.2)",
        padding: "28px 28px 24px",
        fontFamily: "var(--sans, 'Inter', sans-serif)",
      }}>
        {/* Icon */}
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: "50%",
            background: "rgba(245,158,11,0.1)",
            border: "2px solid rgba(245,158,11,0.3)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22, margin: "0 auto",
          }}>⏱</div>
        </div>

        {/* Message */}
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: "var(--text, #111827)", marginBottom: 8 }}>
            Session expiring soon
          </div>
          <div style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", lineHeight: 1.6 }}>
            You've been inactive. Your session will expire in
          </div>
          <div style={{
            fontSize: 36, fontWeight: 800, color: "#D97706",
            fontVariantNumeric: "tabular-nums", margin: "8px 0 4px",
            letterSpacing: "-0.02em",
          }}>
            {timeStr}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-soft, #6B7280)" }}>
            Click below to stay signed in.
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", gap: 10 }}>
          <button
            type="button"
            onClick={onLogout}
            style={{
              flex: 1, padding: "10px", borderRadius: 9,
              border: "1px solid var(--border, #E5E7EB)",
              background: "var(--surface-alt, #F9FAFB)",
              color: "var(--text-soft, #6B7280)",
              fontSize: 13, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Sign out now
          </button>
          <button
            type="button"
            onClick={onStay}
            autoFocus
            style={{
              flex: 1, padding: "10px", borderRadius: 9,
              border: "none",
              background: "var(--brand, #0d7c66)",
              color: "#fff",
              fontSize: 13, fontWeight: 700, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            Stay signed in
          </button>
        </div>
      </div>
    </div>
  );
}
