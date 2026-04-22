export function RefreshOverlay({
  title,
  job,
  indeterminate = false,
  onCancel,
  cancelLabel = "Cancel refresh"
}: {
  title: string;
  job: { progress?: number; message?: string; estimatedSecondsRemaining?: number } | null;
  indeterminate?: boolean;
  onCancel?: (() => void) | null;
  cancelLabel?: string;
}) {
  if (!job) return null;
  const progress = indeterminate ? 42 : (job.progress || 0);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
      <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
        <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>{title}</strong>
        <div style={{ marginBottom: "10px", color: "#41554a" }}>{job.message}</div>
        <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
          <div style={{ height: "100%", width: `${progress}%`, background: indeterminate ? "linear-gradient(90deg, #0d7c66, #62b8a4)" : "#0d7c66" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
          <span>{indeterminate ? "Loading in progress" : `${progress}% complete`}</span>
          <span>{indeterminate ? "Preparing results…" : (typeof job.estimatedSecondsRemaining === "number" ? `~${job.estimatedSecondsRemaining}s remaining` : "Estimating time…")}</span>
        </div>
        {onCancel ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "16px" }}>
            <button className="ghost-button" onClick={onCancel}>{cancelLabel}</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
