import { createFilterGroup } from "./report-engine.js";
import { getAllowedAggregations, getChartSpec, normalizeChartAggregation } from "./chart-spec.js";
import type {
  FilterGroupDefinition,
  ReportDefinition,
  SourceJoin,
  StudioObjectScope,
  SummaryMetric,
  TableDefinition
} from "./models.js";

export type StudioBuilderObjectType = "report" | "dashboard";
export type StudioBuilderStep = "basics" | "data" | "filters" | "view" | "layout" | "review";

export interface StudioBuilderDraft {
  type: StudioBuilderObjectType;
  name: string;
  description: string;
  scope: StudioObjectScope;
  ownerUserId: string;
  sharedUserIds: string[];
  tableId: string;
  sourceJoins: SourceJoin[];
  sourceReportOverrides: Record<string, string>;
  selectedFieldIds: string[];
  filterTree: FilterGroupDefinition;
  sorts: ReportDefinition["sorts"];
  summaryMetrics: SummaryMetric[];
  view: ReportDefinition["view"];
  displayLabels: ReportDefinition["displayLabels"];
}

export const STUDIO_DEFAULT_CHART_COLORS = ["#0d7c66", "#d88d3d", "#5b7cfa", "#9b59b6", "#e66f5c", "#3a9782", "#b7a26a", "#4f8fba"];
export const STUDIO_BUILDER_REPORT_STEPS: StudioBuilderStep[] = ["basics", "data", "filters", "view", "review"];
export const STUDIO_BUILDER_DASHBOARD_STEPS: StudioBuilderStep[] = ["basics", "layout", "review"];

export function studioBuilderNeedsSelectedFields(view: Pick<ReportDefinition, "view">["view"]) {
  return view.mode === "table"
    || view.mode === "timeline"
    || view.mode === "calendar"
    || view.mode === "kanban"
    || Boolean(view.showSummary)
    || Boolean(view.showDetails);
}

export function normalizeStudioBuilderScopeOwner(
  scope: StudioObjectScope,
  currentUserId: string,
  ownerUserId = "",
  sharedUserIds: string[] = []
) {
  if (scope === "personal") {
    return {
      scope,
      ownerUserId: String(currentUserId || ownerUserId || "").trim(),
      sharedUserIds: []
    };
  }
  if (scope === "selected") {
    return {
      scope,
      ownerUserId: "",
      sharedUserIds: Array.from(new Set((sharedUserIds || []).map((value) => String(value || "").trim()).filter(Boolean)))
    };
  }
  return {
    scope: "global" as const,
    ownerUserId: "",
    sharedUserIds: []
  };
}

export function buildStudioBuilderDraft(
  table?: TableDefinition | null,
  type: StudioBuilderObjectType = "report",
  currentUserId = "",
  createId: (prefix: string) => string = (prefix) => `${prefix}-1`
): StudioBuilderDraft {
  return {
    type,
    name: type === "report" ? "New Report" : "New Dashboard",
    description: "",
    ...normalizeStudioBuilderScopeOwner("global", currentUserId),
    tableId: table?.id || "",
    sourceJoins: [],
    sourceReportOverrides: {},
    selectedFieldIds: [],
    filterTree: createFilterGroup("and", []),
    sorts: [],
    summaryMetrics: [],
    view: {
      mode: "table",
      showChartInTable: false,
      showSummary: false,
      showDetails: false,
      chartTitle: "",
      decimalPlaces: 2,
      chartType: "bar",
      chartOrientation: "vertical",
      chartFieldId: "",
      chartSeriesFieldId: "",
      chartValueFieldId: "",
      chartAggregation: "count",
      chartSecondaryValueFieldId: "",
      chartSecondaryAggregation: "sum",
      chartUseSecondaryAxis: false,
      chartSecondarySeriesType: "line",
      chartTopN: 12,
      chartSort: "value-desc",
      chartColors: [...STUDIO_DEFAULT_CHART_COLORS],
      chartValueColors: {},
      chartShowLegend: true,
      chartShowValues: true,
      chartXAxisLabel: "",
      chartYAxisLabel: "",
      chartSecondaryYAxisLabel: "",
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: ""
    },
    displayLabels: {
      fields: {},
      chartValues: {}
    }
  };
}

function studioBuilderReportShowsChart(report: Pick<ReportDefinition, "view">) {
  return report.view.mode === "chart" || (report.view.mode === "table" && report.view.showChartInTable);
}

function studioBuilderReportShowsDetails(report: Pick<ReportDefinition, "view">) {
  if (typeof report.view.showDetails === "boolean") return report.view.showDetails;
  return report.view.mode === "table" || report.view.mode === "timeline" || report.view.mode === "calendar" || report.view.mode === "kanban";
}

export function getStudioBuilderSteps(type: StudioBuilderObjectType): StudioBuilderStep[] {
  return type === "report" ? STUDIO_BUILDER_REPORT_STEPS : STUDIO_BUILDER_DASHBOARD_STEPS;
}

export function getStudioBuilderStepLabel(step: StudioBuilderStep) {
  if (step === "basics") return "Basics";
  if (step === "data") return "Data";
  if (step === "filters") return "Filters";
  if (step === "view") return "View";
  if (step === "layout") return "Layout";
  return "Review";
}

export function getStudioBuilderStepDescription(step: StudioBuilderStep, type: StudioBuilderObjectType) {
  if (step === "basics") return "Set the object type, name, description, and sharing scope first.";
  if (step === "data") return "Pick the source table, fields, and client-facing labels.";
  if (step === "filters") return "Define filters and sort order without mixing them into layout settings.";
  if (step === "view") return "Choose the report mode and only the options relevant to that mode.";
  if (step === "layout") return type === "dashboard"
    ? "Start with a clean dashboard shell, then add tabs and cards from the canvas after saving."
    : "Choose the initial dashboard layout.";
  return "Review the object before creating it so missing requirements are visible before save.";
}

export function getStudioBuilderDraftIssues(
  draft: StudioBuilderDraft,
  table: TableDefinition | null | undefined,
  currentUserId = ""
) {
  const issues: string[] = [];
  if (!draft.name.trim()) {
    issues.push("Enter a name.");
  }
  if (draft.scope === "personal" && !String(draft.ownerUserId || currentUserId || "").trim()) {
    issues.push("Personal objects need an active user.");
  }
  if (draft.scope === "selected" && !(draft.sharedUserIds || []).length) {
    issues.push("Choose at least one user for selected-user sharing.");
  }
  if (draft.type !== "report") {
    return issues;
  }
  if (!table) {
    issues.push("Pick a source table.");
    return issues;
  }
  if (!draft.selectedFieldIds.length && studioBuilderNeedsSelectedFields(draft.view)) {
    issues.push("Select at least one detail field or turn off detail rows.");
  }
  if (studioBuilderReportShowsChart({ view: draft.view })) {
    if (!draft.view.chartFieldId) {
      issues.push(`Choose a ${getChartSpec(draft.view.chartType).primaryFieldLabel.toLowerCase()} for the chart.`);
    }
    const aggregation = normalizeChartAggregation(draft.view.chartAggregation);
    if (!getAllowedAggregations(draft.view.chartType).includes(aggregation)) {
      issues.push("The selected chart aggregation is not allowed for this chart type.");
    }
    if (getChartSpec(draft.view.chartType).requiresSeries && !draft.view.chartSeriesFieldId) {
      issues.push(`Choose a ${getChartSpec(draft.view.chartType).seriesFieldLabel?.toLowerCase() || "series field"} for this chart type.`);
    }
    if (aggregation !== "count" && !draft.view.chartValueFieldId) {
      issues.push(`Choose a ${getChartSpec(draft.view.chartType).valueFieldLabel.toLowerCase()} for the selected chart aggregation.`);
    }
  }
  if (draft.view.mode === "kanban" && !draft.view.kanbanField) {
    issues.push("Choose a kanban field.");
  }
  if (draft.view.mode === "timeline" && !draft.view.timelineDateField) {
    issues.push("Choose a timeline start field.");
  }
  if (draft.view.mode === "calendar" && !draft.view.calendarDateField) {
    issues.push("Choose a calendar date field.");
  }
  return issues;
}

export function getStudioBuilderStepIssues(
  step: StudioBuilderStep,
  draft: StudioBuilderDraft,
  table: TableDefinition | null | undefined,
  currentUserId = ""
) {
  if (step === "review") return getStudioBuilderDraftIssues(draft, table, currentUserId);
  if (step === "basics") {
    const issues: string[] = [];
    if (!draft.name.trim()) issues.push("Enter a name before continuing.");
    if (draft.scope === "personal" && !String(draft.ownerUserId || currentUserId || "").trim()) {
      issues.push("Personal objects need an active user.");
    }
    if (draft.scope === "selected" && !(draft.sharedUserIds || []).length) {
      issues.push("Choose at least one user for selected-user sharing.");
    }
    return issues;
  }
  if (draft.type !== "report") {
    return [];
  }
  if (step === "data") {
    const issues: string[] = [];
    if (!table) issues.push("Pick a source table.");
    if (table && !draft.selectedFieldIds.length && studioBuilderNeedsSelectedFields(draft.view)) {
      issues.push("Select at least one detail field or turn off detail rows.");
    }
    return issues;
  }
  if (step === "view") {
    return getStudioBuilderDraftIssues(draft, table, currentUserId).filter((issue) =>
      issue.includes("chart")
      || issue.includes("kanban")
      || issue.includes("timeline")
      || issue.includes("calendar")
    );
  }
  return [];
}
