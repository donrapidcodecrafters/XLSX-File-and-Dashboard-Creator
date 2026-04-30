import { buildStudioDocument, type DashboardDefinition, type ReportDefinition } from "@studio/shared";
import { describe, expect, it } from "vitest";
import { buildDashboardExportDefinition } from "./dashboardExport";

describe("buildDashboardExportDefinition", () => {
  it("preserves copied widget snapshots instead of replacing them from reportDefinitions", () => {
    const document = buildStudioDocument();
    const dashboard = structuredClone(document.bundle.objects["dashboard-executive-pulse"] as DashboardDefinition);
    const linkedReport = document.bundle.objects["report-project-portfolio"] as ReportDefinition;
    const copiedSnapshot = {
      ...linkedReport,
      id: "snapshot-report",
      name: "Snapshot Report",
      view: {
        ...linkedReport.view,
        chartType: "line" as const
      }
    };
    dashboard.tabs[0]!.widgets[0] = {
      ...dashboard.tabs[0]!.widgets[0]!,
      mode: "copied",
      reportId: linkedReport.id,
      snapshot: copiedSnapshot
    };

    const exported = buildDashboardExportDefinition(dashboard, {
      [linkedReport.id]: {
        ...linkedReport,
        name: "Linked Report Replacement",
        view: {
          ...linkedReport.view,
          chartType: "pie" as const
        }
      }
    });

    const widget = exported.tabs[0]!.widgets[0]!;
    expect(widget.mode).toBe("copied");
    expect(widget.snapshot?.name).toBe("Snapshot Report");
    expect(widget.snapshot?.view.chartType).toBe("line");
  });
});
