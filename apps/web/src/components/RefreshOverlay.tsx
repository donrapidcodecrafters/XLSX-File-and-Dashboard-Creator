import { createPortal } from "react-dom";

export function RefreshOverlay({
  title,
  job,
  indeterminate = false,
  status = "running",
  onDismiss
}: {
  title: string;
  job: { progress?: number; message?: string; estimatedSecondsRemaining?: number } | null;
  indeterminate?: boolean;
  status?: "queued" | "running" | "complete" | "failed" | "cancelled";
  onDismiss?: () => void;
}) {
  if (!job) return null;
  const progress = indeterminate ? 42 : (job.progress || 0);
  const terminal = status === "complete" || status === "failed" || status === "cancelled";
  const barColor = status === "failed" ? "#b42318" : status === "cancelled" ? "#946200" : "#0d7c66";
  const overlay = (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
      <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
        <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>{title}</strong>
        <div style={{ marginBottom: "10px", color: "#41554a" }}>{job.message}</div>
        <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
          <div style={{ height: "100%", width: `${terminal ? 100 : progress}%`, background: indeterminate ? "linear-gradient(90deg, #0d7c66, #62b8a4)" : barColor }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
          <span>{terminal ? (status === "complete" ? "Refresh complete" : status === "failed" ? "Refresh failed" : "Refresh cancelled") : indeterminate ? "Loading in progress" : `${progress}% complete`}</span>
          <span>{terminal ? (status === "complete" ? "Done" : "Review the message above") : indeterminate ? "Preparing results…" : (typeof job.estimatedSecondsRemaining === "number" ? `~${job.estimatedSecondsRemaining}s remaining` : "Estimating time…")}</span>
        </div>
        {terminal && status !== "complete" && onDismiss ? (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
            <button type="button" onClick={onDismiss}>Close</button>
          </div>
        ) : null}
      </div>
    </div>
  );
  return typeof document === "undefined" ? overlay : createPortal(overlay, document.body);
}
