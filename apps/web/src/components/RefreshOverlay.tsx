export function RefreshOverlay({
  title,
  job
}: {
  title: string;
  job: { progress?: number; message?: string; estimatedSecondsRemaining?: number } | null;
}) {
  if (!job) return null;
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
      <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
        <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>{title}</strong>
        <div style={{ marginBottom: "10px", color: "#41554a" }}>{job.message}</div>
        <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
          <div style={{ height: "100%", width: `${job.progress || 0}%`, background: "#0d7c66" }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
          <span>{job.progress || 0}% complete</span>
          <span>{typeof job.estimatedSecondsRemaining === "number" ? `~${job.estimatedSecondsRemaining}s remaining` : "Estimating time…"}</span>
        </div>
      </div>
    </div>
  );
}
