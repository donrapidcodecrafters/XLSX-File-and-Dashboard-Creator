import type { DashboardDefinition, ReportDefinition } from "@studio/shared";

export function buildDashboardExportDefinition(
  dashboard: DashboardDefinition,
  reportDefinitions?: Record<string, ReportDefinition>
) {
  if (!reportDefinitions) return dashboard;
  let changed = false;
  const tabs = dashboard.tabs.map((tab) => ({
    ...tab,
    widgets: tab.widgets.map((widget) => {
      const report = reportDefinitions[widget.reportId];
      if (!report) return widget;
      changed = true;
      return {
        ...widget,
        mode: "copied" as const,
        snapshot: report
      };
    })
  }));
  return changed ? { ...dashboard, tabs } : dashboard;
}
