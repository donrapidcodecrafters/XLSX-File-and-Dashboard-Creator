import { createPortal } from "react-dom";

const FRIENDLY_STATUS: Record<string, { label: string; sub: string }> = {
  queued:    { label: "Getting ready…",          sub: "Your request is in the queue" },
  running:   { label: "Syncing data…",           sub: "This usually takes just a moment" },
  complete:  { label: "All done!",               sub: "Your data is up to date" },
  failed:    { label: "Something went wrong",    sub: "Please try again or check Settings for details" },
  cancelled: { label: "Operation was cancelled", sub: "No changes were made" },
};

const BAR_COLOR: Record<string, string> = {
  failed:    "#b42318",
  cancelled: "#946200",
  complete:  "#0d7c66",
  running:   "#0d7c66",
  queued:    "#0d7c66",
};

const INDETERMINATE_KEYFRAMES = `
@keyframes roc-slide {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(400%); }
}`;

export function RefreshOverlay({
  title,
  job,
  indeterminate = false,
  status = "running",
  onDismiss,
}: {
  title: string;
  job: { progress?: number; message?: string; estimatedSecondsRemaining?: number } | null;
  indeterminate?: boolean;
  status?: "queued" | "running" | "complete" | "failed" | "cancelled";
  onDismiss?: () => void;
}) {
  if (!job) return null;

  const terminal  = status === "complete" || status === "failed" || status === "cancelled";
  const progress  = terminal ? 100 : (indeterminate ? 42 : (job.progress ?? 0));
  const barColor  = BAR_COLOR[status] ?? "#0d7c66";
  const isFailed  = status === "failed" || status === "cancelled";

  const friendlyStatus = FRIENDLY_STATUS[status] ?? FRIENDLY_STATUS.running;

  /* Time-remaining copy — friendly, not raw seconds */
  let timeHint: string;
  if (terminal) {
    timeHint = isFailed ? "Please review the message above" : "";
  } else if (indeterminate) {
    timeHint = "Preparing your results…";
  } else if (typeof job.estimatedSecondsRemaining === "number" && job.estimatedSecondsRemaining > 0) {
    const s = job.estimatedSecondsRemaining;
    timeHint = s < 5 ? "Almost there…" : s < 60 ? `About ${s} seconds left` : `About ${Math.ceil(s / 60)} minute${Math.ceil(s / 60) > 1 ? "s" : ""} left`;
  } else {
    timeHint = "Working…";
  }

  const overlay = (
    <>
      {/* inject keyframes once — harmless if repeated */}
      <style>{INDETERMINATE_KEYFRAMES}</style>

      {/* backdrop */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(10, 20, 16, 0.62)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          zIndex: 9999,
          display: "grid",
          placeItems: "center",
          padding: "24px",
        }}
      >
        {/* card */}
        <div
          style={{
            width: "min(520px, 100%)",
            background: "#ffffff",
            borderRadius: "16px",
            padding: "32px 32px 28px",
            boxShadow: "0 8px 16px rgba(0,0,0,0.08), 0 32px 72px rgba(0,0,0,0.22)",
            display: "flex",
            flexDirection: "column",
            gap: "0",
          }}
        >
          {/* ── header ── */}
          <p
            style={{
              margin: "0 0 4px",
              fontSize: "0.78rem",
              fontWeight: 600,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "#6b8c7a",
            }}
          >
            {title}
          </p>

          <h2
            style={{
              margin: "0 0 6px",
              fontSize: "1.25rem",
              fontWeight: 700,
              color: isFailed ? "#8c1c13" : "#0d2b20",
              lineHeight: 1.3,
            }}
          >
            {friendlyStatus.label}
          </h2>

          <p
            style={{
              margin: "0 0 20px",
              fontSize: "0.92rem",
              color: "#4a6857",
              lineHeight: 1.5,
            }}
          >
            {/* prefer the live message from the job when running; fall back to friendly sub-text */}
            {(!terminal && job.message) ? job.message : friendlyStatus.sub}
          </p>

          {/* ── progress bar ── */}
          <div
            role="progressbar"
            aria-valuenow={indeterminate ? undefined : progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progress"
            style={{
              height: "10px",
              background: "#e0ece6",
              borderRadius: "999px",
              overflow: "hidden",
              marginBottom: "12px",
            }}
          >
            {indeterminate && !terminal ? (
              /* animated shimmer stripe */
              <div
                style={{
                  height: "100%",
                  width: "30%",
                  background: "linear-gradient(90deg, #62b8a4, #0d7c66, #62b8a4)",
                  borderRadius: "999px",
                  animation: "roc-slide 1.6s ease-in-out infinite",
                }}
              />
            ) : (
              <div
                style={{
                  height: "100%",
                  width: `${progress}%`,
                  background: barColor,
                  borderRadius: "999px",
                  transition: "width 0.4s ease",
                }}
              />
            )}
          </div>

          {/* ── footer row ── */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              fontSize: "0.84rem",
              color: "#6b8c7a",
            }}
          >
            <span style={{ fontWeight: 600 }}>
              {terminal
                ? (status === "complete" ? "Complete" : status === "failed" ? "Failed" : "Cancelled")
                : indeterminate
                  ? "In progress"
                  : `${progress}% complete`}
            </span>
            <span>{timeHint}</span>
          </div>

          {/* ── dismiss button (terminal non-complete states) ── */}
          {terminal && status !== "complete" && onDismiss ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: "10px 22px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1.5px solid #c9d9d0",
                  background: "#ffffff",
                  color: "#0d2b20",
                  cursor: "pointer",
                  transition: "background 0.15s, border-color 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#f0f6f3";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#9bbdae";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#ffffff";
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "#c9d9d0";
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {/* auto-dismiss hint for complete state */}
          {status === "complete" && onDismiss ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "24px" }}>
              <button
                type="button"
                onClick={onDismiss}
                style={{
                  padding: "10px 22px",
                  fontSize: "0.9rem",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "none",
                  background: "#0d7c66",
                  color: "#ffffff",
                  cursor: "pointer",
                  transition: "background 0.15s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#0b6b58";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = "#0d7c66";
                }}
              >
                Done
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );

  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
