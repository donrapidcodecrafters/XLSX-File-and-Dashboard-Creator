import type { StudioDocument } from "@studio/shared";
import { ScheduledEmailsPanel } from "./ScheduledEmailsPanel";

export function ScheduledReportsPage({ studioDocument }: { studioDocument: StudioDocument | null }) {
  return (
    <section className="surface stack" style={{ padding: "24px 28px" }}>
      <div className="hero" style={{ marginBottom: 8 }}>
        <div>
          <span className="badge brand">Automation</span>
          <h1>Scheduled Reports</h1>
          <p>Configure automated email delivery of reports and dashboards to your team.</p>
        </div>
      </div>

      {!studioDocument ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-soft)" }}>
          <div style={{ fontSize: "2rem", marginBottom: 12 }}>⏳</div>
          <p>Loading platform data…</p>
        </div>
      ) : (
        <ScheduledEmailsPanel documentState={studioDocument} />
      )}
    </section>
  );
}
