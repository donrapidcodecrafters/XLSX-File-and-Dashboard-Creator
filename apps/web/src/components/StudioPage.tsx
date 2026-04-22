import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  applyDashboardRowPreset as applyDashboardRowPresetInDefinition,
  buildStudioBuilderDraft,
  balanceDashboardLayout as balanceDashboardLayoutInDefinition,
  balanceDashboardRow as balanceDashboardRowInDefinition,
  balanceDashboardTabLayout as balanceDashboardTabLayoutInDefinition,
  filterStudioLibraryItems,
  buildDashboardFilters,
  buildDashboardResult,
  buildStudioDocument,
  clampDashboardWidgetHeight,
  clampDashboardWidgetWidth,
  copyDashboardWidgetToTab as copyDashboardWidgetToTabInDefinition,
  collectFilterFieldIds,
  createFilterGroup,
  createFilterRule,
  duplicateDashboardWidget as duplicateDashboardWidgetInDefinition,
  filterNeedsValue,
  filterHasValue,
  getDashboardWidgetRows as getDashboardWidgetRowsInStudio,
  getStudioBuilderDraftIssues,
  getStudioBuilderStepDescription,
  getStudioBuilderStepIssues,
  getStudioBuilderStepLabel,
  getStudioBuilderSteps,
  isStudioItemVisibleToCurrentUser,
  insertDashboardWidget,
  placeDashboardWidgetAtPosition as placeDashboardWidgetAtPositionInDefinition,
  moveDashboardWidgetByRow as moveDashboardWidgetByRowInDefinition,
  moveDashboardWidgetByDirection as moveDashboardWidgetByDirectionInDefinition,
  moveDashboardWidgetToTab as moveDashboardWidgetToTabInDefinition,
  moveDashboardWidgetToEdge as moveDashboardWidgetToEdgeInDefinition,
  normalizeStudioBuilderScopeOwner,
  normalizeStudioDocument,
  removeDashboardWidget as removeDashboardWidgetInDefinition,
  reorderDashboardWidgetByDropPosition as reorderDashboardWidgetByDropPositionInDefinition,
  reorderDashboardWidgetToRowEdge as reorderDashboardWidgetToRowEdgeInDefinition,
  reorderDashboardWidgetToIndex as reorderDashboardWidgetToIndexInDefinition,
  resolveActiveDashboardTabId,
  resolveSelectedDashboardWidgetId,
  runReport,
  applyDashboardWidgetLayout,
  toggleDashboardWidgetFullWidth as toggleDashboardWidgetFullWidthInDefinition,
  type DashboardDefinition,
  type DashboardRowLayoutPreset,
  type DashboardRunResult,
  type DashboardWidgetDropPosition,
  type DashboardWidgetRowEdge,
  type DashboardWidgetMoveDirection,
  type ExportJobStatus,
  type FieldType,
  type FilterDefinition,
  type FilterGroupDefinition,
  type FilterNodeDefinition,
  type FilterOperator,
  type QuickbaseAppProfile,
  type QuickbaseConnectionConfig,
  type ReportDefinition,
  type ReportRunResult,
  type RefreshJobStatus,
  type SeedBundle,
  type StudioBuilderDraft,
  type StudioBuilderStep,
  type StudioDocument,
  type StudioExportJob,
  type StudioObject,
  type StudioObjectScope,
  type StudioTemplateRecord,
  type StudioTemplateType,
  type StudioVersionRecord,
  type SummaryMetric,
  type TableDefinition
} from "@studio/shared";
import {
  createStudioSnapshot,
  fetchQuickbaseApps,
  fetchQuickbaseReportPreview,
  fetchQuickbaseSchema,
  fetchStudioDocument,
  importStudioWorkbook,
  type QuickbaseRealmApp,
  type QuickbaseAppSchema,
  type QuickbaseSyncResult,
  type StudioWorkbookImportResult,
  fetchStudioRefreshJob,
  fetchStudioVersions,
  restoreStudioVersion,
  startStudioRefresh,
  saveStudioDocument
} from "../lib/studioApi";
import { downloadExportJob, fetchExportJobStatus, fetchExportJobs, startDashboardExportJob, startReportExportJob } from "../lib/api";
import { applyLaunchScopeToDocument } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { StudioDraftReviewStep } from "./StudioDraftReviewStep";
import { StudioDashboardPreview } from "./StudioDashboardPreview";
import { StudioReportDraftDataStep } from "./StudioReportDraftDataStep";
import { StudioReportDraftViewStep } from "./StudioReportDraftViewStep";
import { StudioReportPreview } from "./StudioReportPreview";
import { SearchableSelect } from "./SearchableSelect";
import { StudioSettingsPanel } from "./StudioSettingsPanel";
import { StudioWorkspaceEmptyState } from "./StudioWorkspaceEmptyState";
import { StudioWorkspaceHome } from "./StudioWorkspaceHome";
import {
  DEFAULT_CHART_COLORS,
  getChartAxisLabels,
  getSortedDashboardFieldOptions,
  getSortedFieldOptions,
  reportShowsChart,
  reportShowsDetails,
  reportShowsSummary
} from "./studioReportUtils";

const STORAGE_KEY = "hosted-reporting-studio-v2";
const WIDGET_LAYOUT_PRESETS = [
  { id: "quarter", label: "Quarter", w: 3, h: 3 },
  { id: "third", label: "Third", w: 4, h: 3 },
  { id: "half", label: "Half", w: 6, h: 4 },
  { id: "wide", label: "Wide", w: 8, h: 4 },
  { id: "full", label: "Full", w: 12, h: 4 },
  { id: "tall", label: "Tall", w: 6, h: 6 }
] as const;
const FILTER_OPERATOR_OPTIONS: Array<{ value: FilterOperator; label: string }> = [
  { value: "equals", label: "Equals" },
  { value: "not-equals", label: "Not equals" },
  { value: "contains", label: "Contains" },
  { value: "not-contains", label: "Does not contain" },
  { value: "blank", label: "Is blank" },
  { value: "not-blank", label: "Is not blank" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater than or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less than or equal" }
];
const DATE_FILTER_OPERATOR_OPTIONS: Array<{ value: FilterOperator; label: string }> = [
  { value: "on", label: "On" },
  { value: "not-equals", label: "Not on" },
  { value: "gt", label: "After" },
  { value: "on-or-after", label: "On or after" },
  { value: "lt", label: "Before" },
  { value: "on-or-before", label: "On or before" },
  { value: "blank", label: "Is blank" },
  { value: "not-blank", label: "Is not blank" }
];
const WEEKDAY_OPTIONS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" }
];
const FALLBACK_TIMEZONE_OPTIONS = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
  "UTC"
];
const TIMEZONE_OPTIONS = (() => {
  const intlWithSupported = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  if (typeof intlWithSupported.supportedValuesOf === "function") {
    try {
      return intlWithSupported.supportedValuesOf("timeZone");
    } catch {
      return FALLBACK_TIMEZONE_OPTIONS;
    }
  }
  return FALLBACK_TIMEZONE_OPTIONS;
})();

type DrawerKind = null | "settings" | "share" | "templates" | "export" | "versions";
type LibraryFilter = "all" | "report" | "dashboard";
type LibraryScopeFilter = "all" | "global" | "personal";
type ToastTone = "ok" | "warn" | "danger";
type CreateModalType = "report" | "dashboard";

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

type CreateStep = StudioBuilderStep;
type CreateObjectDraft = StudioBuilderDraft;

function buildDraftFromReport(report: ReportDefinition, table?: TableDefinition | null): CreateObjectDraft {
  const sourceTableId = table?.id || report.sourceTableId || "";
  return {
    type: "report",
    name: report.name,
    description: report.description,
    scope: report.scope,
    ownerUserId: report.ownerUserId || "",
    tableId: sourceTableId,
    sourceReportOverrides: clone(report.sourceReportOverrides || {}),
    selectedFieldIds: clone(report.selectedFieldIds || []),
    filterTree: clone(report.filterTree || createFilterGroup("and", clone(report.filters || []))),
    sorts: clone(report.sorts || []),
    summaryMetrics: clone(report.summaryMetrics || []),
    view: clone(report.view),
    displayLabels: clone(report.displayLabels || { fields: {}, chartValues: {} })
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function buildQuickbaseProfileId(appId: string) {
  const safe = String(appId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe ? `app-${safe}` : uid("app");
}

function createQuickbaseProfile(overrides: Partial<QuickbaseAppProfile> = {}): QuickbaseAppProfile {
  const seed = buildStudioDocument();
  const firstProfile = seed.quickbaseProfiles[0];
  return {
    ...firstProfile,
    ...overrides,
    id: overrides.id || uid("app"),
    label: overrides.label || "Quickbase app",
    liveMode: overrides.liveMode === true,
    quickbase: {
      ...firstProfile.quickbase,
      ...(overrides.quickbase || {})
    },
    refreshSchedule: {
      ...firstProfile.refreshSchedule,
      ...(overrides.refreshSchedule || {})
    },
    refreshStatus: {
      ...firstProfile.refreshStatus,
      ...(overrides.refreshStatus || {})
    }
  };
}

function getActiveQuickbaseProfile(document: StudioDocument) {
  return document.quickbaseProfiles.find((profile) => profile.id === document.activeQuickbaseProfileId) || document.quickbaseProfiles[0] || null;
}

function typeLabel(type: StudioObject["type"]) {
  return type === "report" ? "Report" : "Dashboard";
}

function buildEmptyLocalDocument() {
  const seed = buildStudioDocument();
  return normalizeStudioDocument({
    ...seed,
    bundle: {
      ...seed.bundle,
      objects: {},
      order: [],
      data: {}
    },
    favorites: [],
    recent: []
  });
}

function loadLocalDocument() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeStudioDocument(JSON.parse(raw) as StudioDocument) : buildEmptyLocalDocument();
  } catch {
    return buildEmptyLocalDocument();
  }
}

function saveLocalDocument(document: StudioDocument) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

function isFilterGroupNode(node: FilterNodeDefinition): node is FilterGroupDefinition {
  return "type" in node && node.type === "group";
}

function flattenFilterTree(group: FilterGroupDefinition): FilterDefinition[] {
  return group.conditions.flatMap((condition) => isFilterGroupNode(condition) ? flattenFilterTree(condition) : [condition]);
}

function updateFilterGroupNode(
  group: FilterGroupDefinition,
  nodeId: string,
  updater: (node: FilterNodeDefinition, parent: FilterGroupDefinition) => FilterNodeDefinition | null
): FilterGroupDefinition {
  if (group.id === nodeId) {
    const updated = updater(group, group);
    return (updated && isFilterGroupNode(updated) ? updated : group);
  }
  return {
    ...group,
    conditions: group.conditions.flatMap((condition) => {
      if (condition.id === nodeId) {
        const updated = updater(condition, group);
        return updated ? [updated] : [];
      }
      if ("type" in condition && condition.type === "group") {
        return [updateFilterGroupNode(condition, nodeId, updater)];
      }
      return [condition];
    })
  };
}

function addFilterRuleToGroup(group: FilterGroupDefinition, groupId: string, fieldId: string) {
  return updateFilterGroupNode(group, groupId, (node) => {
    if (!("type" in node) || node.type !== "group") return node;
    return {
      ...node,
      conditions: [...node.conditions, createFilterRule(fieldId, "equals", "")]
    };
  });
}

function addFilterGroupToGroup(group: FilterGroupDefinition, groupId: string) {
  return updateFilterGroupNode(group, groupId, (node) => {
    if (!("type" in node) || node.type !== "group") return node;
    return {
      ...node,
      conditions: [...node.conditions, createFilterGroup("and", [])]
    };
  });
}

function updateFilterRuleInGroup(group: FilterGroupDefinition, ruleId: string, updater: (rule: FilterDefinition) => FilterDefinition) {
  return updateFilterGroupNode(group, ruleId, (node) => {
    if (isFilterGroupNode(node)) return node;
    return updater(node);
  });
}

function removeFilterNodeFromGroup(group: FilterGroupDefinition, nodeId: string) {
  return updateFilterGroupNode(group, nodeId, () => null);
}

function mapQuickbaseFieldType(fieldType: string, baseType: string): FieldType {
  const normalized = `${fieldType || ""} ${baseType || ""}`.toLowerCase();
  if (normalized.includes("currency")) return "currency";
  if (normalized.includes("date") && normalized.includes("time")) return "datetime";
  if (normalized.includes("datetime") || normalized.includes("timestamp")) return "datetime";
  if (normalized.includes("date")) return "date";
  if (normalized.includes("user")) return "user";
  if (normalized.includes("multi")) return "multiselect";
  if (
    normalized.includes("numeric") ||
    normalized.includes("number") ||
    normalized.includes("percent") ||
    normalized.includes("rating") ||
    normalized.includes("duration") ||
    normalized.includes("record id")
  ) {
    return "number";
  }
  return "text";
}

function collectReportImportReferencedFieldIds(report: ReportDefinition) {
  const referenced = [
    ...report.selectedFieldIds,
    report.view.titleFieldId,
    report.view.chartFieldId,
    report.view.chartSeriesFieldId,
    report.view.chartValueFieldId,
    report.view.chartSecondaryValueFieldId,
    report.view.timelineDateField,
    report.view.timelineEndField,
    report.view.calendarDateField,
    report.view.kanbanField
  ].filter(Boolean);
  return Array.from(new Set(referenced));
}

function collectReportImportIssues(report: ReportDefinition, table: TableDefinition | null | undefined) {
  if (!table) {
    return ["The imported source fields are unavailable because the source table is missing."];
  }
  const fieldIds = new Set(table.fields.map((field) => field.id));
  const issues: string[] = [];
  const missingSelectedFields = report.selectedFieldIds.filter((fieldId) => !fieldIds.has(fieldId));
  if (missingSelectedFields.length) {
    issues.push(`${missingSelectedFields.length} selected field${missingSelectedFields.length === 1 ? "" : "s"} could not be matched.`);
  }
  if (reportShowsChart(report)) {
    if (report.view.chartFieldId && !fieldIds.has(report.view.chartFieldId)) {
      issues.push("The chart X axis field could not be matched.");
    }
    if (report.view.chartValueFieldId && !fieldIds.has(report.view.chartValueFieldId)) {
      issues.push("The chart value field could not be matched.");
    }
    if (report.view.chartSeriesFieldId && !fieldIds.has(report.view.chartSeriesFieldId)) {
      issues.push("The chart series field could not be matched.");
    }
    if (report.view.chartSecondaryValueFieldId && !fieldIds.has(report.view.chartSecondaryValueFieldId)) {
      issues.push("The chart secondary value field could not be matched.");
    }
  }
  if (report.view.mode === "timeline") {
    if (report.view.timelineDateField && !fieldIds.has(report.view.timelineDateField)) {
      issues.push("The timeline start field could not be matched.");
    }
    if (report.view.timelineEndField && !fieldIds.has(report.view.timelineEndField)) {
      issues.push("The timeline end field could not be matched.");
    }
  }
  if (report.view.mode === "calendar" && report.view.calendarDateField && !fieldIds.has(report.view.calendarDateField)) {
    issues.push("The calendar date field could not be matched.");
  }
  if (report.view.mode === "kanban" && report.view.kanbanField && !fieldIds.has(report.view.kanbanField)) {
    issues.push("The kanban grouping field could not be matched.");
  }
  return issues;
}

function convertQuickbaseSchemaToTables(schema: QuickbaseAppSchema, profile: QuickbaseAppProfile): TableDefinition[] {
  return schema.tables.map((table) => ({
    id: `${profile.id}:${table.id}`,
    name: profile.label ? `${profile.label} · ${table.name}` : table.name,
    description: table.description || "Quickbase table",
    quickbaseProfileId: profile.id,
    quickbaseTableId: table.id,
    quickbaseAppId: profile.quickbase.appId,
    fields: table.fields.map((field) => ({
      id: field.fid,
      label: field.label,
      type: mapQuickbaseFieldType(field.fieldType, field.baseType)
    }))
  }));
}

function getQuickbaseConfigForTable(document: StudioDocument, table?: TableDefinition | null): QuickbaseConnectionConfig {
  if (!table?.quickbaseProfileId) return document.quickbase;
  return document.quickbaseProfiles.find((profile) => profile.id === table.quickbaseProfileId)?.quickbase || document.quickbase;
}

function normalizeQuickbaseLabel(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findQuickbaseTableByNames(tables: QuickbaseAppSchema["tables"], names: string[]) {
  const wanted = names.map(normalizeQuickbaseLabel);
  return tables.find((table) => wanted.includes(normalizeQuickbaseLabel(table.name))) || null;
}

function findQuickbaseFieldIdByLabels(fields: QuickbaseAppSchema["tables"][number]["fields"], labels: string[]) {
  const wanted = labels.map(normalizeQuickbaseLabel);
  const match = fields.find((field) => wanted.includes(normalizeQuickbaseLabel(field.label)));
  return match ? String(match.fid) : "";
}

function detectQuickbaseStorageConfig(schema: QuickbaseAppSchema) {
  const detected: Partial<StudioDocument["quickbase"]> = {};

  const objectTable = findQuickbaseTableByNames(schema.tables, [
    "Saved Reports",
    "Studio Items",
    "Reporting Studio Items",
    "Saved Studio Items",
    "Saved Reports and Dashboards"
  ]);
  if (objectTable) {
    detected.objectTableId = objectTable.id;
    detected.objectKeyFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Object ID", "Studio Item Key", "Studio Item ID", "Item Key", "Report ID"]);
    detected.objectTypeFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Type", "Object Type"]);
    detected.objectNameFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Name", "Object Name", "Report Name"]);
    detected.objectConfigFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["JSON Config", "Config JSON", "Json", "Configuration"]);
    detected.objectOwnerFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Owner", "Object Owner"]);
    detected.objectUpdatedAtFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Updated", "Updated At", "Modified", "Modified At"]);
    detected.objectUpdatedByFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Updated By", "Modified By"]);
  }

  const settingsTable = findQuickbaseTableByNames(schema.tables, [
    "User Report Settings",
    "User Settings",
    "Studio User Settings",
    "Report User Settings"
  ]);
  if (settingsTable) {
    detected.settingsTableId = settingsTable.id;
    detected.settingsUserFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["User", "User ID", "Email"]);
    detected.settingsObjectFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Object Record", "Studio Item Record"]);
    detected.settingsObjectKeyFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Object", "Object ID", "Studio Item Key", "Report ID"]);
    detected.settingsJsonFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Json", "JSON", "Settings JSON"]);
    detected.settingsUpdatedByFieldId = findQuickbaseFieldIdByLabels(settingsTable.fields, ["Updated By", "Modified By"]);
  }

  const versionTable = findQuickbaseTableByNames(schema.tables, [
    "Report Version History",
    "Version History",
    "Studio Version History",
    "Saved Report Version History"
  ]);
  if (versionTable) {
    detected.versionTableId = versionTable.id;
    detected.versionObjectFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Object Record", "Studio Item Record"]);
    detected.versionObjectKeyFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Object", "Object ID", "Studio Item Key", "Report ID", "Version"]);
    detected.versionSnapshotFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Json", "JSON", "Snapshot JSON"]);
    detected.versionChangedAtFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Changed At", "Updated At", "Updated", "Modified At"]);
    detected.versionChangedByFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Changed By", "Updated By", "Modified By"]);
    detected.versionUpdatedByFieldId = findQuickbaseFieldIdByLabels(versionTable.fields, ["Updated By", "Changed By", "Modified By"]);
  }

  return detected;
}

function collectReportFieldIds(report: ReportDefinition) {
  return Array.from(new Set(
    [
      ...(report.selectedFieldIds || []),
      ...collectFilterFieldIds(report.filterTree || createFilterGroup("and", report.filters || [])),
      ...(report.groups || []).map((item) => item.fieldId),
      ...(report.sorts || []).map((item) => item.fieldId),
      ...((report.summaryMetrics || []).map((item) => item.fieldId)),
      report.view.chartFieldId,
      report.view.chartSeriesFieldId,
      report.view.chartValueFieldId,
      report.view.chartSecondaryValueFieldId,
      report.view.timelineDateField,
      report.view.timelineEndField,
      report.view.calendarDateField,
      report.view.kanbanField,
      report.view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

function fieldSupportsDateOperators(field?: TableDefinition["fields"][number] | null) {
  return field?.type === "date" || field?.type === "datetime";
}

function fieldSupportsContains(field?: TableDefinition["fields"][number] | null) {
  return !field || ["text", "user", "multiselect"].includes(field.type);
}

function filterOperatorOptionsForField(field?: TableDefinition["fields"][number] | null) {
  if (fieldSupportsDateOperators(field)) {
    return DATE_FILTER_OPERATOR_OPTIONS;
  }
  if (field && (field.type === "number" || field.type === "currency")) {
    return FILTER_OPERATOR_OPTIONS.filter((option) => !["contains", "not-contains"].includes(option.value));
  }
  if (!fieldSupportsContains(field)) {
    return FILTER_OPERATOR_OPTIONS.filter((option) => !["contains", "not-contains"].includes(option.value));
  }
  return FILTER_OPERATOR_OPTIONS;
}

function createEmptyDashboardReportResult(reportId: string, tableId: string, warning: string): ReportRunResult {
  return {
    reportId,
    tableId,
    totalRows: 0,
    rows: [],
    summary: [],
    chartData: [],
    warnings: warning ? [warning] : [],
    page: 1,
    pageSize: 100,
    totalPages: 1,
    hasNextPage: false
  };
}

function createUnavailableDashboardReport(widget: DashboardDefinition["tabs"][number]["widgets"][number], message: string): ReportDefinition {
  return {
    id: widget.reportId || `${widget.id}-missing-report`,
    type: "report",
    schemaVersion: 1,
    name: widget.title || "Unavailable report",
    description: message,
    folder: "Unavailable",
    category: "Unavailable",
    tags: [],
    scope: "global",
    ownerUserId: "",
    updatedAt: new Date().toISOString(),
    sourceTableId: "",
    sourceReportOverrides: {},
    selectedFieldIds: [],
    filters: [],
    filterTree: createFilterGroup("and", []),
    groups: [],
    sorts: [],
    summaryMetrics: [],
    view: {
      mode: "table",
      showChartInTable: false,
      showSummary: false,
      showDetails: true,
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
      chartColors: DEFAULT_CHART_COLORS,
      chartShowLegend: false,
      chartShowValues: false,
      chartXAxisLabel: "",
      chartYAxisLabel: "",
      chartSecondaryYAxisLabel: "",
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: ""
    },
    displayLabels: { fields: {}, chartValues: {} }
  };
}

function looksLikeQuickbaseTableId(value: string) {
  return /^[a-z0-9]{8,}$/i.test(String(value || "").trim());
}

function looksLikeQuickbaseFieldId(value: string) {
  return /^\d+$/.test(String(value || "").trim());
}

function shouldAutoLoadQuickbaseSchema(document: StudioDocument) {
  const quickbase = getActiveQuickbaseProfile(document)?.quickbase || document.quickbase;
  if (!quickbase.realmHostname || !quickbase.userToken || !quickbase.appId) return false;
  const tables = (document.bundle.tables || []).filter((table) => !table.quickbaseProfileId || table.quickbaseProfileId === document.activeQuickbaseProfileId);
  if (!tables.length) return true;
  return tables.some((table) =>
    !looksLikeQuickbaseTableId(table.quickbaseTableId || table.id) ||
    (table.fields || []).some((field) => !looksLikeQuickbaseFieldId(field.id))
  );
}

function canUseLiveQuickbasePreview(report: ReportDefinition | null, table: TableDefinition | null) {
  if (!report || !table) return false;
  if (!looksLikeQuickbaseTableId(table.quickbaseTableId || table.id)) return false;
  const fieldIds = collectReportFieldIds(report);
  return fieldIds.every((fieldId) => looksLikeQuickbaseFieldId(fieldId));
}

function getTablesForQuickbaseProfile(document: StudioDocument, profileId: string) {
  return (document.bundle.tables || []).filter((table) => table.quickbaseProfileId === profileId);
}

function downloadFile(filename: string, contents: string, type = "application/json") {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function validationMessages(object: StudioObject, table?: TableDefinition | null) {
  const messages: string[] = [];
  if (object.type === "report") {
    if (!object.selectedFieldIds.length && object.view.showDetails) messages.push("Select at least one detail field or turn off detail rows.");
    if (reportShowsChart(object) && !object.view.chartFieldId) messages.push("Choose an X axis field for the chart.");
    if (reportShowsChart(object) && object.view.chartAggregation !== "count" && !object.view.chartValueFieldId) messages.push("Choose a Y axis value field for the chart.");
    if (reportShowsChart(object) && object.view.chartUseSecondaryAxis && object.view.chartSecondaryAggregation !== "count" && !object.view.chartSecondaryValueFieldId) messages.push("Choose a secondary Y axis field or turn off the secondary axis.");
    if (object.view.mode === "timeline" && !object.view.timelineDateField) messages.push("Choose a timeline start field.");
    if (object.view.mode === "calendar" && !object.view.calendarDateField) messages.push("Choose a calendar date field.");
    if (object.view.mode === "kanban" && !object.view.kanbanField) messages.push("Choose a kanban column field.");
    if (table && table.id !== object.sourceTableId) messages.push("Report source table is invalid.");
  } else {
    if (!object.tabs.length) messages.push("Add at least one dashboard tab.");
    if (!object.tabs.some((tab) => tab.widgets.length)) messages.push("Add at least one card.");
  }
  return messages;
}

function FilterGroupEditor({
  table,
  group,
  onChange,
  canRemove,
  onRemove
}: {
  table: TableDefinition;
  group: FilterGroupDefinition;
  onChange: (group: FilterGroupDefinition) => void;
  canRemove?: boolean;
  onRemove?: () => void;
}) {
  const fieldOptions = getSortedFieldOptions(table);
  return (
    <div className="filter-group-editor">
      <div className="card-head">
        <strong>{canRemove ? "Group" : "Filter group"}</strong>
        <div className="studio-actions">
          <label className="field compact-field">
            <span>Match</span>
            <select
              value={group.join}
              onChange={(event) => onChange({ ...group, join: event.target.value as "and" | "or" })}
            >
              <option value="and">All conditions (AND)</option>
              <option value="or">Any condition (OR)</option>
            </select>
          </label>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange(addFilterRuleToGroup(group, group.id, table.fields[0]?.id || ""));
            }}
          >
            Add filter
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange(addFilterGroupToGroup(group, group.id));
            }}
          >
            Add group
          </button>
          {canRemove && onRemove ? <button type="button" onClick={onRemove}>Remove group</button> : null}
        </div>
      </div>

      <div className="stack-compact">
        {group.conditions.length ? group.conditions.map((condition) => {
          if (isFilterGroupNode(condition)) {
            return (
              <div className="filter-group-branch" key={condition.id}>
                <FilterGroupEditor
                  table={table}
                  group={condition}
                  canRemove
                  onRemove={() => onChange(removeFilterNodeFromGroup(group, condition.id))}
                  onChange={(nextGroup) => onChange(updateFilterGroupNode(group, condition.id, () => nextGroup))}
                />
              </div>
            );
          }
          const rule = condition;
          const field = table.fields.find((candidate) => candidate.id === rule.fieldId) || table.fields[0] || null;
          const operatorOptions = filterOperatorOptionsForField(field);
          return (
            <div className="inline-edit-row filter-rule-row" key={rule.id}>
              <SearchableSelect
                value={rule.fieldId}
                options={fieldOptions}
                onChange={(value) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => {
                  const nextField = table.fields.find((candidate) => candidate.id === value) || null;
                  const nextOptions = filterOperatorOptionsForField(nextField);
                  const nextOperator = nextOptions.some((option) => option.value === currentRule.operator)
                    ? currentRule.operator
                    : nextOptions[0]?.value || "equals";
                  return {
                    ...currentRule,
                    fieldId: value,
                    operator: nextOperator,
                    value: filterNeedsValue(nextOperator) ? currentRule.value : ""
                  };
                }))}
              />
              <select
                value={rule.operator}
                onChange={(event) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, operator: event.target.value as FilterOperator, value: filterNeedsValue(event.target.value as FilterOperator) ? currentRule.value : "" })))}
              >
                {operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input
                type={field?.type === "date" ? "date" : field?.type === "datetime" ? "datetime-local" : field?.type === "number" || field?.type === "currency" ? "number" : "text"}
                value={rule.value}
                disabled={!filterNeedsValue(rule.operator)}
                onChange={(event) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, value: event.target.value })))}
                placeholder={filterNeedsValue(rule.operator) ? "Filter value" : "No value needed"}
              />
              <button type="button" onClick={() => onChange(removeFilterNodeFromGroup(group, rule.id))}>Remove</button>
            </div>
          );
        }) : <div className="empty-hint">No conditions yet. Add rules or nested groups.</div>}
      </div>
    </div>
  );
}

function ReportFiltersAndSortsEditor({
  table,
  filterTree,
  sorts,
  onChangeFilterTree,
  onChangeSorts
}: {
  table: TableDefinition;
  filterTree: FilterGroupDefinition;
  sorts: ReportDefinition["sorts"];
  onChangeFilterTree: (filterTree: FilterGroupDefinition) => void;
  onChangeSorts: (sorts: ReportDefinition["sorts"]) => void;
}) {
  return (
    <div className="stack">
      <div className="card">
        <FilterGroupEditor table={table} group={filterTree} onChange={onChangeFilterTree} />
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Sorting</strong>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChangeSorts([...sorts, { id: uid("sort"), fieldId: table.fields[0]?.id || "", direction: "asc" }]);
            }}
          >
            Add sort
          </button>
        </div>
        <div className="stack-compact">
          {sorts.length ? sorts.map((sort) => (
            <div className="inline-edit-row" key={sort.id}>
              <SearchableSelect value={sort.fieldId} options={getSortedFieldOptions(table)} onChange={(value) => onChangeSorts(sorts.map((item) => item.id === sort.id ? { ...item, fieldId: value } : item))} />
              <select value={sort.direction} onChange={(event) => onChangeSorts(sorts.map((item) => item.id === sort.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <div />
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onChangeSorts(sorts.filter((item) => item.id !== sort.id));
                }}
              >
                Remove
              </button>
            </div>
          )) : <div className="empty-hint">No sorting yet.</div>}
        </div>
      </div>
    </div>
  );
}

export function StudioPage({
  openSettingsSignal = 0,
  refreshAllSignal = 0,
  launchContext
}: {
  openSettingsSignal?: number;
  refreshAllSignal?: number;
  launchContext: { launchSource: "quickbase-button" | "local-dev" | null; userId: string; realmHostname: string; appId: string };
}) {
  const navigate = useNavigate();
  const params = useParams();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importXlsxInputRef = useRef<HTMLInputElement | null>(null);
  const schemaAutoloadedRef = useRef(false);
  const scopeDocument = (document: StudioDocument) => applyLaunchScopeToDocument(document, {
    launchSource: launchContext.launchSource,
    currentUserId: launchContext.userId,
    launchRealmHostname: launchContext.realmHostname,
    launchAppId: launchContext.appId
  }) || document;
  const [documentState, setDocumentState] = useState<StudioDocument>(() => scopeDocument(loadLocalDocument()));
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [savingRemote, setSavingRemote] = useState(false);
  const [history, setHistory] = useState<StudioDocument[]>([]);
  const [future, setFuture] = useState<StudioDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryScopeFilter, setLibraryScopeFilter] = useState<LibraryScopeFilter>("global");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [selectedHomeReportIds, setSelectedHomeReportIds] = useState<string[]>([]);
  const [dashboardInspectorTab, setDashboardInspectorTab] = useState<"design" | "filters">("design");
  const [activeTabId, setActiveTabId] = useState("");
  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [widgetTargetTabId, setWidgetTargetTabId] = useState("");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [createStep, setCreateStep] = useState<CreateStep>("basics");
  const [createPreviewPage, setCreatePreviewPage] = useState(1);
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [versionList, setVersionList] = useState<StudioVersionRecord[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [quickbaseSchema, setQuickbaseSchema] = useState<QuickbaseAppSchema | null>(null);
  const [quickbaseSchemaLoading, setQuickbaseSchemaLoading] = useState(false);
  const [realmApps, setRealmApps] = useState<QuickbaseRealmApp[]>([]);
  const [realmAppsLoading, setRealmAppsLoading] = useState(false);
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [refreshJob, setRefreshJob] = useState<RefreshJobStatus | null>(null);
  const [lastQuickbaseSync, setLastQuickbaseSync] = useState<QuickbaseSyncResult | null>(null);
  const [lastWorkbookImportReview, setLastWorkbookImportReview] = useState<StudioWorkbookImportResult["review"] | null>(null);
  const [lastWorkbookImportObjectIds, setLastWorkbookImportObjectIds] = useState<string[]>([]);
  const [importReviewModalOpen, setImportReviewModalOpen] = useState(false);
  const activeQuickbaseProfile = useMemo(() => getActiveQuickbaseProfile(documentState), [documentState]);
  const activeQuickbaseConfig = activeQuickbaseProfile?.quickbase || documentState.quickbase;
  const activeProfileTables = useMemo(
    () => activeQuickbaseProfile ? getTablesForQuickbaseProfile(documentState, activeQuickbaseProfile.id) : [],
    [documentState, activeQuickbaseProfile]
  );

  const savedRowsForApp = activeQuickbaseProfile?.refreshStatus.cachedRowCount || 0;
  const refreshStatusTitle = activeQuickbaseProfile?.refreshStatus.running
    ? "Refreshing saved data"
    : activeQuickbaseProfile?.refreshStatus.lastSuccessAt
      ? (savedRowsForApp > 0 ? "Saved data is ready" : "Refresh finished but nothing was saved")
      : "No saved data yet";
  const refreshStatusDetail = activeQuickbaseProfile?.refreshStatus.lastError
    || (activeQuickbaseProfile?.refreshStatus.running
      ? "We are updating the saved Quickbase data for this app now."
      : activeQuickbaseProfile?.refreshStatus.lastSuccessAt
        ? (savedRowsForApp > 0
          ? `This app has ${savedRowsForApp.toLocaleString()} rows saved for faster loading.`
          : "The refresh ran, but it did not save any rows. Check that each selected Quickbase source report returns every record and every field you need.")
        : "Run a refresh after you choose the source tables and enter a report ID for each one.");
  const [liveReportResult, setLiveReportResult] = useState<ReportRunResult | null>(null);
  const [liveReportLoading, setLiveReportLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [liveExportJobs, setLiveExportJobs] = useState<ExportJobStatus[]>([]);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateObjectDraft>(() => {
    const document = scopeDocument(loadLocalDocument());
    return buildStudioBuilderDraft(document.bundle.tables[0], "report", String(document.session.currentUserId || "").trim(), uid);
  });
  const [createFieldQuery, setCreateFieldQuery] = useState("");
  const [draggingWidget, setDraggingWidget] = useState<{ tabId: string; widgetId: string } | null>(null);
  const [xlsxImporting, setXlsxImporting] = useState(false);
  const [resizeSession, setResizeSession] = useState<{
    tabId: string;
    widgetId: string;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
    nextW: number;
    nextH: number;
  } | null>(null);
  const resizeStartSnapshotRef = useRef<StudioDocument | null>(null);

  const bundle = documentState.bundle;
  const currentUserId = String(documentState.session.currentUserId || "").trim();
  const objects = useMemo(() => bundle.order.map((id) => bundle.objects[id]).filter(Boolean), [bundle]);
  const importedReviewReports = useMemo(
    () => lastWorkbookImportObjectIds
      .map((id) => bundle.objects[id])
      .filter((object): object is ReportDefinition => Boolean(object) && object.type === "report")
      .map((report) => ({
        report,
        table: bundle.tables.find((table) => table.id === report.sourceTableId) || null
      })),
    [bundle.objects, bundle.tables, lastWorkbookImportObjectIds]
  );
  const importedReviewDashboardCount = useMemo(
    () => lastWorkbookImportObjectIds
      .map((id) => bundle.objects[id])
      .filter((object) => object?.type === "dashboard").length,
    [bundle.objects, lastWorkbookImportObjectIds]
  );
  const dashboardFieldOptions = useMemo(() => getSortedDashboardFieldOptions(bundle.tables), [bundle.tables]);
  const reportObjectOptions = useMemo(
    () => objects
      .filter((object): object is ReportDefinition => object.type === "report")
      .map((report) => ({
        value: report.id,
        label: report.name,
        keywords: [report.folder, report.category, ...(report.tags || [])]
      }))
      .sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" })),
    [objects]
  );
  const visibleObjects = useMemo(
    () => filterStudioLibraryItems(objects, { currentUserId }),
    [currentUserId, objects]
  );
  const activeObjectId = params.objectId && bundle.objects[params.objectId] && isStudioItemVisibleToCurrentUser(bundle.objects[params.objectId], currentUserId)
    ? params.objectId
    : "";
  const activeObject = activeObjectId ? bundle.objects[activeObjectId] || null : null;
  const hasActiveObject = Boolean(activeObject);
  const activeReport: ReportDefinition | null = activeObject?.type === "report" ? activeObject : null;
  const activeDashboard: DashboardDefinition | null = activeObject?.type === "dashboard" ? activeObject : null;
  const openLinksInNewTab = documentState.branding.openLinksInNewTab === true;
  const resolvedActiveDashboardTabId = resolveActiveDashboardTabId(activeDashboard, activeTabId);
  const activeDashboardTab = activeDashboard?.tabs.find((tab) => tab.id === resolvedActiveDashboardTabId) || null;
  const resolvedSelectedDashboardWidgetId = resolveSelectedDashboardWidgetId(activeDashboardTab, selectedWidgetId);
  const selectedDashboardWidget = activeDashboardTab?.widgets.find((widget) => widget.id === resolvedSelectedDashboardWidgetId) || null;
  const selectedDashboardWidgetReport = selectedDashboardWidget
    ? (selectedDashboardWidget.mode === "copied" && selectedDashboardWidget.snapshot
      ? selectedDashboardWidget.snapshot
      : (bundle.objects[selectedDashboardWidget.reportId] as ReportDefinition | undefined) || null)
    : null;
  const activeDashboardRows = useMemo(
    () => (activeDashboardTab ? getDashboardWidgetRowsInStudio(activeDashboardTab) : []),
    [activeDashboardTab]
  );
  const selectedDashboardRowIndex = useMemo(
    () => (selectedDashboardWidget ? activeDashboardRows.findIndex((row) => row.widgetIds.includes(selectedDashboardWidget.id)) : -1),
    [activeDashboardRows, selectedDashboardWidget]
  );
  const selectedDashboardRow = selectedDashboardRowIndex >= 0 ? activeDashboardRows[selectedDashboardRowIndex] || null : null;
  const activeTable = activeReport ? bundle.tables.find((table) => table.id === activeReport.sourceTableId) || null : null;
  const activeDashboardRefreshTables = useMemo(() => {
    if (!activeDashboard) return [] as TableDefinition[];
    const seen = new Set<string>();
    const tables: TableDefinition[] = [];
    activeDashboard.tabs.forEach((tab) => {
      tab.widgets.forEach((widget) => {
        const report = widget.mode === "copied" && widget.snapshot ? widget.snapshot : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
        if (!report) return;
        const table = bundle.tables.find((item) => item.id === report.sourceTableId);
        if (!table || seen.has(table.id)) return;
        seen.add(table.id);
        tables.push(table);
      });
    });
    return tables;
  }, [activeDashboard, bundle.objects, bundle.tables]);
  const createDraftTable = bundle.tables.find((table) => table.id === createDraft.tableId) || bundle.tables[0] || null;
  const createSteps = useMemo(() => getStudioBuilderSteps(createDraft.type), [createDraft.type]);
  const activeCreateStep = createSteps.includes(createStep) ? createStep : createSteps[0];
  const createDraftIssues = useMemo(
    () => getStudioBuilderDraftIssues(createDraft, createDraftTable, currentUserId),
    [createDraft, createDraftTable, currentUserId]
  );
  const createStepIssues = useMemo(
    () => getStudioBuilderStepIssues(activeCreateStep, createDraft, createDraftTable, currentUserId),
    [activeCreateStep, createDraft, createDraftTable, currentUserId]
  );
  const validation = activeObject ? validationMessages(activeObject, activeTable) : [];
  const visibleCreateFields = useMemo(() => {
    if (!createDraftTable) return [];
    const sortedFields = getSortedFieldOptions(createDraftTable).map((option) =>
      createDraftTable.fields.find((field) => field.id === option.value)
    ).filter((field): field is NonNullable<typeof createDraftTable.fields[number]> => Boolean(field));
    const query = createFieldQuery.trim().toLowerCase();
    if (!query) return sortedFields;
    return sortedFields.filter((field) => `${field.label} ${field.id} ${field.type}`.toLowerCase().includes(query));
  }, [createDraftTable, createFieldQuery]);
  const createDraftPreviewReport = useMemo<ReportDefinition | null>(() => {
    if (createDraft.type !== "report" || !createDraftTable) return null;
    const existingPreviewReport = editingReportId ? (bundle.objects[editingReportId] as ReportDefinition | undefined) : undefined;
    return {
      id: editingReportId || "draft-report-preview",
      type: "report",
      schemaVersion: existingPreviewReport?.schemaVersion || 1,
      name: createDraft.name || "Draft report",
      description: createDraft.description,
      folder: "Custom",
      category: "Reporting",
      tags: [],
      scope: createDraft.scope,
      ownerUserId: createDraft.ownerUserId,
      updatedAt: new Date().toISOString(),
      sourceTableId: createDraft.tableId,
      sourceReportOverrides: createDraft.sourceReportOverrides,
      selectedFieldIds: createDraft.selectedFieldIds,
      filters: flattenFilterTree(createDraft.filterTree),
      filterTree: clone(createDraft.filterTree),
      groups: [],
      sorts: createDraft.sorts,
      summaryMetrics: createDraft.summaryMetrics,
      view: createDraft.view,
      displayLabels: createDraft.displayLabels
    };
  }, [bundle.objects, createDraft, createDraftTable, editingReportId]);
  const createDraftPreview = useMemo(() => {
    if (!createDraftPreviewReport || !createDraftTable) return null;
    const needsDetailFields = createDraft.view.showDetails;
    const hasChartConfig = Boolean(createDraft.view.chartFieldId) && (createDraft.view.chartAggregation === "count" || Boolean(createDraft.view.chartValueFieldId));
    if (!createDraft.selectedFieldIds.length && needsDetailFields && !hasChartConfig) return null;
    return runReport(createDraftPreviewReport, createDraftTable, bundle.data[createDraftTable.id] || []);
  }, [bundle.data, createDraft.selectedFieldIds.length, createDraft.view.chartAggregation, createDraft.view.chartFieldId, createDraft.view.chartValueFieldId, createDraft.view.showDetails, createDraftPreviewReport, createDraftTable]);
  const createDraftFilterCount = useMemo(
    () => createDraft.type === "report" ? flattenFilterTree(createDraft.filterTree).length : 0,
    [createDraft]
  );
  const chartValueLabelOptions = useMemo(() => {
    const previewLabels = createDraftPreview?.chartData.map((item) => item.label) || [];
    const existingLabels = Object.keys(createDraft.displayLabels.chartValues || {});
    return Array.from(new Set([...previewLabels, ...existingLabels]));
  }, [createDraft.displayLabels.chartValues, createDraftPreview?.chartData]);
  const mergedExportJobs = useMemo(() => {
    const liveById = new Map(liveExportJobs.map((job) => [job.id, job]));
    const merged = documentState.exportJobs.map((job) => {
      const live = (job.sourceJobId && liveById.get(job.sourceJobId)) || liveById.get(job.id);
      if (!live) return job;
      return {
        ...job,
        objectType: live.objectType,
        status: live.status,
        progress: live.progress,
        message: live.message,
        filename: live.filename || job.filename,
        error: live.error,
        updatedAt: live.updatedAt,
        sourceJobId: live.id
      } satisfies StudioExportJob;
    });
    liveExportJobs.forEach((job) => {
      const exists = merged.some((item) => item.sourceJobId === job.id || item.id === job.id);
      if (exists) return;
      merged.unshift({
        id: `live-${job.id}`,
        objectId: job.objectId,
        objectType: job.objectType,
        format: job.format,
        status: job.status,
        progress: job.progress,
        message: job.message,
        filename: job.filename,
        error: job.error,
        updatedAt: job.updatedAt,
        sourceJobId: job.id,
        runtimeFilters: {},
        createdAt: job.createdAt
      });
    });
    return merged.sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime());
  }, [documentState.exportJobs, liveExportJobs]);

  function pushToast(message: string, tone: ToastTone = "ok") {
    const id = uid("toast");
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3500);
  }

  function upsertStudioExportJob(entry: StudioExportJob) {
    applyDocumentUpdate((draft) => {
      const currentIndex = draft.exportJobs.findIndex((job) =>
        (entry.sourceJobId && job.sourceJobId === entry.sourceJobId)
        || job.id === entry.id
      );
      if (currentIndex >= 0) {
        draft.exportJobs[currentIndex] = {
          ...draft.exportJobs[currentIndex],
          ...entry
        };
      } else {
        draft.exportJobs.unshift(entry);
      }
      draft.exportJobs = draft.exportJobs
        .sort((left, right) => new Date(right.updatedAt || right.createdAt).getTime() - new Date(left.updatedAt || left.createdAt).getTime())
        .slice(0, 30);
    }, { skipHistory: true });
  }

  async function refreshExportJobs() {
    try {
      const response = await fetchExportJobs();
      setLiveExportJobs(response.jobs);
      response.jobs.forEach((job) => {
        upsertStudioExportJob({
          id: `history-${job.id}`,
          objectId: job.objectId,
          objectType: job.objectType,
          format: job.format,
          status: job.status,
          progress: job.progress,
          message: job.message,
          filename: job.filename,
          error: job.error,
          updatedAt: job.updatedAt,
          sourceJobId: job.id,
          runtimeFilters: {},
          createdAt: job.createdAt
        });
      });
    } catch {
      setLiveExportJobs([]);
    }
  }

  async function startObjectExport(options?: { objectId?: string; runtimeFilters?: Record<string, string> }) {
    const objectId = options?.objectId || activeObject?.id || "";
    const object = objectId ? bundle.objects[objectId] : activeObject;
    if (!object) {
      pushToast("Open a report or dashboard before exporting.", "warn");
      return null;
    }
    if (object.type === "report") {
      const response = await startReportExportJob({ reportId: object.id });
      const jobEntry: StudioExportJob = {
        id: `history-${response.job.id}`,
        objectId: object.id,
        objectType: "report",
        format: "xlsx",
        status: response.job.status,
        progress: response.job.progress,
        message: response.job.message,
        filename: response.job.filename,
        error: response.job.error,
        updatedAt: response.job.updatedAt,
        sourceJobId: response.job.id,
        runtimeFilters: {},
        createdAt: response.job.createdAt
      };
      setExportJob(response.job);
      setDownloadedJobId("");
      upsertStudioExportJob(jobEntry);
      return response.job;
    }
    const runtimeFilters = options?.runtimeFilters || {};
    const response = await startDashboardExportJob({
      dashboardId: object.id,
      runtimeFilters
    });
    const jobEntry: StudioExportJob = {
      id: `history-${response.job.id}`,
      objectId: object.id,
      objectType: "dashboard",
      format: "xlsx",
      status: response.job.status,
      progress: response.job.progress,
      message: response.job.message,
      filename: response.job.filename,
      error: response.job.error,
      updatedAt: response.job.updatedAt,
      sourceJobId: response.job.id,
      runtimeFilters,
      createdAt: response.job.createdAt
    };
    setExportJob(response.job);
    setDownloadedJobId("");
    upsertStudioExportJob(jobEntry);
    return response.job;
  }

  async function retryExportJob(job: StudioExportJob) {
    if (job.format === "json") {
      exportJson();
      return;
    }
    const targetObject = bundle.objects[job.objectId];
    if (!targetObject || (targetObject.type !== "report" && targetObject.type !== "dashboard")) {
      pushToast("The saved object for this export is no longer available.", "warn");
      return;
    }
    await startObjectExport({
      objectId: targetObject.id,
      runtimeFilters: job.objectType === "dashboard" ? (job.runtimeFilters || {}) : {}
    });
    pushToast("Export restarted.");
  }

  function applyDocumentUpdate(updater: (draft: StudioDocument) => StudioDocument | void, options?: { skipHistory?: boolean }) {
    setDocumentState((current) => {
      const currentSnapshot = clone(current);
      const draft = clone(current);
      const maybeNext = updater(draft);
      const next = maybeNext || draft;
      if (!options?.skipHistory) {
        setHistory((previous) => [currentSnapshot, ...previous].slice(0, 60));
        setFuture([]);
      }
      return next;
    });
  }

  useEffect(() => {
    saveLocalDocument(documentState);
  }, [documentState]);

  useEffect(() => {
    setDocumentState((current) => scopeDocument(current));
  }, [launchContext.appId, launchContext.launchSource, launchContext.realmHostname, launchContext.userId]);

  useEffect(() => {
    let active = true;
    setLoadingRemote(true);
    fetchStudioDocument()
      .then((response) => {
        if (!active) return;
        const next = scopeDocument(normalizeStudioDocument(response.document));
        next.sync.lastLoadedAt = new Date().toISOString();
        setDocumentState(next);
      })
      .catch(() => {
        if (active) pushToast("Using local studio data because the hosted studio document could not be loaded.", "warn");
      })
      .finally(() => {
        if (active) setLoadingRemote(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (schemaAutoloadedRef.current) return;
    if (!shouldAutoLoadQuickbaseSchema(documentState)) return;
    schemaAutoloadedRef.current = true;
    loadQuickbaseMetadata(true).catch(() => {
      schemaAutoloadedRef.current = false;
    });
  }, [
    activeQuickbaseConfig.appId,
    activeQuickbaseConfig.realmHostname,
    activeQuickbaseConfig.userToken,
    documentState.bundle.tables
  ]);

  useEffect(() => {
    if (!activeObjectId) return;
    applyDocumentUpdate((draft) => {
      draft.recent = [activeObjectId, ...draft.recent.filter((item) => item !== activeObjectId)].slice(0, 10);
    }, { skipHistory: true });
  }, [activeObjectId]);

  useEffect(() => {
    if (!activeDashboard) return;
    setActiveTabId((current) => resolveActiveDashboardTabId(activeDashboard, current));
    setRuntimeValues(Object.fromEntries(activeDashboard.runtimeFilters.map((filter) => [filter.id, filter.defaultValue || ""])));
  }, [activeDashboard?.id, activeDashboard?.tabs, activeDashboard?.runtimeFilters]);

  useEffect(() => {
    const nextSelectedWidgetId = resolveSelectedDashboardWidgetId(activeDashboardTab, selectedWidgetId);
    if (nextSelectedWidgetId !== selectedWidgetId) {
      setSelectedWidgetId(nextSelectedWidgetId);
    }
  }, [activeDashboardTab, selectedWidgetId]);

  useEffect(() => {
    if (!activeDashboard?.tabs.length) {
      setWidgetTargetTabId("");
      return;
    }
    const candidateTabIds = activeDashboard.tabs.map((tab) => tab.id);
    if (widgetTargetTabId && candidateTabIds.includes(widgetTargetTabId)) return;
    const fallbackTarget = candidateTabIds.find((tabId) => tabId !== activeDashboardTab?.id) || candidateTabIds[0] || "";
    setWidgetTargetTabId(fallbackTarget);
  }, [activeDashboard?.id, activeDashboard?.tabs, activeDashboardTab?.id, widgetTargetTabId]);

  useEffect(() => {
    setPreviewPage(1);
  }, [activeReport?.id, activeReport?.updatedAt]);

  useEffect(() => {
    if (createSteps.includes(createStep)) return;
    setCreateStep(createSteps[0]);
  }, [createStep, createSteps]);

  useEffect(() => {
    setCreatePreviewPage(1);
  }, [createDraft]);

  useEffect(() => {
    let active = true;
    if (!activeReport || !activeTable) {
      setLiveReportResult(null);
      setLiveReportLoading(false);
      return;
    }
    if ((bundle.data[activeReport.sourceTableId]?.length || 0) > 0) {
      setLiveReportResult(null);
      setLiveReportLoading(false);
      return;
    }
    const quickbaseConfig = getQuickbaseConfigForTable(documentState, activeTable);
    if (!quickbaseConfig.realmHostname || !quickbaseConfig.userToken || !quickbaseConfig.appId) {
      setLiveReportResult(null);
      setLiveReportLoading(false);
      return;
    }
    if (!canUseLiveQuickbasePreview(activeReport, activeTable)) {
      setLiveReportResult(null);
      setLiveReportLoading(false);
      return;
    }

    setLiveReportLoading(true);
    fetchQuickbaseReportPreview(quickbaseConfig, activeReport, activeTable)
      .then((response) => {
        if (!active) return;
        setLiveReportResult(response.result);
      })
      .catch((error) => {
        if (!active) return;
        setLiveReportResult(null);
        pushToast(error instanceof Error ? error.message : "Quickbase report preview failed.", "warn");
      })
      .finally(() => {
        if (active) setLiveReportLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    activeReport?.id,
    activeReport?.updatedAt,
    activeTable?.id,
    bundle.data,
    documentState.activeQuickbaseProfileId,
    documentState.quickbaseProfiles,
    documentState.quickbase.appId,
    documentState.quickbase.realmHostname,
    documentState.quickbase.userToken
  ]);

  useEffect(() => {
    if (!exportJob || exportJob.status === "complete" || exportJob.status === "failed") return;
    const handle = window.setInterval(() => {
      fetchExportJobStatus(exportJob.id)
        .then((response) => {
          setExportJob(response.job);
          void refreshExportJobs();
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [exportJob?.id, exportJob?.status]);

  useEffect(() => {
    if (!exportJob) return;
    upsertStudioExportJob({
      id: `history-${exportJob.id}`,
      objectId: exportJob.objectId,
      objectType: exportJob.objectType,
      format: exportJob.format,
      status: exportJob.status,
      progress: exportJob.progress,
      message: exportJob.message,
      filename: exportJob.filename,
      error: exportJob.error,
      updatedAt: exportJob.updatedAt,
      sourceJobId: exportJob.id,
      runtimeFilters: activeDashboard && exportJob.objectType === "dashboard" && exportJob.objectId === activeDashboard.id ? runtimeValues : {},
      createdAt: exportJob.createdAt
    });
  }, [activeDashboard, exportJob, runtimeValues]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "complete" || downloadedJobId === exportJob.id) return;
    downloadExportJob(exportJob.id);
    setDownloadedJobId(exportJob.id);
    pushToast("Download is ready.");
  }, [downloadedJobId, exportJob]);

  useEffect(() => {
    if (drawer !== "export") return;
    void refreshExportJobs();
    const hasRunningJob = mergedExportJobs.some((job) => job.status === "queued" || job.status === "running");
    if (!hasRunningJob) return;
    const handle = window.setInterval(() => {
      void refreshExportJobs();
    }, 1500);
    return () => window.clearInterval(handle);
  }, [drawer, mergedExportJobs]);

  useEffect(() => {
    if (!resizeSession) return;
    const session = resizeSession;

    function handlePointerMove(event: PointerEvent) {
      const nextW = clampDashboardWidgetWidth(session.startW + Math.round((event.clientX - session.startX) / 96));
      const nextH = clampDashboardWidgetHeight(session.startH + Math.round((event.clientY - session.startY) / 88));
      if (nextW === session.nextW && nextH === session.nextH) return;
      setResizeSession((current) => (current ? { ...current, nextW, nextH } : current));
      updateActiveDashboardWidget(
        session.tabId,
        session.widgetId,
        (widget) => ({
          ...widget,
          layout: {
            ...widget.layout,
            w: nextW,
            h: nextH
          }
        }),
        { skipHistory: true }
      );
    }

    function handlePointerUp() {
      const changed = session.startW !== session.nextW || session.startH !== session.nextH;
      if (changed && resizeStartSnapshotRef.current) {
        setHistory((current) => [resizeStartSnapshotRef.current as StudioDocument, ...current].slice(0, 60));
        setFuture([]);
      }
      resizeStartSnapshotRef.current = null;
      setResizeSession(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizeSession, activeDashboard?.id]);

  const filteredObjects = useMemo(() => {
    return filterStudioLibraryItems(visibleObjects, {
      currentUserId,
      favorites: documentState.favorites,
      recentIds: documentState.recent,
      query: libraryQuery,
      typeFilter: libraryFilter,
      scopeFilter: libraryScopeFilter,
      favoritesOnly,
      recentOnly
    });
  }, [currentUserId, visibleObjects, libraryQuery, libraryFilter, libraryScopeFilter, favoritesOnly, recentOnly, documentState.favorites, documentState.recent]);
  const filteredHomeReportIds = useMemo(
    () => filteredObjects.filter((object): object is ReportDefinition => object.type === "report").map((object) => object.id),
    [filteredObjects]
  );

  const localReportResult = useMemo(() => {
    if (!activeReport || !activeTable) return null;
    return runReport(activeReport, activeTable, bundle.data[activeReport.sourceTableId] || []);
  }, [activeReport, activeTable, bundle.data]);
  const hasCachedRowsForActiveReport = Boolean(activeReport && (bundle.data[activeReport.sourceTableId]?.length || 0) > 0);
  const reportResult = hasCachedRowsForActiveReport ? localReportResult : (liveReportResult || localReportResult);

  const dashboardResult = useMemo(() => {
    if (!activeDashboard) return null;
    const widgets = activeDashboard.tabs.flatMap((tab) =>
      tab.widgets.map((widget) => {
        const report = widget.mode === "copied" && widget.snapshot ? widget.snapshot : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
        if (!report) {
          const message = "Linked report is unavailable.";
          const fallbackReport = createUnavailableDashboardReport(widget, message);
          return {
            widgetId: widget.id,
            widget,
            report: fallbackReport,
            result: createEmptyDashboardReportResult(fallbackReport.id, fallbackReport.sourceTableId, message),
            status: "failed" as const,
            message,
            error: message
          };
        }
        const table = bundle.tables.find((item) => item.id === report.sourceTableId);
        if (!table) {
          const message = "Source table is unavailable.";
          return {
            widgetId: widget.id,
            widget,
            report,
            result: createEmptyDashboardReportResult(report.id, report.sourceTableId, message),
            status: "failed" as const,
            message,
            error: message
          };
        }
        return {
          widgetId: widget.id,
          widget,
          report,
          result: runReport(report, table, bundle.data[report.sourceTableId] || [], buildDashboardFilters(activeDashboard, report.id, runtimeValues)),
          status: "complete" as const,
          message: "Preview ready"
        };
      })
    );
    return buildDashboardResult(activeDashboard, widgets);
  }, [activeDashboard, bundle, runtimeValues]);

  function writeObject(nextObject: StudioObject, options?: { skipHistory?: boolean }) {
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[nextObject.id] = { ...nextObject, updatedAt: new Date().toISOString() };
      if (!draft.bundle.order.includes(nextObject.id)) {
        draft.bundle.order.unshift(nextObject.id);
      }
    }, options);
  }

  function updateObject(nextObject: StudioObject) {
    writeObject(nextObject);
  }

  function updateActiveDashboardWidget(
    tabId: string,
    widgetId: string,
    updater: (
      widget: DashboardDefinition["tabs"][number]["widgets"][number],
      index: number,
      widgets: DashboardDefinition["tabs"][number]["widgets"]
    ) => DashboardDefinition["tabs"][number]["widgets"][number],
    options?: { skipHistory?: boolean }
  ) {
    if (!activeDashboard) return;
    const nextDashboard = clone(activeDashboard);
    nextDashboard.tabs = nextDashboard.tabs.map((tab) =>
      tab.id === tabId
        ? {
            ...tab,
            widgets: tab.widgets.map((widget, index, widgets) => (widget.id === widgetId ? updater(widget, index, widgets) : widget))
          }
        : tab
    );
    writeObject(nextDashboard, options);
  }

  function moveDashboardWidget(tabId: string, widgetId: string, direction: DashboardWidgetMoveDirection) {
    if (!activeDashboard) return;
    writeObject(moveDashboardWidgetByDirectionInDefinition(activeDashboard, tabId, widgetId, direction));
  }

  function moveDashboardWidgetByRow(tabId: string, widgetId: string, direction: "up" | "down") {
    if (!activeDashboard) return;
    writeObject(moveDashboardWidgetByRowInDefinition(activeDashboard, tabId, widgetId, direction));
  }

  function moveDashboardWidgetToRowEdge(tabId: string, widgetId: string, edge: DashboardWidgetRowEdge) {
    if (!activeDashboard) return;
    const tab = activeDashboard.tabs.find((candidate) => candidate.id === tabId);
    if (!tab) return;
    const rowIndex = (() => {
      const rows = resolveDashboardRowsForTab(tabId);
      return rows.findIndex((row) => row.widgetIds.includes(widgetId));
    })();
    if (rowIndex < 0) return;
    writeObject(reorderDashboardWidgetToRowEdgeInDefinition(activeDashboard, tabId, widgetId, rowIndex, edge));
  }

  function removeDashboardWidget(tabId: string, widgetId: string) {
    if (!activeDashboard) return;
    writeObject(removeDashboardWidgetInDefinition(activeDashboard, tabId, widgetId));
  }

  function moveDashboardWidgetToEdge(tabId: string, widgetId: string, edge: "start" | "end") {
    if (!activeDashboard) return;
    writeObject(moveDashboardWidgetToEdgeInDefinition(activeDashboard, tabId, widgetId, edge));
  }

  function applyDashboardWidgetPreset(tabId: string, widgetId: string, layout: { w: number; h: number }) {
    if (!activeDashboard) return;
    writeObject(applyDashboardWidgetLayout(activeDashboard, tabId, widgetId, layout));
  }

  function placeDashboardWidget(tabId: string, widgetId: string, position: { x: number; y: number }) {
    if (!activeDashboard) return;
    writeObject(placeDashboardWidgetAtPositionInDefinition(activeDashboard, tabId, widgetId, position));
  }

  function duplicateDashboardWidget(tabId: string, widgetId: string) {
    if (!activeDashboard) return;
    const duplicated = duplicateDashboardWidgetInDefinition(activeDashboard, tabId, widgetId, () => uid("widget"));
    writeObject(duplicated.dashboard);
    if (duplicated.widgetId) setSelectedWidgetId(duplicated.widgetId);
  }

  function moveDashboardWidgetToTab(tabId: string, widgetId: string, targetTabId: string) {
    if (!activeDashboard || !targetTabId) return;
    writeObject(moveDashboardWidgetToTabInDefinition(activeDashboard, tabId, widgetId, targetTabId));
    setActiveTabId(targetTabId);
    setSelectedWidgetId(widgetId);
  }

  function copyDashboardWidgetToTab(tabId: string, widgetId: string, targetTabId: string) {
    if (!activeDashboard || !targetTabId) return;
    const copied = copyDashboardWidgetToTabInDefinition(activeDashboard, tabId, widgetId, targetTabId, () => uid("widget"));
    writeObject(copied.dashboard);
    if (copied.widgetId) {
      setActiveTabId(targetTabId);
      setSelectedWidgetId(copied.widgetId);
    }
  }

  function addDashboardWidget(tabId: string, reportId: string, afterWidgetId?: string) {
    if (!activeDashboard) return;
    const report = objects.find((object): object is ReportDefinition => object.type === "report" && object.id === reportId);
    if (!report) return;
    const widgetId = uid("widget");
    const newWidget = {
      id: widgetId,
      title: report.name,
      mode: "linked" as const,
      displayMode: "inherit" as const,
      showDetails: false,
      showSummary: true,
      reportId: report.id,
      layout: { w: 6, h: 4 }
    };
    writeObject(insertDashboardWidget(activeDashboard, tabId, newWidget, afterWidgetId));
    setSelectedWidgetId(widgetId);
  }

  function toggleDashboardWidgetFullWidth(tabId: string, widgetId: string) {
    if (!activeDashboard) return;
    writeObject(toggleDashboardWidgetFullWidthInDefinition(activeDashboard, tabId, widgetId));
  }

  function balanceActiveDashboardTab(tabId: string) {
    if (!activeDashboard) return;
    writeObject(balanceDashboardTabLayoutInDefinition(activeDashboard, tabId));
  }

  function balanceAllDashboardTabs() {
    if (!activeDashboard) return;
    writeObject(balanceDashboardLayoutInDefinition(activeDashboard));
  }

  function balanceDashboardRow(tabId: string, rowIndex: number) {
    if (!activeDashboard || rowIndex < 0) return;
    writeObject(balanceDashboardRowInDefinition(activeDashboard, tabId, rowIndex));
  }

  function applyDashboardRowPreset(tabId: string, rowIndex: number, preset: DashboardRowLayoutPreset) {
    if (!activeDashboard || rowIndex < 0) return;
    writeObject(applyDashboardRowPresetInDefinition(activeDashboard, tabId, rowIndex, preset));
  }

  function resolveDashboardRowsForTab(tabId: string) {
    const tab = activeDashboard?.tabs.find((candidate) => candidate.id === tabId);
    return tab ? getDashboardWidgetRowsInStudio(tab) : [];
  }

  function beginWidgetResize(event: ReactPointerEvent<HTMLButtonElement>, tabId: string, widgetId: string, layout: { w: number; h: number }) {
    event.preventDefault();
    event.stopPropagation();
    resizeStartSnapshotRef.current = clone(documentState);
    setResizeSession({
      tabId,
      widgetId,
      startX: event.clientX,
      startY: event.clientY,
      startW: clampDashboardWidgetWidth(layout.w),
      startH: clampDashboardWidgetHeight(layout.h),
      nextW: clampDashboardWidgetWidth(layout.w),
      nextH: clampDashboardWidgetHeight(layout.h)
    });
  }

  async function openCreateModal(type: CreateModalType) {
    let nextTable: TableDefinition | null = bundle.tables[0] || null;
    if (type === "report" && shouldAutoLoadQuickbaseSchema(documentState)) {
      const schema = await loadQuickbaseMetadata(true);
      if (schema) {
        nextTable = activeQuickbaseProfile ? convertQuickbaseSchemaToTables(schema, activeQuickbaseProfile)[0] || nextTable : nextTable;
      }
    }
    setCreateDraft(buildStudioBuilderDraft(nextTable, type, currentUserId, uid));
    setEditingReportId(null);
    setCreateFieldQuery("");
    setCreateStep(getStudioBuilderSteps(type)[0]);
    setCreatePreviewPage(1);
    setCreateModalOpen(true);
  }

  function openEditReportModal(report: ReportDefinition) {
    const table = bundle.tables.find((item) => item.id === report.sourceTableId) || null;
    setCreateDraft(buildDraftFromReport(report, table));
    setEditingReportId(report.id);
    setCreateFieldQuery("");
    setCreateStep("basics");
    setCreatePreviewPage(1);
    setCreateModalOpen(true);
  }

  function updateCreateDraftTable(tableId: string) {
    const table = bundle.tables.find((item) => item.id === tableId) || bundle.tables[0] || null;
    if (!table) return;
    setCreateDraft((current) => ({
      ...current,
      tableId: table.id,
      sourceReportOverrides: {},
      selectedFieldIds: table.fields.slice(0, 6).map((field) => field.id),
      filterTree: createFilterGroup("and", []),
      sorts: [],
      summaryMetrics: table.fields[0] ? [{ id: uid("metric"), fieldId: table.fields[0].id, op: "count", label: "Rows" }] : [],
      view: {
        ...current.view,
        showChartInTable: false,
        showSummary: current.view.showSummary ?? true,
        showDetails: current.view.showDetails ?? true,
        chartTitle: current.view.chartTitle || "",
        decimalPlaces: Number.isFinite(Number(current.view.decimalPlaces)) ? Math.max(0, Math.min(6, Number(current.view.decimalPlaces))) : 2,
        chartOrientation: "vertical",
        chartFieldId: table.fields[0]?.id || "",
        chartSeriesFieldId: "",
        chartValueFieldId: "",
        chartAggregation: "count",
        chartSecondaryValueFieldId: "",
        chartSecondaryAggregation: "sum",
        chartUseSecondaryAxis: false,
        chartSecondarySeriesType: "line",
        chartTopN: current.view.chartTopN || 12,
        chartSort: current.view.chartSort || "value-desc",
        chartColors: current.view.chartColors?.length ? [...current.view.chartColors] : [...DEFAULT_CHART_COLORS],
        chartShowLegend: current.view.chartShowLegend ?? true,
        chartShowValues: current.view.chartShowValues ?? true,
        chartXAxisLabel: current.view.chartXAxisLabel || "",
        chartYAxisLabel: current.view.chartYAxisLabel || "",
        chartSecondaryYAxisLabel: current.view.chartSecondaryYAxisLabel || "",
        titleFieldId: table.fields[1]?.id || table.fields[0]?.id || "",
        timelineDateField: "",
        timelineEndField: "",
        calendarDateField: "",
        kanbanField: ""
      },
      displayLabels: {
        fields: {},
        chartValues: {}
      }
    }));
  }

  function createFromDraft() {
    if (createDraft.type === "dashboard") {
      const sharing = normalizeStudioBuilderScopeOwner(createDraft.scope, currentUserId, createDraft.ownerUserId);
      const dashboard: DashboardDefinition = {
        id: uid("dashboard"),
        type: "dashboard",
        schemaVersion: 1,
        name: createDraft.name.trim() || "New Dashboard",
        description: createDraft.description.trim(),
        folder: "Custom",
        category: "Dashboard",
        tags: [],
        scope: sharing.scope,
        ownerUserId: sharing.ownerUserId,
        updatedAt: new Date().toISOString(),
        runtimeFilters: [],
        sourceReportOverrides: {},
        tabs: [{ id: uid("tab"), name: "Overview", widgets: [] }]
      };
      applyDocumentUpdate((draft) => {
        draft.bundle.objects[dashboard.id] = dashboard;
        draft.bundle.order.unshift(dashboard.id);
      });
      setCreateModalOpen(false);
      navigate(buildHostedRoute(`/studio/${dashboard.id}`));
      pushToast("Dashboard created.");
      return;
    }

    const table = bundle.tables.find((item) => item.id === createDraft.tableId) || bundle.tables[0];
    if (!table) {
      pushToast("Load or configure a source table first.", "warn");
      return;
    }
    if (!createDraft.selectedFieldIds.length && createDraft.view.showDetails) {
      pushToast("Pick at least one detail field or turn off detail rows.", "warn");
      return;
    }
    const existingReport = editingReportId ? (bundle.objects[editingReportId] as ReportDefinition | undefined) : undefined;
    const sharing = normalizeStudioBuilderScopeOwner(createDraft.scope, currentUserId, createDraft.ownerUserId);
    const report: ReportDefinition = {
      id: existingReport?.id || uid("report"),
      type: "report",
      schemaVersion: existingReport?.schemaVersion || 1,
      name: createDraft.name.trim() || "New Report",
      description: createDraft.description.trim(),
      folder: existingReport?.folder || "Custom",
      category: existingReport?.category || "Reporting",
      tags: existingReport?.tags || [],
      scope: sharing.scope,
      ownerUserId: sharing.ownerUserId,
      updatedAt: new Date().toISOString(),
      sourceTableId: table.id,
      sourceReportOverrides: clone(createDraft.sourceReportOverrides),
      selectedFieldIds: createDraft.selectedFieldIds,
      filters: flattenFilterTree(createDraft.filterTree),
      filterTree: clone(createDraft.filterTree),
      groups: [],
      sorts: clone(createDraft.sorts),
      summaryMetrics: clone(createDraft.summaryMetrics),
      view: clone(createDraft.view),
      displayLabels: clone(createDraft.displayLabels)
    };
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[report.id] = report;
      if (!draft.bundle.order.includes(report.id)) {
        draft.bundle.order.unshift(report.id);
      }
    });
    setCreateModalOpen(false);
    setEditingReportId(null);
    navigate(buildHostedRoute(`/studio/${report.id}`));
    pushToast(existingReport ? "Report updated." : "Report created.");
  }

  function cloneObject(object: StudioObject) {
    if (object.type !== "dashboard") {
      const copy = clone(object);
      copy.id = uid(object.type);
      copy.name = `${object.name} Copy`;
      copy.updatedAt = new Date().toISOString();
      applyDocumentUpdate((draft) => {
        draft.bundle.objects[copy.id] = copy;
        draft.bundle.order.unshift(copy.id);
      });
      navigate(buildHostedRoute(`/studio/${copy.id}`));
      pushToast("Object cloned.");
      return;
    }

    const cloneReportsToo = window.confirm(
      "Do you want to clone the reports and charts used in this dashboard too?\n\nChoose OK to clone the dashboard and its reports.\nChoose Cancel to clone only the dashboard and keep it connected to the original reports."
    );
    const reportCloneMap = new Map<string, ReportDefinition>();
    const dashboardCopy = clone(object);
    dashboardCopy.id = uid("dashboard");
    dashboardCopy.name = `${object.name} Copy`;
    dashboardCopy.updatedAt = new Date().toISOString();

    if (cloneReportsToo) {
      dashboardCopy.tabs = dashboardCopy.tabs.map((tab) => ({
        ...tab,
        widgets: tab.widgets.map((widget) => {
          const sourceReport = widget.mode === "copied" && widget.snapshot
            ? widget.snapshot
            : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
          if (!sourceReport) {
            return widget;
          }

          const mapKey = widget.mode === "copied" && widget.snapshot
            ? `snapshot:${widget.id}`
            : `report:${sourceReport.id}`;

          let reportCopy = reportCloneMap.get(mapKey);
          if (!reportCopy) {
            reportCopy = clone(sourceReport);
            reportCopy.id = uid("report");
            reportCopy.name = `${sourceReport.name} Copy`;
            reportCopy.updatedAt = new Date().toISOString();
            reportCloneMap.set(mapKey, reportCopy);
          }

          return {
            ...widget,
            reportId: reportCopy.id,
            snapshot: widget.mode === "copied" ? clone(reportCopy) : undefined
          };
        })
      }));

      dashboardCopy.runtimeFilters = dashboardCopy.runtimeFilters.map((filter) => ({
        ...filter,
        targetReportIds: filter.targetReportIds.map((reportId) => reportCloneMap.get(`report:${reportId}`)?.id || reportId)
      }));
    }

    applyDocumentUpdate((draft) => {
      if (cloneReportsToo) {
        Array.from(reportCloneMap.values()).forEach((reportCopy) => {
          draft.bundle.objects[reportCopy.id] = reportCopy;
          draft.bundle.order.unshift(reportCopy.id);
        });
      }
      draft.bundle.objects[dashboardCopy.id] = dashboardCopy;
      draft.bundle.order.unshift(dashboardCopy.id);
    });
    navigate(buildHostedRoute(`/studio/${dashboardCopy.id}`));
    pushToast(
      cloneReportsToo
        ? `Dashboard cloned with ${reportCloneMap.size} copied report${reportCloneMap.size === 1 ? "" : "s"}.`
        : "Dashboard cloned and left connected to the original reports."
    );
  }

  async function deleteObject(objectId: string) {
    const nextDocument = clone(documentState);
    delete nextDocument.bundle.objects[objectId];
    nextDocument.bundle.order = nextDocument.bundle.order.filter((item) => item !== objectId);
    nextDocument.favorites = nextDocument.favorites.filter((item) => item !== objectId);
    nextDocument.recent = nextDocument.recent.filter((item) => item !== objectId);

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    navigate(buildHostedRoute(`/studio/${nextDocument.bundle.order[0] || ""}`));
    pushToast("Object removed.", "warn");
    await persistRemote(nextDocument);
  }

  function toggleHomeReportSelection(reportId: string, selected: boolean) {
    setSelectedHomeReportIds((current) => (
      selected
        ? Array.from(new Set([...current, reportId]))
        : current.filter((id) => id !== reportId)
    ));
  }

  function selectAllVisibleHomeReports() {
    setSelectedHomeReportIds(filteredHomeReportIds);
  }

  function clearHomeReportSelection() {
    setSelectedHomeReportIds([]);
  }

  async function deleteSelectedHomeReports() {
    const reportIds = selectedHomeReportIds.filter((id) => bundle.objects[id]?.type === "report");
    if (!reportIds.length) {
      pushToast("Select at least one report first.", "warn");
      return;
    }
    const confirmed = window.confirm(`Delete ${reportIds.length} selected report${reportIds.length === 1 ? "" : "s"}?`);
    if (!confirmed) return;

    const nextDocument = clone(documentState);
    reportIds.forEach((reportId) => {
      delete nextDocument.bundle.objects[reportId];
      nextDocument.bundle.order = nextDocument.bundle.order.filter((item) => item !== reportId);
      nextDocument.favorites = nextDocument.favorites.filter((item) => item !== reportId);
      nextDocument.recent = nextDocument.recent.filter((item) => item !== reportId);
    });

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setSelectedHomeReportIds([]);
    setDocumentState(nextDocument);
    if (activeReport && reportIds.includes(activeReport.id)) {
      navigate(buildHostedRoute("/studio"));
    }
    pushToast(`Deleted ${reportIds.length} report${reportIds.length === 1 ? "" : "s"}.`, "warn");
    await persistRemote(nextDocument);
  }

  function toggleFavorite(objectId: string) {
    applyDocumentUpdate((draft) => {
      draft.favorites = draft.favorites.includes(objectId)
        ? draft.favorites.filter((item) => item !== objectId)
        : [objectId, ...draft.favorites];
    });
  }

  function undo() {
    const [previous, ...rest] = history;
    if (!previous) return;
    setFuture((current) => [clone(documentState), ...current].slice(0, 60));
    setHistory(rest);
    setDocumentState(previous);
    pushToast("Undid last change.");
  }

  function redo() {
    const [next, ...rest] = future;
    if (!next) return;
    setHistory((current) => [clone(documentState), ...current].slice(0, 60));
    setFuture(rest);
    setDocumentState(next);
    pushToast("Reapplied change.");
  }

  async function persistRemote(nextDocument: StudioDocument) {
    setSavingRemote(true);
    try {
      const response = await saveStudioDocument(nextDocument);
      setDocumentState(scopeDocument(normalizeStudioDocument(response.document)));
      setLastQuickbaseSync(response.sync || null);
      if (response.sync?.enabled) {
        if (response.sync.ok) {
          pushToast(`${response.sync.message} ${response.sync.savedObjects} objects · ${response.sync.savedSettings} settings · ${response.sync.savedVersions} versions.`, "ok");
        } else {
          pushToast(response.sync.message, "warn");
        }
      } else {
        pushToast("Hosted studio saved.");
      }
    } catch (error) {
      setLastQuickbaseSync({
        enabled: true,
        ok: false,
        message: error instanceof Error ? error.message : "Save failed.",
        savedObjects: 0,
        savedSettings: 0,
        savedVersions: 0,
        savedStorageConfig: 0
      });
      pushToast(error instanceof Error ? error.message : "Save failed.", "danger");
    } finally {
      setSavingRemote(false);
    }
  }

  async function saveRemote() {
    const refreshValidation = getActiveProfileRefreshValidation(documentState, false);
    if (refreshValidation) {
      pushToast(refreshValidation, "warn");
      return;
    }
    await persistRemote(documentState);
  }

  async function reloadRemote() {
    try {
      const response = await fetchStudioDocument();
      setDocumentState(scopeDocument(normalizeStudioDocument(response.document)));
      setHistory([]);
      setFuture([]);
      pushToast("Reloaded hosted studio.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Reload failed.", "danger");
    }
  }

  async function loadQuickbaseMetadata(silent = false) {
    const profile = activeQuickbaseProfile;
    if (!profile) {
      pushToast("Add a Quickbase app profile first.", "warn");
      return null;
    }
    setQuickbaseSchemaLoading(true);
    try {
      const response = await fetchQuickbaseSchema(profile.quickbase);
      setQuickbaseSchema(response.schema);
      const nextTables = convertQuickbaseSchemaToTables(response.schema, profile);
      const detected = detectQuickbaseStorageConfig(response.schema);
      applyDocumentUpdate((draft) => {
        draft.bundle.app.id = response.schema.id || draft.bundle.app.id;
        draft.bundle.app.name = response.schema.name || draft.bundle.app.name;
        draft.bundle.tables = [
          ...draft.bundle.tables.filter((table) => table.quickbaseProfileId !== profile.id),
          ...nextTables
        ];
        draft.bundle.data = {
          ...draft.bundle.data,
          ...Object.fromEntries(nextTables.map((table) => [table.id, draft.bundle.data[table.id] || []]))
        };
        Object.entries(detected).forEach(([key, value]) => {
          if (!value) return;
          const typedKey = key as keyof QuickbaseConnectionConfig;
          const currentProfile = draft.quickbaseProfiles.find((item) => item.id === profile.id);
          if (currentProfile && !currentProfile.quickbase[typedKey]) {
            currentProfile.quickbase[typedKey] = value as never;
          }
          if (draft.activeQuickbaseProfileId === profile.id && !draft.quickbase[typedKey]) {
            draft.quickbase[typedKey] = value as never;
          }
        });
      });
      if (!silent) {
        pushToast(`Loaded ${response.schema.tables.length} Quickbase tables for ${profile.label}.`);
      }
      return response.schema;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Quickbase schema lookup failed.", "danger");
      return null;
    } finally {
      setQuickbaseSchemaLoading(false);
    }
  }

  async function loadRealmApps(silent = false) {
    const profile = activeQuickbaseProfile;
    if (!profile) {
      pushToast("Add a Quickbase app profile first.", "warn");
      return;
    }
    setRealmAppsLoading(true);
    try {
      const response = await fetchQuickbaseApps(profile.quickbase);
      setRealmApps(response.apps);
      if (!silent) {
        pushToast(`Found ${response.apps.length} Quickbase apps you can access in this realm.`);
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Quickbase app lookup failed.", "danger");
    } finally {
      setRealmAppsLoading(false);
    }
  }

  function updateQuickbaseField(field: keyof StudioDocument["quickbase"], value: string) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (profile) {
        profile.quickbase[field] = value as never;
      }
      draft.quickbase[field] = value as never;
    });
  }

  function updateRefreshScheduleField<K extends keyof StudioDocument["sync"]["refreshSchedule"]>(field: K, value: StudioDocument["sync"]["refreshSchedule"][K]) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (profile) {
        profile.refreshSchedule[field] = value;
      }
      draft.sync.refreshSchedule[field] = value;
    });
  }

  function updateRefreshSourceTables(tableIds: string[]) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      const nextTableIds = Array.from(new Set(tableIds.filter(Boolean)));
      profile.refreshSource.tableIds = nextTableIds;
      profile.refreshSource.reportIds = Object.fromEntries(
        Object.entries(profile.refreshSource.reportIds || {}).filter(([tableId]) => nextTableIds.includes(tableId))
      );
    });
  }

  function updateRefreshSourceReportId(tableId: string, reportId: string) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      profile.refreshSource.reportIds = {
        ...(profile.refreshSource.reportIds || {}),
        [tableId]: reportId
      };
    });
  }

  function getActiveProfileRefreshValidation(document: StudioDocument, requireAtLeastOne = false) {
    const profile = getActiveQuickbaseProfile(document);
    if (!profile) return "Add a Quickbase app profile first.";
    const selectedTableIds = profile.refreshSource.tableIds || [];
    if (!selectedTableIds.length) {
      if (!requireAtLeastOne) return null;
      return "Select at least one Quickbase table and enter its report ID.";
    }
    const missing = selectedTableIds.filter((tableId) => !String(profile.refreshSource.reportIds?.[tableId] || "").trim());
    if (!missing.length) return null;
    const labels = getTablesForQuickbaseProfile(document, profile.id)
      .filter((table) => missing.includes(table.quickbaseTableId || table.id))
      .map((table) => table.name)
      .join(", ");
    return `Enter a Quickbase report ID for each selected table${labels ? `: ${labels}` : "."}`;
  }

  function getFullRefreshValidation(document: StudioDocument) {
    if (!document.quickbaseProfiles.length) return "Add a Quickbase app profile first.";
    let selectedCount = 0;
    for (const profile of document.quickbaseProfiles) {
      const selectedTableIds = profile.refreshSource.tableIds || [];
      selectedCount += selectedTableIds.length;
      const missing = selectedTableIds.filter((tableId) => !String(profile.refreshSource.reportIds?.[tableId] || "").trim());
      if (!missing.length) continue;
      const labels = getTablesForQuickbaseProfile(document, profile.id)
        .filter((table) => missing.includes(table.quickbaseTableId || table.id))
        .map((table) => table.name)
        .join(", ");
      return `Enter a Quickbase report ID for each selected table in ${profile.label || profile.quickbase.appId || "this app"}${labels ? `: ${labels}` : "."}`;
    }
    if (selectedCount < 1) {
      return "Select at least one Quickbase table and enter its report ID in any app profile.";
    }
    return null;
  }

  function setActiveQuickbaseProfile(profileId: string) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === profileId);
      if (!profile) return;
      draft.activeQuickbaseProfileId = profileId;
      draft.quickbase = clone(profile.quickbase);
      draft.sync.refreshSchedule = clone(profile.refreshSchedule);
      draft.sync.refreshStatus = clone(profile.refreshStatus);
    });
  }

  function addQuickbaseProfile() {
    const profile = createQuickbaseProfile();
    applyDocumentUpdate((draft) => {
      draft.quickbaseProfiles.push(profile);
      draft.activeQuickbaseProfileId = profile.id;
      draft.quickbase = clone(profile.quickbase);
      draft.sync.refreshSchedule = clone(profile.refreshSchedule);
      draft.sync.refreshStatus = clone(profile.refreshStatus);
    });
    setQuickbaseSchema(null);
    pushToast("Added a new Quickbase app profile.");
  }

  function removeQuickbaseProfile(profileId: string) {
    applyDocumentUpdate((draft) => {
      if (draft.quickbaseProfiles.length <= 1) return;
      draft.quickbaseProfiles = draft.quickbaseProfiles.filter((item) => item.id !== profileId);
      draft.bundle.tables = draft.bundle.tables.filter((table) => table.quickbaseProfileId !== profileId);
      Object.keys(draft.bundle.data).forEach((tableId) => {
        const table = draft.bundle.tables.find((item) => item.id === tableId);
        if (!table) {
          delete draft.bundle.data[tableId];
        }
      });
      if (draft.activeQuickbaseProfileId === profileId) {
        const nextProfile = draft.quickbaseProfiles[0];
        draft.activeQuickbaseProfileId = nextProfile?.id || "";
        if (nextProfile) {
          draft.quickbase = clone(nextProfile.quickbase);
          draft.sync.refreshSchedule = clone(nextProfile.refreshSchedule);
          draft.sync.refreshStatus = clone(nextProfile.refreshStatus);
        }
      }
    });
    setQuickbaseSchema(null);
    pushToast("Removed the Quickbase app profile.", "warn");
  }

  function updateQuickbaseProfileLabel(value: string) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      profile.label = value;
      draft.bundle.tables = draft.bundle.tables.map((table) => {
        if (table.quickbaseProfileId !== profile.id) return table;
        const rawName = table.name.includes(" · ") ? table.name.split(" · ").slice(1).join(" · ") : table.name;
        return {
          ...table,
          name: value.trim() ? `${value} · ${rawName}` : rawName
        };
      });
    });
  }

  function applyQuickbaseAppSelection(appId: string) {
    const selected = realmApps.find((item) => item.id === appId);
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      profile.quickbase.appId = appId;
      if (selected) {
        profile.label = selected.name;
      }
      draft.quickbase.appId = appId;
      if (selected && (!draft.branding.platformName || draft.branding.platformName === "Hosted Reporting Platform")) {
        draft.branding.platformName = selected.name;
      }
      draft.bundle.tables = draft.bundle.tables.filter((table) => table.quickbaseProfileId !== profile.id);
    });
    setQuickbaseSchema(null);
  }

  function updateQuickbaseProfileLiveMode(enabled: boolean) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      profile.liveMode = enabled;
    });
  }

  function autoDetectQuickbaseMappings() {
    const profile = activeQuickbaseProfile;
    if (!quickbaseSchema || !profile) return;
    const detected = detectQuickbaseStorageConfig(quickbaseSchema);
    applyDocumentUpdate((draft) => {
      Object.entries(detected).forEach(([key, value]) => {
        const typedKey = key as keyof QuickbaseConnectionConfig;
        const activeProfile = draft.quickbaseProfiles.find((item) => item.id === profile.id);
        if (activeProfile) {
          activeProfile.quickbase[typedKey] = String(value || "") as never;
        }
        if (draft.activeQuickbaseProfileId === profile.id) {
          draft.quickbase[typedKey] = String(value || "") as never;
        }
      });
    });
    pushToast("Quickbase storage tables and fields were auto-detected from this app.");
  }

  async function openVersions() {
    if (!activeObject) return;
    try {
      const response = await fetchStudioVersions(activeObject.id);
      setVersionList(response.versions);
      setDrawer("versions");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Unable to load versions.", "danger");
    }
  }

  async function snapshotCurrentObject() {
    if (!activeObject) return;
    try {
      await createStudioSnapshot(activeObject.id, `${activeObject.name} snapshot`);
      const response = await fetchStudioVersions(activeObject.id);
      setVersionList(response.versions);
      setDrawer("versions");
      pushToast("Snapshot created.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Snapshot failed.", "danger");
    }
  }

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed" || refreshJob.status === "cancelled") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshingCache(false);
            pushToast(`Refreshed ${response.job.tableCount || 0} tables and cached ${(response.job.rowCount || 0).toLocaleString()} rows.`, "ok");
            void reloadRemote();
          } else if (response.job.status === "cancelled") {
            setRefreshingCache(false);
            pushToast("Refresh cancelled.", "warn");
          } else if (response.job.status === "failed") {
            setRefreshingCache(false);
            pushToast(response.job.error || response.job.message, "danger");
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  useEffect(() => {
    if (!refreshJob) return;
    if (refreshJob.status === "complete") {
      setRefreshingCache(false);
      void reloadRemote();
    } else if (refreshJob.status === "cancelled") {
      setRefreshingCache(false);
    } else if (refreshJob.status === "failed") {
      setRefreshingCache(false);
    }
  }, [refreshJob]);

  const lastOpenSettingsSignal = useRef(openSettingsSignal);

  useEffect(() => {
    if (!openSettingsSignal || openSettingsSignal <= lastOpenSettingsSignal.current) {
      lastOpenSettingsSignal.current = openSettingsSignal;
      return;
    }
    lastOpenSettingsSignal.current = openSettingsSignal;
    const handle = window.requestAnimationFrame(() => {
      setDrawer("settings");
    });
    return () => window.cancelAnimationFrame(handle);
  }, [openSettingsSignal]);

  useEffect(() => {
    if (!refreshAllSignal) return;
    void refreshAllNow();
  }, [refreshAllSignal]);

  async function refreshAllNow() {
    const refreshValidation = getFullRefreshValidation(documentState);
    if (refreshValidation) {
      pushToast(refreshValidation, "warn");
      return;
    }
    setRefreshingCache(true);
    try {
      const saved = await saveStudioDocument(documentState);
      setDocumentState(scopeDocument(normalizeStudioDocument(saved.document)));
      setLastQuickbaseSync(saved.sync || null);
      const response = await startStudioRefresh();
      setRefreshJob(response.job);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Refresh failed.", "danger");
      setRefreshingCache(false);
    }
  }

  async function restoreVersion(versionId: string) {
    if (!activeObject) return;
    try {
      await restoreStudioVersion(activeObject.id, versionId);
      await reloadRemote();
      const response = await fetchStudioVersions(activeObject.id);
      setVersionList(response.versions);
      pushToast("Version restored.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Restore failed.", "danger");
    }
  }

  function addTemplate(type: StudioTemplateType) {
    if (!activeObject) return;
    const record: StudioTemplateRecord = {
      id: uid("template"),
      type,
      name: `${activeObject.name} template`,
      tableId: activeObject.type === "report" ? activeObject.sourceTableId : undefined,
      object: clone(activeObject)
    };
    applyDocumentUpdate((draft) => {
      if (type === "layout") draft.templates.layouts.unshift(record);
      if (type === "yaml") draft.templates.yaml.unshift(record);
      if (type === "upload") draft.templates.upload.unshift(record);
    });
    pushToast("Template saved.");
  }

  function applyTemplate(template: StudioTemplateRecord) {
    if (!template.object) return;
    const object = clone(template.object);
    object.id = uid(object.type);
    object.name = `${template.name} Copy`;
    object.updatedAt = new Date().toISOString();
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[object.id] = object;
      draft.bundle.order.unshift(object.id);
    });
    navigate(buildHostedRoute(`/studio/${object.id}`));
    pushToast("Template applied.");
  }

  function handleImportJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text);
      if (parsed?.bundle && parsed?.templates) {
        setDocumentState(scopeDocument(normalizeStudioDocument(parsed as StudioDocument)));
        pushToast("Studio document imported.");
      } else if (parsed?.type === "report" || parsed?.type === "dashboard") {
        const object = parsed as StudioObject;
        object.id = uid(object.type);
        object.updatedAt = new Date().toISOString();
        applyDocumentUpdate((draft) => {
          draft.bundle.objects[object.id] = object;
          draft.bundle.order.unshift(object.id);
        });
        navigate(buildHostedRoute(`/studio/${object.id}`));
        pushToast("Object imported.");
      } else {
        pushToast("Unsupported JSON import payload.", "danger");
      }
      if (event.target) event.target.value = "";
    }).catch((error) => {
      pushToast(error instanceof Error ? error.message : "Import failed.", "danger");
    });
  }

  function handleImportXlsx(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setXlsxImporting(true);
    importStudioWorkbook(file)
      .then((response) => {
        setDocumentState(scopeDocument(normalizeStudioDocument(response.document)));
        setLastWorkbookImportReview(response.review);
        setLastWorkbookImportObjectIds(response.importedObjectIds);
        setImportReviewModalOpen(true);
        if (response.primaryObjectId) {
          navigate(buildHostedRoute(`/studio/${response.primaryObjectId}`));
        }
        const importedType = response.review.dashboardCreated ? "dashboard workbook" : response.importedObjectIds.length > 1 ? "workbook" : "sheet";
        pushToast(`Imported ${importedType} from ${file.name}.`);
        if (response.warnings.length) {
          pushToast(`${response.warnings.length} import note${response.warnings.length === 1 ? "" : "s"} recorded. Review the import summary for details.`, "warn");
        }
      })
      .catch((error) => {
        pushToast(error instanceof Error ? error.message : "XLSX import failed.", "danger");
      })
      .finally(() => {
        setXlsxImporting(false);
        if (event.target) event.target.value = "";
      });
  }

  function exportJson() {
    downloadFile("studio-document.json", JSON.stringify(documentState, null, 2));
    const timestamp = new Date().toISOString();
    upsertStudioExportJob({
      id: uid("job"),
      objectId: activeObject?.id || "studio",
      objectType: activeObject?.type || "studio",
      format: "json",
      status: "complete",
      progress: 100,
      message: "JSON export downloaded",
      updatedAt: timestamp,
      createdAt: timestamp
    });
    pushToast("Studio JSON exported.");
  }

  async function exportWorkbook() {
    if (!(activeReport && reportResult) && !(activeDashboard && dashboardResult)) {
      pushToast("Open a report or dashboard before exporting.", "warn");
      return;
    }
    await startObjectExport({
      objectId: activeObject?.id || "",
      runtimeFilters: activeDashboard ? runtimeValues : {}
    });
    pushToast("Workbook export started.");
  }

  function updateImportedReviewReport(reportId: string, updater: (report: ReportDefinition) => ReportDefinition) {
    const current = bundle.objects[reportId];
    if (!current || current.type !== "report") return;
    updateObject(updater(clone(current)));
  }

  function toggleImportedReviewSelectedField(reportId: string, fieldId: string, selected: boolean) {
    updateImportedReviewReport(reportId, (report) => {
      const selectedFieldIds = new Set(report.selectedFieldIds);
      if (selected) selectedFieldIds.add(fieldId);
      else selectedFieldIds.delete(fieldId);
      return {
        ...report,
        selectedFieldIds: Array.from(selectedFieldIds)
      };
    });
  }

  function renderStudioOverlays() {
    return (
      <>
        {importReviewModalOpen && lastWorkbookImportReview ? (
          <div className="studio-modal-backdrop" onClick={() => setImportReviewModalOpen(false)}>
            <section className="studio-modal studio-import-review-modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <div>
                  <strong>Imported workbook review</strong>
                  <div className="micro">
                    {lastWorkbookImportReview.workbookName} · {importedReviewReports.length} report{importedReviewReports.length === 1 ? "" : "s"}
                    {importedReviewDashboardCount ? ` · ${importedReviewDashboardCount} dashboard candidate${importedReviewDashboardCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <button type="button" onClick={() => setImportReviewModalOpen(false)}>Close</button>
              </div>

              {lastWorkbookImportReview.dashboardCreated ? (
                <div className="sync-status sync-status-ok">
                  <strong>Dashboard candidate ready</strong>
                  <span>The workbook was reconstructed into native reports and dashboard tabs. Review each imported report here and fix any fields that still need attention.</span>
                </div>
              ) : null}

              <div className="stack">
                {importedReviewReports.map(({ report, table }) => {
                  const fieldOptions = table ? getSortedFieldOptions(table) : [];
                  const tableFieldIds = new Set((table?.fields || []).map((field) => field.id));
                  const referencedFieldIds = collectReportImportReferencedFieldIds(report);
                  const matchedReferencedCount = referencedFieldIds.filter((fieldId) => tableFieldIds.has(fieldId)).length;
                  const issues = collectReportImportIssues(report, table);
                  return (
                    <article className="import-review-report-card" key={report.id}>
                      <div className="card-head">
                        <div>
                          <strong>{report.name}</strong>
                          <div className="micro">
                            {report.view.mode === "chart" ? report.view.chartType : report.view.mode} · {table?.name || "Missing source table"}
                          </div>
                        </div>
                        <span className={`badge${issues.length ? "" : " brand"}`}>
                          {issues.length ? `${issues.length} need review` : `${matchedReferencedCount}/${Math.max(referencedFieldIds.length, matchedReferencedCount || 1)} matched`}
                        </span>
                      </div>

                      {issues.length ? (
                        <div className="sync-status sync-status-warn">
                          <strong>Needs attention</strong>
                          <ul className="flat-list import-review-list">
                            {issues.map((issue) => <li key={issue}>{issue}</li>)}
                          </ul>
                        </div>
                      ) : (
                        <div className="sync-status sync-status-ok">
                          <strong>Fields matched</strong>
                          <span>This report already has usable field assignments. Adjust them here only if you want a different setup.</span>
                        </div>
                      )}

                      {table ? (
                        <>
                          <div className="field">
                            <span>Selected fields</span>
                            <div className="import-review-field-grid">
                              {fieldOptions.map((option) => (
                                <label className="toggle-row import-review-field-option" key={`${report.id}-${option.value}`}>
                                  <input
                                    type="checkbox"
                                    checked={report.selectedFieldIds.includes(option.value)}
                                    onChange={(event) => toggleImportedReviewSelectedField(report.id, option.value, event.target.checked)}
                                  />
                                  <span>{option.label}</span>
                                </label>
                              ))}
                            </div>
                          </div>

                          {reportShowsChart(report) ? (
                            <div className="filter-grid compact-grid">
                              <label className="field">
                                <span>X axis field</span>
                                <SearchableSelect value={report.view.chartFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, chartFieldId: value } }))} />
                              </label>
                              <label className="field">
                                <span>Value field</span>
                                <SearchableSelect value={report.view.chartValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, chartValueFieldId: value } }))} />
                              </label>
                              <label className="field">
                                <span>Series field</span>
                                <SearchableSelect value={report.view.chartSeriesFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Single series" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, chartSeriesFieldId: value } }))} />
                              </label>
                              {report.view.chartUseSecondaryAxis ? (
                                <label className="field">
                                  <span>Secondary value field</span>
                                  <SearchableSelect value={report.view.chartSecondaryValueFieldId} options={fieldOptions} allowEmpty emptyOptionLabel="Count rows" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, chartSecondaryValueFieldId: value } }))} />
                                </label>
                              ) : null}
                            </div>
                          ) : null}

                          {report.view.mode === "timeline" ? (
                            <div className="filter-grid compact-grid">
                              <label className="field">
                                <span>Timeline start</span>
                                <SearchableSelect value={report.view.timelineDateField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, timelineDateField: value } }))} />
                              </label>
                              <label className="field">
                                <span>Timeline end</span>
                                <SearchableSelect value={report.view.timelineEndField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, timelineEndField: value } }))} />
                              </label>
                            </div>
                          ) : null}

                          {report.view.mode === "calendar" ? (
                            <label className="field">
                              <span>Calendar date field</span>
                              <SearchableSelect value={report.view.calendarDateField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, calendarDateField: value } }))} />
                            </label>
                          ) : null}

                          {report.view.mode === "kanban" ? (
                            <label className="field">
                              <span>Kanban grouping field</span>
                              <SearchableSelect value={report.view.kanbanField} options={fieldOptions} allowEmpty emptyOptionLabel="Select a field" onChange={(value) => updateImportedReviewReport(report.id, (current) => ({ ...current, view: { ...current.view, kanbanField: value } }))} />
                            </label>
                          ) : null}
                        </>
                      ) : null}
                    </article>
                  );
                })}
                {!importedReviewReports.length ? <div className="empty-hint">No imported reports are available to review.</div> : null}
              </div>
            </section>
          </div>
        ) : null}
        {createModalOpen ? (
          <div className="studio-modal-backdrop" onClick={() => setCreateModalOpen(false)}>
            <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <div>
                  <strong>{editingReportId ? "Edit Report" : `Create ${createDraft.type === "report" ? "Report" : "Dashboard"}`}</strong>
                  <div className="micro">{editingReportId ? "Update the report configuration here. Changes stay in the modal instead of moving into a side setup column." : "Start fresh with the same field, filter, and sorting controls from the legacy builder."}</div>
                </div>
                <button onClick={() => setCreateModalOpen(false)}>Close</button>
              </div>

              <div className="stack">
                <div className="builder-stepper">
                  {createSteps.map((step, index) => (
                    <button
                      key={step}
                      type="button"
                      className={`builder-step-button${step === activeCreateStep ? " active-tab" : ""}${createSteps.indexOf(activeCreateStep) > index ? " builder-step-complete" : ""}`}
                      onClick={() => setCreateStep(step)}
                    >
                      <span className="badge">{index + 1}</span>
                      <strong>{getStudioBuilderStepLabel(step)}</strong>
                    </button>
                  ))}
                </div>

                <div className="sync-status">
                  <strong>{getStudioBuilderStepLabel(activeCreateStep)}</strong>
                  <span>{getStudioBuilderStepDescription(activeCreateStep, createDraft.type)}</span>
                </div>

                {createStepIssues.length ? (
                  <div className="sync-status sync-status-warn">
                    <strong>Resolve before continuing</strong>
                    <ul className="flat-list import-review-list">
                      {createStepIssues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                ) : null}

                {activeCreateStep === "basics" ? (
                  <>
                    <div className="filter-grid compact-grid">
                      <label className="field">
                        <span>Type</span>
                        <select
                          value={createDraft.type}
                          onChange={(event) => {
                            const nextType = event.target.value as CreateModalType;
                            setCreateDraft(buildStudioBuilderDraft(bundle.tables[0] || null, nextType, currentUserId, uid));
                            setCreateStep(getStudioBuilderSteps(nextType)[0]);
                          }}
                        >
                          <option value="report">Report</option>
                          <option value="dashboard">Dashboard</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Name</span>
                        <input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} />
                      </label>
                    </div>
                    <label className="field">
                      <span>Description</span>
                      <input value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} />
                    </label>
                    <div className="card">
                      <div className="card-head">
                        <strong>Sharing</strong>
                        <span className="micro">Choose whether this object is shared with everyone or only visible for the active user.</span>
                      </div>
                      <label className="field">
                        <span>Scope</span>
                        <select
                          value={createDraft.scope}
                          onChange={(event) => setCreateDraft((current) => ({
                            ...current,
                            ...normalizeStudioBuilderScopeOwner(event.target.value as StudioObjectScope, currentUserId, current.ownerUserId)
                          }))}
                        >
                          <option value="global">Shared</option>
                          <option value="personal">Personal</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Owner</span>
                        <input
                          readOnly
                          value={createDraft.scope === "personal" ? (createDraft.ownerUserId || currentUserId || "No active user") : "Shared with everyone in this workspace"}
                        />
                      </label>
                    </div>
                  </>
                ) : null}

                {activeCreateStep === "data" && createDraft.type === "report" && createDraftTable ? (
                  <StudioReportDraftDataStep
                    tables={bundle.tables}
                    createDraft={createDraft}
                    createDraftTable={createDraftTable}
                    createFieldQuery={createFieldQuery}
                    setCreateFieldQuery={setCreateFieldQuery}
                    visibleCreateFields={visibleCreateFields}
                    chartValueLabelOptions={chartValueLabelOptions}
                    setCreateDraft={setCreateDraft}
                    updateCreateDraftTable={updateCreateDraftTable}
                  />
                ) : null}

                {activeCreateStep === "filters" && createDraft.type === "report" && createDraftTable ? (
                  <ReportFiltersAndSortsEditor
                    table={createDraftTable}
                    filterTree={createDraft.filterTree}
                    sorts={createDraft.sorts}
                    onChangeFilterTree={(filterTree) => setCreateDraft((current) => ({ ...current, filterTree }))}
                    onChangeSorts={(sorts) => setCreateDraft((current) => ({ ...current, sorts }))}
                  />
                ) : null}

                {activeCreateStep === "view" && createDraft.type === "report" && createDraftTable ? (
                  <StudioReportDraftViewStep
                    createDraft={createDraft}
                    createDraftTable={createDraftTable}
                    setCreateDraft={setCreateDraft}
                  />
                ) : null}

                {activeCreateStep === "layout" && createDraft.type === "dashboard" ? (
                  <>
                    <div className="card">
                      <div className="card-head">
                        <strong>Dashboard starter</strong>
                        <span className="micro">New dashboards start with one clean tab so you can keep layout work on the canvas after saving.</span>
                      </div>
                      <div className="summary-grid">
                        <div className="summary-card">
                          <strong>1</strong>
                          <span>Starter tab</span>
                        </div>
                        <div className="summary-card">
                          <strong>0</strong>
                          <span>Cards at creation</span>
                        </div>
                        <div className="summary-card">
                          <strong>Canvas first</strong>
                          <span>Add and arrange cards after save</span>
                        </div>
                      </div>
                    </div>
                    <div className="sync-status sync-status-ok">
                      <strong>What happens next</strong>
                      <span>After saving, the dashboard opens directly in Studio so you can add tabs, add cards to the active tab, resize them, and move or copy them across tabs from the selected-card inspector.</span>
                    </div>
                  </>
                ) : null}

                {activeCreateStep === "review" ? (
                  <StudioDraftReviewStep
                    createDraft={createDraft}
                    createDraftTable={createDraftTable}
                    createDraftIssues={createDraftIssues}
                    filterCount={createDraftFilterCount}
                    previewReport={createDraftPreviewReport}
                    previewResult={createDraftPreview}
                    currentPreviewPage={createPreviewPage}
                    onPreviewPageChange={setCreatePreviewPage}
                  />
                ) : null}

                <div className="studio-actions modal-actions">
                  {createSteps.indexOf(activeCreateStep) > 0 ? (
                    <button type="button" className="ghost-button" onClick={() => setCreateStep(createSteps[Math.max(0, createSteps.indexOf(activeCreateStep) - 1)])}>
                      Back
                    </button>
                  ) : null}
                  {activeCreateStep !== "review" ? (
                    <button
                      type="button"
                      onClick={() => setCreateStep(createSteps[Math.min(createSteps.length - 1, createSteps.indexOf(activeCreateStep) + 1)])}
                      disabled={createStepIssues.length > 0}
                    >
                      Next
                    </button>
                  ) : (
                    <button onClick={createFromDraft} disabled={createDraftIssues.length > 0}>
                      {editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {drawer ? (
          <div className={drawer === "settings" ? "studio-modal-backdrop" : "studio-drawer-backdrop"} onClick={() => setDrawer(null)}>
            <section className={drawer === "settings" ? "studio-modal studio-settings-modal" : "studio-drawer"} onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <strong>{drawer === "settings" ? "System Settings" : drawer === "share" ? "Share" : drawer === "templates" ? "Templates" : drawer === "export" ? "Export" : "History"}</strong>
                <button onClick={() => setDrawer(null)}>Close</button>
              </div>

              {drawer === "settings" ? (
                <StudioSettingsPanel
                  documentState={documentState}
                  activeQuickbaseProfile={activeQuickbaseProfile}
                  activeQuickbaseConfig={activeQuickbaseConfig}
                  activeProfileTables={activeProfileTables}
                  savedRowsForApp={savedRowsForApp}
                  refreshStatusTitle={refreshStatusTitle}
                  refreshStatusDetail={refreshStatusDetail}
                  realmApps={realmApps}
                  realmAppsLoading={realmAppsLoading}
                  quickbaseSchema={quickbaseSchema}
                  quickbaseSchemaLoading={quickbaseSchemaLoading}
                  savingRemote={savingRemote}
                  refreshingCache={refreshingCache}
                  lastQuickbaseSync={lastQuickbaseSync}
                  weekdayOptions={WEEKDAY_OPTIONS}
                  timezoneOptions={TIMEZONE_OPTIONS}
                  applyDocumentUpdate={applyDocumentUpdate}
                  setActiveQuickbaseProfile={setActiveQuickbaseProfile}
                  updateQuickbaseProfileLabel={updateQuickbaseProfileLabel}
                  updateQuickbaseProfileLiveMode={updateQuickbaseProfileLiveMode}
                  addQuickbaseProfile={addQuickbaseProfile}
                  removeQuickbaseProfile={removeQuickbaseProfile}
                  updateQuickbaseField={updateQuickbaseField}
                  applyQuickbaseAppSelection={applyQuickbaseAppSelection}
                  loadRealmApps={loadRealmApps}
                  loadQuickbaseMetadata={() => loadQuickbaseMetadata()}
                  autoDetectQuickbaseMappings={autoDetectQuickbaseMappings}
                  updateRefreshScheduleField={updateRefreshScheduleField}
                  updateRefreshSourceTables={updateRefreshSourceTables}
                  updateRefreshSourceReportId={updateRefreshSourceReportId}
                  saveRemote={saveRemote}
                  refreshAllNow={refreshAllNow}
                  reloadRemote={reloadRemote}
                />
              ) : null}

              {drawer === "share" ? (
                <div className="stack">
                  <label className="field"><span>Default URL</span><input readOnly value={defaultUrl} /></label>
                  <label className="field"><span>Viewer URL</span><input readOnly value={viewerUrl} /></label>
                  <label className="field"><span>Embed URL</span><input readOnly value={embedUrl} /></label>
                </div>
              ) : null}

              {drawer === "templates" ? (
                <div className="stack">
                  <div className="studio-actions">
                    <button onClick={() => addTemplate("layout")}>Save layout template</button>
                    <button onClick={() => addTemplate("yaml")}>Save report template</button>
                    <button onClick={() => addTemplate("upload")}>Save upload mapping</button>
                  </div>
                  {[...documentState.templates.layouts, ...documentState.templates.yaml, ...documentState.templates.upload].map((template) => (
                    <div className="card" key={template.id}>
                      <div className="card-head">
                        <strong>{template.name}</strong>
                        <span className="micro">{template.type}</span>
                      </div>
                      {template.columnMap ? <div className="micro">{Object.entries(template.columnMap).map(([key, value]) => `${key} -> ${value}`).join(", ")}</div> : null}
                      {template.object ? <button onClick={() => applyTemplate(template)}>Apply template</button> : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {drawer === "export" ? (
                <div className="stack">
                  <div className="studio-actions">
                    <button onClick={exportWorkbook}>Download Excel file</button>
                    <button onClick={exportJson}>Download JSON file</button>
                    <button onClick={() => { void refreshExportJobs(); }}>Refresh status</button>
                  </div>
                  <div className="stack-compact">
                    {mergedExportJobs.map((job) => {
                      const matchingLiveJob = job.sourceJobId ? liveExportJobs.find((item) => item.id === job.sourceJobId) : null;
                      const object = bundle.objects[job.objectId];
                      return (
                        <div className="card" key={job.id}>
                          <div className="card-head">
                            <strong>{object?.name || job.objectId}</strong>
                            <span className="micro">{job.format} · {job.status}</span>
                          </div>
                          <div className="micro">{new Date(job.createdAt).toLocaleString()}</div>
                          <div className="micro">{job.message}{job.error ? ` · ${job.error}` : ""}</div>
                          {job.format === "xlsx" ? (
                            <div className="progress-meter" aria-hidden="true">
                              <div className="progress-meter-fill" style={{ width: `${job.progress}%` }} />
                            </div>
                          ) : null}
                          <div className="studio-actions">
                            {job.format === "xlsx" && matchingLiveJob?.status === "complete" && job.sourceJobId ? (
                              <button onClick={() => downloadExportJob(job.sourceJobId || "")}>Download again</button>
                            ) : null}
                            {job.format === "xlsx" ? (
                              <button onClick={() => { void retryExportJob(job); }}>
                                {job.status === "failed" ? "Retry" : "Run again"}
                              </button>
                            ) : null}
                            {job.format === "json" ? <button onClick={exportJson}>Download again</button> : null}
                          </div>
                        </div>
                      );
                    })}
                    {!mergedExportJobs.length ? <div className="empty">No exports yet.</div> : null}
                  </div>
                </div>
              ) : null}

              {drawer === "versions" ? (
                <div className="stack">
                  <div className="studio-actions">
                    <button onClick={snapshotCurrentObject}>Save current version</button>
                  </div>
                  {versionList.length ? versionList.map((version) => (
                    <div className="card" key={version.id}>
                      <div className="card-head">
                        <strong>{version.label}</strong>
                        <span className="micro">{new Date(version.savedAt).toLocaleString()}</span>
                      </div>
                      <button onClick={() => restoreVersion(version.id)}>Restore this version</button>
                    </div>
                  )) : <div className="empty">No saved versions yet.</div>}
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </>
    );
  }

  if (!activeObject && !visibleObjects.length) {
    return (
      <>
        {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
          <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} />
        ) : null}
        <section className="studio-page studio-page-empty">
          <StudioWorkspaceEmptyState
            loadingRemote={loadingRemote}
            lastSavedAt={documentState.sync.lastSavedAt}
            savingRemote={savingRemote}
            xlsxImporting={xlsxImporting}
            onSave={saveRemote}
            onCreateReport={() => openCreateModal("report")}
            onCreateDashboard={() => openCreateModal("dashboard")}
            onImportXlsx={() => importXlsxInputRef.current?.click()}
            onUseTemplate={() => setDrawer("templates")}
          />
        </section>
        {renderStudioOverlays()}
      </>
    );
  }

  if (!activeObject) {
    return (
      <>
        {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
          <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} />
        ) : null}
        <section className="studio-page studio-page-home">
          <StudioWorkspaceHome
            loadingRemote={loadingRemote}
            lastSavedAt={documentState.sync.lastSavedAt}
            savingRemote={savingRemote}
            xlsxImporting={xlsxImporting}
            libraryQuery={libraryQuery}
            onLibraryQueryChange={setLibraryQuery}
            libraryFilter={libraryFilter}
            onLibraryFilterChange={setLibraryFilter}
            libraryScopeFilter={libraryScopeFilter}
            onLibraryScopeFilterChange={setLibraryScopeFilter}
            favoritesOnly={favoritesOnly}
            onFavoritesOnlyChange={setFavoritesOnly}
            recentOnly={recentOnly}
            onRecentOnlyChange={setRecentOnly}
            hasPersonalObjects={visibleObjects.some((object) => object.scope === "personal")}
            filteredObjects={filteredObjects}
            selectedReportIds={selectedHomeReportIds}
            templates={[...documentState.templates.layouts, ...documentState.templates.yaml]}
            openLinksInNewTab={openLinksInNewTab}
            onSave={saveRemote}
            onOpenSettings={() => setDrawer("settings")}
            onCreateReport={() => openCreateModal("report")}
            onCreateDashboard={() => openCreateModal("dashboard")}
            onImportXlsx={() => importXlsxInputRef.current?.click()}
            onUseTemplate={() => setDrawer("templates")}
            onApplyTemplate={applyTemplate}
            onToggleReportSelection={toggleHomeReportSelection}
            onSelectAllVisibleReports={selectAllVisibleHomeReports}
            onClearReportSelection={clearHomeReportSelection}
            onDeleteSelectedReports={deleteSelectedHomeReports}
          />
          <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleImportJson} />
          <input ref={importXlsxInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={handleImportXlsx} />
        </section>
        {renderStudioOverlays()}
      </>
    );
  }

  const defaultUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/${activeObject.type}/${activeObject.id}`;
  const viewerUrl = `${window.location.origin}${import.meta.env.BASE_URL}?mode=viewer#/${activeObject.type}/${activeObject.id}`;
  const embedUrl = `${window.location.origin}${import.meta.env.BASE_URL}?embed=1&mode=viewer#/${activeObject.type}/${activeObject.id}`;

  return (
    <>
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} />
      ) : null}
      <section className={`studio-page ${activeDashboard ? "studio-page-dashboard" : "studio-page-report"}`}>
      <div className="studio-canvas">
        <div className="hero studio-hero">
          <div>
            <span className="badge brand">{hasActiveObject ? typeLabel(activeObject.type) : "Workspace"}</span>
            <h1>{activeObject.name}</h1>
            <p>{activeObject.description || "Build, save, share, and export reports and dashboards from one workspace."}</p>
            <div className="micro-row">
              <span>{loadingRemote ? "Loading saved workspace…" : hasActiveObject ? "Saved workspace loaded" : "Workspace ready"}</span>
              <span>{documentState.sync.lastSavedAt ? `Last saved ${new Date(documentState.sync.lastSavedAt).toLocaleString()}` : "Not saved yet"}</span>
            </div>
          </div>
          <div className="link-toolbar">
            <Link className="ghost-button" to={buildHostedRoute("/studio")}>Back to Building home</Link>
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
            {!hasActiveObject ? <button onClick={() => openCreateModal("report")}>Create report</button> : null}
            {!hasActiveObject ? <button onClick={() => openCreateModal("dashboard")}>Create dashboard</button> : null}
            {!hasActiveObject ? <button onClick={() => importXlsxInputRef.current?.click()} disabled={xlsxImporting}>{xlsxImporting ? "Importing xlsx…" : "Import xlsx"}</button> : null}
            {activeReport ? <button onClick={() => openEditReportModal(activeReport)}>Edit report</button> : null}
            {activeReport ? <button onClick={() => deleteObject(activeReport.id)}>Delete report</button> : null}
            {hasActiveObject ? <button onClick={() => toggleFavorite(activeObject.id)}>{documentState.favorites.includes(activeObject.id) ? "Unfavorite" : "Favorite"}</button> : null}
            {hasActiveObject ? <button onClick={() => cloneObject(activeObject)}>Clone</button> : null}
            <button onClick={undo} disabled={!history.length}>Undo</button>
            <button onClick={redo} disabled={!future.length}>Redo</button>
            {hasActiveObject ? <button onClick={() => setDrawer("share")}>Share</button> : null}
            {hasActiveObject ? <button onClick={() => setDrawer("export")}>Export</button> : null}
            {hasActiveObject ? <button onClick={openVersions}>History</button> : null}
          </div>
        </div>

        {exportJob ? (
          <section className={`sync-status ${exportJob.status === "failed" ? "sync-status-warn" : exportJob.status === "complete" ? "sync-status-ok" : ""}`}>
            <strong>
              {exportJob.status === "complete"
                ? "Export ready"
                : exportJob.status === "failed"
                  ? "Export failed"
                  : `Exporting ${exportJob.progress}%`}
            </strong>
            <span>{exportJob.error || exportJob.message}</span>
            <div className="progress-meter" aria-hidden="true">
              <div className="progress-meter-fill" style={{ width: `${exportJob.progress}%` }} />
            </div>
          </section>
        ) : null}

        {validation.length ? (
          <section className="card validation-card">
            <div className="card-head">
              <strong>Validation</strong>
              <span className="micro">{validation.length} issue(s)</span>
            </div>
            <ul className="flat-list">
              {validation.map((message) => <li key={message}>{message}</li>)}
            </ul>
          </section>
        ) : null}

        {lastWorkbookImportReview && !activeObject ? (
          <section className="card import-review-card">
            <div className="card-head">
              <div>
                <strong>Last Workbook Import</strong>
                <div className="micro">
                  {lastWorkbookImportReview.workbookName} · {lastWorkbookImportReview.importedSheetCount} imported · {lastWorkbookImportReview.skippedSheetCount} skipped · {new Date(lastWorkbookImportReview.importedAt).toLocaleString()}
                </div>
              </div>
              <div className="studio-actions">
                <button type="button" onClick={() => setImportReviewModalOpen(true)}>Review imported reports</button>
                <Link className="ghost-button" to={buildHostedRoute("/help")}>Open manual</Link>
                <button type="button" onClick={() => {
                  setLastWorkbookImportReview(null);
                  setLastWorkbookImportObjectIds([]);
                  setImportReviewModalOpen(false);
                }}
                >
                  Dismiss
                </button>
              </div>
            </div>
            <div className="summary-grid">
              <div className="summary-card">
                <strong>{importedReviewReports.length}</strong>
                <span>Imported reports</span>
              </div>
              <div className="summary-card">
                <strong>{importedReviewDashboardCount}</strong>
                <span>Dashboard candidates</span>
              </div>
              <div className="summary-card">
                <strong>{lastWorkbookImportReview.sheets.filter((sheet) => sheet.status === "skipped").length}</strong>
                <span>Skipped sections</span>
              </div>
            </div>
            <div className="sync-status">
              <strong>Review imported reports in the modal</strong>
              <span>The review modal is organized by report so you can confirm field matches and fix any selected fields or chart fields without sorting through worksheet internals.</span>
            </div>
          </section>
        ) : null}

        {activeReport && activeTable && (reportResult || liveReportLoading) ? (
          <section className="surface stack studio-report-preview-panel">
            <div className="card-head">
              <strong>Report Preview</strong>
              <span className="micro">
                {liveReportLoading && !reportResult ? "Loading live Quickbase data…" : `${reportResult?.totalRows || 0} rows · ${activeTable.name}`}
              </span>
            </div>
            {reportResult ? (
              <>
                {reportShowsSummary(activeReport) ? (
                  <div className="summary-grid">
                    {reportResult.summary.map((item) => (
                      <div className="summary-card" key={item.label}>
                        <strong>{item.value}</strong>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {reportResult.warnings.length ? (
                  <div className="sync-status sync-status-warn">
                    <strong>Report warnings</strong>
                    <ul className="flat-list import-review-list">
                      {reportResult.warnings.map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
                <StudioReportPreview
                  report={activeReport}
                  table={activeTable}
                  result={reportResult}
                  currentPage={previewPage}
                  onPageChange={setPreviewPage}
                />
              </>
            ) : (
              <div className="empty-hint">Loading live Quickbase rows for this report.</div>
            )}
          </section>
        ) : null}

        {activeDashboard && dashboardResult ? (
          <section className="surface stack studio-dashboard-preview-panel">
                <div className="card-head">
                  <strong>Dashboard Preview</strong>
                  <span className="micro">{activeDashboard.tabs.length} tabs</span>
                </div>
                {dashboardResult.tabs.some((tab) => tab.widgets.some((widget) => widget.status === "failed" || widget.result.warnings.length)) ? (
                  <div className="sync-status sync-status-warn">
                    <strong>Dashboard warnings</strong>
                    <ul className="flat-list import-review-list">
                      {dashboardResult.tabs.flatMap((tab) =>
                        tab.widgets.flatMap((widget) => [
                          ...(widget.status === "failed" ? [`${tab.name} / ${widget.widget.title || widget.report.name}: ${widget.error || widget.message}`] : []),
                          ...widget.result.warnings.map((warning) => `${tab.name} / ${widget.widget.title || widget.report.name}: ${warning}`)
                        ])
                      ).map((warning) => <li key={warning}>{warning}</li>)}
                    </ul>
                  </div>
                ) : null}
                <div className="filter-grid compact-grid">
                  <label className="field">
                    <span>Card search</span>
                    <input
                      id="studio-widget-search"
                      name="studioWidgetSearch"
                      value={widgetSearch}
                      onChange={(event) => setWidgetSearch(event.target.value)}
                      placeholder="Find cards or reports"
                    />
                  </label>
                </div>
            <div className="studio-tab-strip">
              {activeDashboard.tabs.map((tab) => (
                <button key={tab.id} className={tab.id === activeTabId ? "active-tab" : ""} onClick={() => setActiveTabId(tab.id)}>{tab.name}</button>
              ))}
            </div>
            <StudioDashboardPreview
              dashboard={{ ...activeDashboard, tabs: activeDashboard.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
              result={{ ...dashboardResult, tabs: dashboardResult.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
              tables={bundle.tables}
              runtimeValues={runtimeValues}
              setRuntimeValues={setRuntimeValues}
              widgetSearch={widgetSearch}
              selectedWidgetId={selectedWidgetId}
              draggingWidget={draggingWidget}
              onSelectWidget={(tabId, widgetId) => {
                setActiveTabId(tabId);
                setSelectedWidgetId(widgetId);
              }}
              onOpenReport={(reportId) => {
                if (openLinksInNewTab) {
                  window.open(`${window.location.origin}${import.meta.env.BASE_URL}#/studio/${reportId}`, "_blank", "noopener,noreferrer");
                  return;
                }
                navigate(buildHostedRoute(`/studio/${reportId}`));
              }}
              onStartWidgetDrag={(tabId, widgetId) => setDraggingWidget({ tabId, widgetId })}
              onEndWidgetDrag={() => setDraggingWidget(null)}
              onDropWidget={(tabId, widgetId, position: DashboardWidgetDropPosition) => {
                if (draggingWidget?.tabId === tabId) {
                  writeObject(reorderDashboardWidgetByDropPositionInDefinition(activeDashboard, tabId, draggingWidget.widgetId, widgetId, position));
                }
                setDraggingWidget(null);
              }}
              onDropWidgetToRow={(tabId, rowIndex, edge) => {
                if (draggingWidget?.tabId === tabId) {
                  writeObject(reorderDashboardWidgetToRowEdgeInDefinition(activeDashboard, tabId, draggingWidget.widgetId, rowIndex, edge));
                }
                setDraggingWidget(null);
              }}
              onDropWidgetToTabEnd={(tabId) => {
                if (draggingWidget?.tabId === tabId) {
                  const tab = activeDashboard.tabs.find((item) => item.id === tabId);
                  writeObject(reorderDashboardWidgetToIndexInDefinition(activeDashboard, tabId, draggingWidget.widgetId, tab?.widgets.length || 0));
                }
                setDraggingWidget(null);
              }}
              onDropWidgetToGridPosition={(tabId, position) => {
                if (draggingWidget?.tabId === tabId) {
                  placeDashboardWidget(tabId, draggingWidget.widgetId, position);
                }
                setDraggingWidget(null);
              }}
              onToggleFullWidth={toggleDashboardWidgetFullWidth}
              onBeginResizeWidget={beginWidgetResize}
              onMoveWidget={moveDashboardWidget}
            />
          </section>
        ) : null}
      </div>

      {activeDashboard ? (
        <aside className="studio-inspector">
          <div className="surface stack">
            <div className="studio-section-head">
              <div>
                <div className="eyebrow">Inspector</div>
                <h2>Dashboard Setup</h2>
              </div>
              <button onClick={() => deleteObject(activeDashboard.id)}>Delete</button>
            </div>
            <div className="studio-tab-strip">
              {["design", "filters"].map((tab) => <button key={tab} className={dashboardInspectorTab === tab ? "active-tab" : ""} onClick={() => setDashboardInspectorTab(tab as typeof dashboardInspectorTab)}>{tab}</button>)}
            </div>
            {dashboardInspectorTab === "design" ? (
              <>
                <label className="field"><span>Name</span><input value={activeDashboard.name} onChange={(event) => updateObject({ ...activeDashboard, name: event.target.value })} /></label>
                <label className="field"><span>Description</span><input value={activeDashboard.description} onChange={(event) => updateObject({ ...activeDashboard, description: event.target.value })} /></label>
                <div className="card">
                  <div className="card-head">
                    <strong>Sharing</strong>
                    <span className="micro">Shared dashboards appear in the global library. Personal dashboards stay private to the current session user.</span>
                  </div>
                  <label className="field">
                    <span>Scope</span>
                    <select
                      value={activeDashboard.scope}
                      onChange={(event) => updateObject({
                        ...activeDashboard,
                        ...normalizeStudioBuilderScopeOwner(event.target.value as StudioObjectScope, currentUserId, activeDashboard.ownerUserId)
                      })}
                    >
                      <option value="global">Shared</option>
                      <option value="personal">Personal</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>Owner</span>
                    <input
                      readOnly
                      value={activeDashboard.scope === "personal" ? (activeDashboard.ownerUserId || currentUserId || "No active user") : "Shared with everyone in this workspace"}
                    />
                  </label>
                </div>
                <div className="card">
                  <div className="card-head">
                    <strong>Tabs</strong>
                    <button
                      onClick={() => {
                        const nextTab = { id: uid("tab"), name: `Tab ${activeDashboard.tabs.length + 1}`, widgets: [] };
                        updateObject({ ...activeDashboard, tabs: [...activeDashboard.tabs, nextTab] });
                        setActiveTabId(nextTab.id);
                      }}
                    >
                      Add tab
                    </button>
                  </div>
                  <div className="studio-tab-strip">
                    {activeDashboard.tabs.map((tab) => (
                      <button key={tab.id} className={tab.id === activeDashboardTab?.id ? "active-tab" : ""} onClick={() => setActiveTabId(tab.id)}>
                        {tab.name}
                      </button>
                    ))}
                  </div>
                </div>
                {activeDashboardTab ? (
                  <div className="card">
                    <div className="card-head">
                      <strong>{activeDashboardTab.name}</strong>
                      <div className="studio-actions">
                        <button onClick={() => balanceActiveDashboardTab(activeDashboardTab.id)}>Balance tab</button>
                        <button onClick={balanceAllDashboardTabs}>Balance dashboard</button>
                        <button
                          disabled={activeDashboard.tabs.length <= 1}
                          onClick={() => {
                            const remainingTabs = activeDashboard.tabs.filter((item) => item.id !== activeDashboardTab.id);
                            updateObject({ ...activeDashboard, tabs: remainingTabs });
                            setActiveTabId(remainingTabs[0]?.id || "");
                          }}
                        >
                          Remove
                        </button>
                        <button
                          disabled={activeDashboard.tabs.findIndex((item) => item.id === activeDashboardTab.id) === 0}
                          onClick={() => {
                            const tabIndex = activeDashboard.tabs.findIndex((item) => item.id === activeDashboardTab.id);
                            if (tabIndex <= 0) return;
                            const nextTabs = [...activeDashboard.tabs];
                            const currentTab = nextTabs[tabIndex];
                            nextTabs[tabIndex] = nextTabs[tabIndex - 1];
                            nextTabs[tabIndex - 1] = currentTab;
                            updateObject({ ...activeDashboard, tabs: nextTabs });
                          }}
                        >
                          Up
                        </button>
                      </div>
                    </div>
                    <label className="field"><span>Tab name</span><input value={activeDashboardTab.name} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === activeDashboardTab.id ? { ...item, name: event.target.value } : item) })} /></label>
                    <div className="card widget-picker-card">
                      <div className="card-head">
                        <strong>Cards on this tab</strong>
                        <div className="studio-actions">
                          <span className="micro">{activeDashboardTab.widgets.length} total</span>
                          <button
                            type="button"
                            onClick={() => {
                              const report = objects.find((object): object is ReportDefinition => object.type === "report");
                              if (!report) return;
                              addDashboardWidget(activeDashboardTab.id, report.id, selectedDashboardWidget?.id);
                            }}
                          >
                            Add card
                          </button>
                        </div>
                      </div>
                      <div className="widget-picker-list">
                        {activeDashboardTab.widgets.filter((widget) => !widgetSearch || `${widget.title} ${widget.reportId}`.toLowerCase().includes(widgetSearch.toLowerCase())).map((widget) => (
                          <button
                            type="button"
                            className={`widget-picker-button${selectedDashboardWidget?.id === widget.id ? " active-card" : ""}`}
                            key={widget.id}
                            onClick={() => setSelectedWidgetId(widget.id)}
                          >
                            <strong>{widget.title || "Untitled card"}</strong>
                            <span>{widget.reportId}</span>
                          </button>
                        ))}
                        {!activeDashboardTab.widgets.filter((widget) => !widgetSearch || `${widget.title} ${widget.reportId}`.toLowerCase().includes(widgetSearch.toLowerCase())).length ? (
                          <div className="empty-hint">No cards match this search.</div>
                        ) : null}
                      </div>
                    </div>
                    {selectedDashboardWidget ? (
                      <div className="widget-edit-card">
                        <div className="card-head">
                          <strong>Selected card</strong>
                          <span className="micro">{selectedDashboardWidget.title || selectedDashboardWidget.reportId}</span>
                        </div>
                        <label className="field"><span>Title</span><input value={selectedDashboardWidget.title} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({ ...candidate, title: event.target.value }))} /></label>
                        <div className="widget-editor-grid">
                          <label className="field">
                            <span>Report</span>
                            <SearchableSelect value={selectedDashboardWidget.reportId} options={reportObjectOptions} onChange={(value) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({ ...candidate, reportId: value, snapshot: undefined, mode: "linked" }))} />
                          </label>
                          <label className="field">
                            <span>Connection</span>
                            <select value={selectedDashboardWidget.mode} onChange={(event) => {
                              const report = bundle.objects[selectedDashboardWidget.reportId] as ReportDefinition | undefined;
                              updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({
                                ...candidate,
                                mode: event.target.value as "linked" | "copied",
                                snapshot: event.target.value === "copied" && report ? clone(report) : undefined
                              }));
                            }}>
                              <option value="linked">Live report</option>
                              <option value="copied">Saved copy</option>
                            </select>
                          </label>
                          <label className="field">
                            <span>Display</span>
                            <select value={selectedDashboardWidget.displayMode} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({ ...candidate, displayMode: event.target.value as "inherit" | "table" | "summary" | "chart" }))}>
                              <option value="inherit">Inherit report view</option>
                              <option value="table">Table only</option>
                              <option value="summary">Summary only</option>
                              <option value="chart">Chart/graph</option>
                            </select>
                          </label>
                          {selectedDashboardWidget.mode !== "copied" && selectedDashboardWidgetReport ? (
                            <div className="field">
                              <span>Edit linked report</span>
                              <button
                                type="button"
                                onClick={() => navigate(buildHostedRoute(`/studio/${selectedDashboardWidgetReport.id}`))}
                              >
                                Open report setup
                              </button>
                            </div>
                          ) : null}
                          <label className="toggle-row"><input type="checkbox" checked={selectedDashboardWidget.showSummary} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({ ...candidate, showSummary: event.target.checked }))} /> Show summary</label>
                          <label className="toggle-row"><input type="checkbox" checked={selectedDashboardWidget.showDetails} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (candidate) => ({ ...candidate, showDetails: event.target.checked }))} /> Show details</label>
                          <label className="toggle-row"><input type="checkbox" checked={clampDashboardWidgetWidth(selectedDashboardWidget.layout.w) >= 12} onChange={() => toggleDashboardWidgetFullWidth(activeDashboardTab.id, selectedDashboardWidget.id)} /> Full width</label>
                          <label className="field-inline"><span>Width</span><input type="number" min="1" max="12" value={selectedDashboardWidget.layout.w} onChange={(event) => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, { w: Number(event.target.value), h: selectedDashboardWidget.layout.h })} /></label>
                          <label className="field-inline"><span>Height</span><input type="number" min="2" max="10" value={selectedDashboardWidget.layout.h} onChange={(event) => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, { w: selectedDashboardWidget.layout.w, h: Number(event.target.value) })} /></label>
                          <label className="field-inline"><span>X</span><input type="number" min="1" max="12" value={selectedDashboardWidget.layout.x || 1} onChange={(event) => placeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, { x: Number(event.target.value), y: selectedDashboardWidget.layout.y || 1 })} /></label>
                          <label className="field-inline"><span>Y</span><input type="number" min="1" max="99" value={selectedDashboardWidget.layout.y || 1} onChange={(event) => placeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, { x: selectedDashboardWidget.layout.x || 1, y: Number(event.target.value) })} /></label>
                        </div>
                        <div className="widget-layout-presets">
                          {WIDGET_LAYOUT_PRESETS.map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              className={`widget-layout-preset-button${clampDashboardWidgetWidth(selectedDashboardWidget.layout.w) === preset.w && clampDashboardWidgetHeight(selectedDashboardWidget.layout.h) === preset.h ? " active-card" : ""}`}
                              onClick={() => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, preset)}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>
                        {selectedDashboardRow ? (
                          <div className="card">
                            <div className="card-head">
                              <strong>Selected row</strong>
                              <span className="micro">Row {selectedDashboardRow.rowIndex + 1} · {selectedDashboardRow.widgetIds.length} cards · {selectedDashboardRow.remainingColumns} open columns</span>
                            </div>
                            <div className="widget-layout-presets">
                              <button type="button" onClick={() => balanceDashboardRow(activeDashboardTab.id, selectedDashboardRow.rowIndex)}>
                                Balance row
                              </button>
                              {selectedDashboardRow.widgetIds.length <= 3 ? (
                                <>
                                  <button type="button" onClick={() => applyDashboardRowPreset(activeDashboardTab.id, selectedDashboardRow.rowIndex, "equal")}>
                                    Split evenly
                                  </button>
                                  {selectedDashboardRow.widgetIds.length >= 2 ? (
                                    <>
                                      <button type="button" onClick={() => applyDashboardRowPreset(activeDashboardTab.id, selectedDashboardRow.rowIndex, "wide-left")}>
                                        Emphasize first
                                      </button>
                                      <button type="button" onClick={() => applyDashboardRowPreset(activeDashboardTab.id, selectedDashboardRow.rowIndex, "wide-right")}>
                                        Emphasize last
                                      </button>
                                    </>
                                  ) : null}
                                </>
                              ) : null}
                            </div>
                            <div className="micro">Row presets apply to the current row only and keep the rest of the tab intact.</div>
                          </div>
                        ) : null}
                        {activeDashboard.tabs.length > 1 ? (
                          <div className="widget-tab-actions">
                            <label className="field">
                              <span>Target tab</span>
                              <select value={widgetTargetTabId} onChange={(event) => setWidgetTargetTabId(event.target.value)}>
                                {activeDashboard.tabs.map((tab) => (
                                  <option key={tab.id} value={tab.id}>
                                    {tab.name}{tab.id === activeDashboardTab.id ? " (current)" : ""}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="widget-edit-actions">
                              <button
                                type="button"
                                disabled={!widgetTargetTabId || widgetTargetTabId === activeDashboardTab.id}
                                onClick={() => copyDashboardWidgetToTab(activeDashboardTab.id, selectedDashboardWidget.id, widgetTargetTabId)}
                              >
                                Copy to tab
                              </button>
                              <button
                                type="button"
                                disabled={!widgetTargetTabId || widgetTargetTabId === activeDashboardTab.id}
                                onClick={() => moveDashboardWidgetToTab(activeDashboardTab.id, selectedDashboardWidget.id, widgetTargetTabId)}
                              >
                                Move to tab
                              </button>
                            </div>
                          </div>
                        ) : null}
                        <div className="widget-edit-actions">
                          <button onClick={() => balanceActiveDashboardTab(activeDashboardTab.id)}>Balance tab</button>
                          <button onClick={balanceAllDashboardTabs}>Balance dashboard</button>
                          <button onClick={() => moveDashboardWidgetByRow(activeDashboardTab.id, selectedDashboardWidget.id, "up")}>Move up a row</button>
                          <button onClick={() => moveDashboardWidgetByRow(activeDashboardTab.id, selectedDashboardWidget.id, "down")}>Move down a row</button>
                          <button onClick={() => moveDashboardWidgetToRowEdge(activeDashboardTab.id, selectedDashboardWidget.id, "start")}>Move to row start</button>
                          <button onClick={() => moveDashboardWidgetToRowEdge(activeDashboardTab.id, selectedDashboardWidget.id, "end")}>Move to row end</button>
                          <button onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "left")}>Move left</button>
                          <button onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "right")}>Move right</button>
                          <button onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "up")}>Move up</button>
                          <button onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "down")}>Move down</button>
                          <button onClick={() => moveDashboardWidgetToEdge(activeDashboardTab.id, selectedDashboardWidget.id, "start")}>Move to top</button>
                          <button onClick={() => moveDashboardWidgetToEdge(activeDashboardTab.id, selectedDashboardWidget.id, "end")}>Move to bottom</button>
                          <button onClick={() => duplicateDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id)}>Duplicate</button>
                          <button onClick={() => toggleDashboardWidgetFullWidth(activeDashboardTab.id, selectedDashboardWidget.id)}>
                            {clampDashboardWidgetWidth(selectedDashboardWidget.layout.w) >= 12 ? "Restore width" : "Make full width"}
                          </button>
                          <button onClick={() => removeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id)}>Remove card</button>
                        </div>
                      </div>
                    ) : (
                      <div className="empty-hint">Select a card on the canvas or in the list to edit it.</div>
                    )}
                    <div className="micro">New cards are inserted after the current selection so placement stays tied to the active canvas context.</div>
                  </div>
                ) : null}
                {activeDashboardRefreshTables.length ? (
                  <div className="card">
                    <div className="card-head">
                      <strong>Source report overrides</strong>
                      <span className="micro">Optional dashboard-only Quickbase source reports. Leave blank to use each app default.</span>
                    </div>
                    <div className="stack-compact">
                      {activeDashboardRefreshTables.map((table) => {
                        const tableKey = table.quickbaseTableId || table.id;
                        return (
                          <label className="field" key={table.id}>
                            <span>{table.name}</span>
                            <input
                              value={activeDashboard.sourceReportOverrides?.[tableKey] || ""}
                              onChange={(event) => updateObject({
                                ...activeDashboard,
                                sourceReportOverrides: event.target.value.trim()
                                  ? { ...(activeDashboard.sourceReportOverrides || {}), [tableKey]: event.target.value.trim() }
                                  : Object.fromEntries(Object.entries(activeDashboard.sourceReportOverrides || {}).filter(([key]) => key !== tableKey))
                              })}
                              placeholder="Optional Quickbase report ID for this dashboard"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </>
            ) : null}
            {dashboardInspectorTab === "filters" ? (
              <>
                <div className="stack-compact">
                  {activeDashboard.runtimeFilters.map((filter) => (
                    <div className="card" key={filter.id}>
                      <div className="card-head">
                        <strong>{filter.label}</strong>
                        <button onClick={() => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.filter((item) => item.id !== filter.id) })}>Remove</button>
                      </div>
                      <label className="field"><span>Label</span><input value={filter.label} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, label: event.target.value } : item) })} /></label>
                      <label className="field"><span>Field</span><SearchableSelect value={filter.fieldId} options={dashboardFieldOptions} onChange={(value) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, fieldId: value } : item) })} /></label>
                      <label className="field"><span>Mode</span><select value={filter.mode} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, mode: event.target.value as "global" | "selected" } : item) })}><option value="global">global</option><option value="selected">selected</option></select></label>
                      <label className="field"><span>Default value</span><input value={filter.defaultValue} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, defaultValue: event.target.value } : item) })} /></label>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeDashboard, runtimeFilters: [...activeDashboard.runtimeFilters, { id: uid("runtime"), label: "New filter", fieldId: bundle.tables[0]?.fields[0]?.id || "", mode: "global", targetReportIds: [], defaultValue: "" }] })}>Add runtime filter</button>
              </>
            ) : null}
          </div>

        <div className="surface stack">
          <div className="card-head">
            <strong>Shortcuts</strong>
            <span className="micro">Open, share, save, and export this workspace.</span>
          </div>
          <div className="nav-list">
            <Link className="nav-card" to={buildHostedRoute(`/${activeObject.type}/${activeObject.id}`)} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
              <span className="badge">Full screen</span>
              <strong>Open full-screen view</strong>
              <span className="micro">{defaultUrl}</span>
            </Link>
          </div>
          <div className="studio-actions">
            <button onClick={() => addTemplate(activeObject.type === "dashboard" ? "layout" : "yaml")}>Save as template</button>
            <button onClick={snapshotCurrentObject}>Save version</button>
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to server"}</button>
          </div>
        </div>
        </aside>
      ) : null}

      {createModalOpen ? (
        <div className="studio-modal-backdrop" onClick={() => setCreateModalOpen(false)}>
          <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
            <div className="card-head">
              <div>
                <strong>{editingReportId ? "Edit Report" : `Create ${createDraft.type === "report" ? "Report" : "Dashboard"}`}</strong>
                <div className="micro">{editingReportId ? "Update the report configuration here. Changes stay in the modal instead of moving into a side setup column." : "Start fresh with the same field, filter, and sorting controls from the legacy builder."}</div>
              </div>
              <button onClick={() => setCreateModalOpen(false)}>Close</button>
            </div>

            <div className="stack">
              <div className="builder-stepper">
                {createSteps.map((step, index) => (
                  <button
                    key={step}
                    type="button"
                    className={`builder-step-button${step === activeCreateStep ? " active-tab" : ""}${createSteps.indexOf(activeCreateStep) > index ? " builder-step-complete" : ""}`}
                    onClick={() => setCreateStep(step)}
                  >
                    <span className="badge">{index + 1}</span>
                    <strong>{getStudioBuilderStepLabel(step)}</strong>
                  </button>
                ))}
              </div>

              <div className="sync-status">
                <strong>{getStudioBuilderStepLabel(activeCreateStep)}</strong>
                <span>{getStudioBuilderStepDescription(activeCreateStep, createDraft.type)}</span>
              </div>

              {createStepIssues.length ? (
                <div className="sync-status sync-status-warn">
                  <strong>Resolve before continuing</strong>
                  <ul className="flat-list import-review-list">
                    {createStepIssues.map((issue) => <li key={issue}>{issue}</li>)}
                  </ul>
                </div>
              ) : null}

              {activeCreateStep === "basics" ? (
                <>
                  <div className="filter-grid compact-grid">
                    <label className="field">
                      <span>Type</span>
                      <select
                        value={createDraft.type}
                        onChange={(event) => {
                          const nextType = event.target.value as CreateModalType;
                          setCreateDraft(buildStudioBuilderDraft(bundle.tables[0] || null, nextType, currentUserId, uid));
                          setCreateStep(getStudioBuilderSteps(nextType)[0]);
                        }}
                      >
                        <option value="report">Report</option>
                        <option value="dashboard">Dashboard</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Name</span>
                      <input value={createDraft.name} onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))} />
                    </label>
                  </div>
                  <label className="field">
                    <span>Description</span>
                    <input value={createDraft.description} onChange={(event) => setCreateDraft((current) => ({ ...current, description: event.target.value }))} />
                  </label>
                  <div className="card">
                    <div className="card-head">
                      <strong>Sharing</strong>
                      <span className="micro">Choose whether this object is shared with everyone or only visible for the active user.</span>
                    </div>
                    <label className="field">
                      <span>Scope</span>
                      <select
                        value={createDraft.scope}
                        onChange={(event) => setCreateDraft((current) => ({
                          ...current,
                          ...normalizeStudioBuilderScopeOwner(event.target.value as StudioObjectScope, currentUserId, current.ownerUserId)
                        }))}
                      >
                        <option value="global">Shared</option>
                        <option value="personal">Personal</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>Owner</span>
                      <input
                        readOnly
                        value={createDraft.scope === "personal" ? (createDraft.ownerUserId || currentUserId || "No active user") : "Shared with everyone in this workspace"}
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {activeCreateStep === "data" && createDraft.type === "report" && createDraftTable ? (
                <StudioReportDraftDataStep
                  tables={bundle.tables}
                  createDraft={createDraft}
                  createDraftTable={createDraftTable}
                  createFieldQuery={createFieldQuery}
                  setCreateFieldQuery={setCreateFieldQuery}
                  visibleCreateFields={visibleCreateFields}
                  chartValueLabelOptions={chartValueLabelOptions}
                  setCreateDraft={setCreateDraft}
                  updateCreateDraftTable={updateCreateDraftTable}
                />
              ) : null}

              {activeCreateStep === "filters" && createDraft.type === "report" && createDraftTable ? (
                <ReportFiltersAndSortsEditor
                  table={createDraftTable}
                  filterTree={createDraft.filterTree}
                  sorts={createDraft.sorts}
                  onChangeFilterTree={(filterTree) => setCreateDraft((current) => ({ ...current, filterTree }))}
                  onChangeSorts={(sorts) => setCreateDraft((current) => ({ ...current, sorts }))}
                />
              ) : null}

              {activeCreateStep === "view" && createDraft.type === "report" && createDraftTable ? (
                <StudioReportDraftViewStep
                  createDraft={createDraft}
                  createDraftTable={createDraftTable}
                  setCreateDraft={setCreateDraft}
                />
              ) : null}

              {activeCreateStep === "layout" && createDraft.type === "dashboard" ? (
                <>
                  <div className="card">
                    <div className="card-head">
                      <strong>Dashboard starter</strong>
                      <span className="micro">New dashboards start with one clean tab so you can keep layout work on the canvas after saving.</span>
                    </div>
                    <div className="summary-grid">
                      <div className="summary-card">
                        <strong>1</strong>
                        <span>Starter tab</span>
                      </div>
                      <div className="summary-card">
                        <strong>0</strong>
                        <span>Cards at creation</span>
                      </div>
                      <div className="summary-card">
                        <strong>Canvas first</strong>
                        <span>Add and arrange cards after save</span>
                      </div>
                    </div>
                  </div>
                  <div className="sync-status sync-status-ok">
                    <strong>What happens next</strong>
                    <span>After saving, the dashboard opens directly in Studio so you can add tabs, add cards to the active tab, resize them, and move or copy them across tabs from the selected-card inspector.</span>
                  </div>
                </>
              ) : null}

              {activeCreateStep === "review" ? (
                <StudioDraftReviewStep
                  createDraft={createDraft}
                  createDraftTable={createDraftTable}
                  createDraftIssues={createDraftIssues}
                  filterCount={createDraftFilterCount}
                  previewReport={createDraftPreviewReport}
                  previewResult={createDraftPreview}
                  currentPreviewPage={createPreviewPage}
                  onPreviewPageChange={setCreatePreviewPage}
                />
              ) : null}

              <div className="studio-actions modal-actions">
                {createSteps.indexOf(activeCreateStep) > 0 ? (
                  <button type="button" className="ghost-button" onClick={() => setCreateStep(createSteps[Math.max(0, createSteps.indexOf(activeCreateStep) - 1)])}>
                    Back
                  </button>
                ) : null}
                {activeCreateStep !== "review" ? (
                  <button
                    type="button"
                    onClick={() => setCreateStep(createSteps[Math.min(createSteps.length - 1, createSteps.indexOf(activeCreateStep) + 1)])}
                    disabled={createStepIssues.length > 0}
                  >
                    Next
                  </button>
                ) : (
                  <button onClick={createFromDraft} disabled={createDraftIssues.length > 0}>
                    {editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {drawer ? (
        <div className={drawer === "settings" ? "studio-modal-backdrop" : "studio-drawer-backdrop"} onClick={() => setDrawer(null)}>
          <section className={drawer === "settings" ? "studio-modal studio-settings-modal" : "studio-drawer"} onClick={(event) => event.stopPropagation()}>
            <div className="card-head">
              <strong>{drawer === "settings" ? "System Settings" : drawer === "share" ? "Share" : drawer === "templates" ? "Templates" : drawer === "export" ? "Export" : "History"}</strong>
              <button onClick={() => setDrawer(null)}>Close</button>
            </div>

            {drawer === "settings" ? (
              <StudioSettingsPanel
                documentState={documentState}
                activeQuickbaseProfile={activeQuickbaseProfile}
                activeQuickbaseConfig={activeQuickbaseConfig}
                activeProfileTables={activeProfileTables}
                savedRowsForApp={savedRowsForApp}
                refreshStatusTitle={refreshStatusTitle}
                refreshStatusDetail={refreshStatusDetail}
                realmApps={realmApps}
                realmAppsLoading={realmAppsLoading}
                quickbaseSchema={quickbaseSchema}
                quickbaseSchemaLoading={quickbaseSchemaLoading}
                savingRemote={savingRemote}
                refreshingCache={refreshingCache}
                lastQuickbaseSync={lastQuickbaseSync}
                weekdayOptions={WEEKDAY_OPTIONS}
                timezoneOptions={TIMEZONE_OPTIONS}
                applyDocumentUpdate={applyDocumentUpdate}
                setActiveQuickbaseProfile={setActiveQuickbaseProfile}
                updateQuickbaseProfileLabel={updateQuickbaseProfileLabel}
                updateQuickbaseProfileLiveMode={updateQuickbaseProfileLiveMode}
                addQuickbaseProfile={addQuickbaseProfile}
                removeQuickbaseProfile={removeQuickbaseProfile}
                updateQuickbaseField={updateQuickbaseField}
                applyQuickbaseAppSelection={applyQuickbaseAppSelection}
                loadRealmApps={loadRealmApps}
                loadQuickbaseMetadata={() => loadQuickbaseMetadata()}
                autoDetectQuickbaseMappings={autoDetectQuickbaseMappings}
                updateRefreshScheduleField={updateRefreshScheduleField}
                updateRefreshSourceTables={updateRefreshSourceTables}
                updateRefreshSourceReportId={updateRefreshSourceReportId}
                saveRemote={saveRemote}
                refreshAllNow={refreshAllNow}
                reloadRemote={reloadRemote}
              />
            ) : null}

            {drawer === "share" ? (
              <div className="stack">
                <label className="field"><span>Default URL</span><input readOnly value={defaultUrl} /></label>
                <label className="field"><span>Viewer URL</span><input readOnly value={viewerUrl} /></label>
                <label className="field"><span>Embed URL</span><input readOnly value={embedUrl} /></label>
              </div>
            ) : null}

            {drawer === "templates" ? (
              <div className="stack">
                <div className="studio-actions">
                  <button onClick={() => addTemplate("layout")}>Save layout template</button>
                  <button onClick={() => addTemplate("yaml")}>Save report template</button>
                  <button onClick={() => addTemplate("upload")}>Save upload mapping</button>
                </div>
                {[...documentState.templates.layouts, ...documentState.templates.yaml, ...documentState.templates.upload].map((template) => (
                  <div className="card" key={template.id}>
                    <div className="card-head">
                      <strong>{template.name}</strong>
                      <span className="micro">{template.type}</span>
                    </div>
                    {template.columnMap ? <div className="micro">{Object.entries(template.columnMap).map(([key, value]) => `${key} -> ${value}`).join(", ")}</div> : null}
                    {template.object ? <button onClick={() => applyTemplate(template)}>Apply template</button> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {drawer === "export" ? (
              <div className="stack">
                <div className="studio-actions">
                  <button onClick={exportWorkbook}>Download Excel file</button>
                  <button onClick={exportJson}>Download JSON file</button>
                  <button onClick={() => { void refreshExportJobs(); }}>Refresh status</button>
                </div>
                <div className="stack-compact">
                  {mergedExportJobs.map((job) => {
                    const matchingLiveJob = job.sourceJobId ? liveExportJobs.find((item) => item.id === job.sourceJobId) : null;
                    const object = bundle.objects[job.objectId];
                    return (
                    <div className="card" key={job.id}>
                      <div className="card-head">
                        <strong>{object?.name || job.objectId}</strong>
                        <span className="micro">{job.format} · {job.status}</span>
                      </div>
                      <div className="micro">{new Date(job.createdAt).toLocaleString()}</div>
                      <div className="micro">{job.message}{job.error ? ` · ${job.error}` : ""}</div>
                      {job.format === "xlsx" ? (
                        <div className="progress-meter" aria-hidden="true">
                          <div className="progress-meter-fill" style={{ width: `${job.progress}%` }} />
                        </div>
                      ) : null}
                      <div className="studio-actions">
                        {job.format === "xlsx" && matchingLiveJob?.status === "complete" && job.sourceJobId ? (
                          <button onClick={() => downloadExportJob(job.sourceJobId || "")}>Download again</button>
                        ) : null}
                        {job.format === "xlsx" ? (
                          <button onClick={() => { void retryExportJob(job); }}>
                            {job.status === "failed" ? "Retry" : "Run again"}
                          </button>
                        ) : null}
                        {job.format === "json" ? <button onClick={exportJson}>Download again</button> : null}
                      </div>
                    </div>
                  );})}
                  {!mergedExportJobs.length ? <div className="empty">No exports yet.</div> : null}
                </div>
              </div>
            ) : null}

            {drawer === "versions" ? (
              <div className="stack">
                <div className="studio-actions">
                  <button onClick={snapshotCurrentObject}>Save current version</button>
                </div>
                {versionList.length ? versionList.map((version) => (
                  <div className="card" key={version.id}>
                    <div className="card-head">
                      <strong>{version.label}</strong>
                      <span className="micro">{new Date(version.savedAt).toLocaleString()}</span>
                    </div>
                    <button onClick={() => restoreVersion(version.id)}>Restore this version</button>
                  </div>
                )) : <div className="empty">No saved versions yet.</div>}
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      <div className="toast-stack">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.tone}`}>{toast.message}</div>)}
      </div>
      </section>
    </>
  );
}
