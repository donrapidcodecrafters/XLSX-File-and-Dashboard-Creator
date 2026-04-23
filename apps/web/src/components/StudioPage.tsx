import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
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
  type DataRow,
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
  fetchQuickbaseTablePreview,
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
import { buildHostedHashUrl, buildHostedRoute } from "../lib/embed";
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
import { ClearableInputField } from "./ClearableInputField";
import {
  DEFAULT_CHART_COLORS,
  getChartAxisLabels,
  getSortedFieldOptions,
  reportShowsChart,
  reportShowsDetails,
  reportShowsSummary
} from "./studioReportUtils";

const STORAGE_KEY = "hosted-reporting-studio-v2";
const ACTIVITY_OVERLAY_MIN_MS = 700;
const WORKSPACE_REFRESH_SIGNAL_KEY = "hosted-reporting-workspace-refresh-v1";
const WORKSPACE_REFRESH_EVENT = "studio:workspace-updated";
const SHARED_WORKSPACE_SNAPSHOT_KEY = "studio-shared-workspace-snapshot-v1";
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
type LibraryScopeFilter = "all" | "global" | "selected" | "personal";
type ToastTone = "ok" | "warn" | "danger";
type CreateModalType = "report" | "dashboard";

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

interface SharingRosterUser {
  userId: string;
  name: string;
  email: string;
  recordId: string;
  label: string;
  keywords: string[];
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
    sharedUserIds: clone(report.sharedUserIds || []),
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

function normalizeSharedUserIds(userIds: string[]) {
  return Array.from(new Set((userIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

function hasSharingRosterConfig(config: QuickbaseConnectionConfig) {
  return Boolean(
    config.rosterTableId
    && config.rosterUserIdFieldId
    && config.rosterEmployeeNameFieldId
    && config.rosterEmployeeEmailFieldId
  );
}

function buildSharingRosterLabel(name: string, email: string, userId: string) {
  const normalizedName = String(name || "").trim();
  const normalizedEmail = String(email || "").trim();
  if (normalizedName && normalizedEmail) return `${normalizedName} (${normalizedEmail})`;
  if (normalizedName) return normalizedName;
  if (normalizedEmail) return normalizedEmail;
  return userId;
}

function SharingScopeEditor({
  scope,
  ownerUserId,
  sharedUserIds,
  currentUserId,
  rosterUsers,
  rosterLookup,
  rosterLoading,
  rosterError,
  rosterConfigured,
  rosterQuery,
  onRosterQueryChange,
  onScopeChange,
  onSharedUsersChange
}: {
  scope: StudioObjectScope;
  ownerUserId: string;
  sharedUserIds: string[];
  currentUserId: string;
  rosterUsers: SharingRosterUser[];
  rosterLookup: Map<string, SharingRosterUser>;
  rosterLoading: boolean;
  rosterError: string;
  rosterConfigured: boolean;
  rosterQuery: string;
  onRosterQueryChange: (value: string) => void;
  onScopeChange: (scope: StudioObjectScope) => void;
  onSharedUsersChange: (userIds: string[]) => void;
}) {
  const selectedUsers = normalizeSharedUserIds(sharedUserIds)
    .map((userId) => rosterLookup.get(userId) || {
      userId,
      name: "",
      email: "",
      recordId: "",
      label: userId,
      keywords: []
    });
  return (
    <div className="card">
      <div className="card-head">
        <strong>Sharing</strong>
        <span className="micro">Choose whether this object is shared with everyone, only selected users, or only the active user.</span>
      </div>
      <label className="field">
        <span>Scope</span>
        <select value={scope} onChange={(event) => onScopeChange(event.target.value as StudioObjectScope)}>
          <option value="global">Shared with everyone</option>
          <option value="selected">Share with selected users</option>
          <option value="personal">Personal</option>
        </select>
      </label>
      <label className="field">
        <span>Owner</span>
        <input
          readOnly
          value={scope === "personal" ? (ownerUserId || currentUserId || "No active user") : "Not used unless this object is personal"}
        />
      </label>
      {scope === "selected" ? (
        <div className="stack-compact">
          {!rosterConfigured ? (
            <div className="sync-status sync-status-warn">
              <strong>Roster setup required</strong>
              <span>Set the roster table DBID plus the user, name, and email field FIDs in Settings before sharing with selected users.</span>
            </div>
          ) : rosterError ? (
            <div className="sync-status sync-status-warn">
              <strong>Roster lookup failed</strong>
              <span>{rosterError}</span>
            </div>
          ) : null}
          <div className="micro">
            {selectedUsers.length
              ? `${selectedUsers.length} selected user${selectedUsers.length === 1 ? "" : "s"} will be able to open this object from the Quickbase launch button.`
              : "Choose at least one user who should be able to see this report or dashboard."}
          </div>
          {selectedUsers.length ? (
            <div className="badge-row">
              {selectedUsers.slice(0, 8).map((user) => <span className="badge" key={user.userId}>{user.label}</span>)}
            </div>
          ) : null}
          <ClearableInputField
            label="Find people"
            id="sharing-roster-search"
            name="sharingRosterSearch"
            value={rosterQuery}
            onChange={onRosterQueryChange}
            placeholder="Type part of a name, email, or user ID"
          />
          <div className="card surface stack-compact">
            {rosterLoading ? (
              <div className="empty-hint">Loading roster…</div>
            ) : rosterUsers.length ? (
              <div className="stack-compact">
                {rosterUsers.map((user) => {
                  const checked = sharedUserIds.includes(user.userId);
                  return (
                    <label className="toggle-row" key={user.userId}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? normalizeSharedUserIds([...sharedUserIds, user.userId])
                            : sharedUserIds.filter((candidate) => candidate !== user.userId);
                          onSharedUsersChange(next);
                        }}
                      />
                      <span>{user.label}</span>
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="empty-hint">No roster matches that search.</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function getImportDraftTypeLabel(draft: StudioBuilderDraft) {
  if (draft.type !== "report") return "Dashboard";
  if (draft.view.mode === "chart") {
    return `Chart · ${draft.view.chartType}`;
  }
  if (draft.view.mode === "table" && draft.view.showChartInTable) {
    return "Table + chart";
  }
  return draft.view.mode.charAt(0).toUpperCase() + draft.view.mode.slice(1);
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

function stripLocalDocumentData(document: StudioDocument) {
  return normalizeStudioDocument({
    ...document,
    bundle: {
      ...document.bundle,
      data: {}
    }
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stripLocalDocumentData(document)));
  } catch {
    // Ignore browser storage quota failures so large workspaces do not crash the app.
  }
}

function notifyWorkspaceUpdated(document?: StudioDocument) {
  const signal = String(Date.now());
  try {
    if (document) {
      window.localStorage.setItem(SHARED_WORKSPACE_SNAPSHOT_KEY, JSON.stringify(stripLocalDocumentData(document)));
    }
    window.localStorage.setItem(WORKSPACE_REFRESH_SIGNAL_KEY, signal);
  } catch {}
  window.dispatchEvent(new CustomEvent(WORKSPACE_REFRESH_EVENT, { detail: { signal } }));
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
    return ["Choose the real platform source table before creating imported reports."];
  }
  const fieldIds = new Set(table.fields.map((field) => field.id));
  const issues: string[] = [];
  const missingSelectedFields = report.selectedFieldIds.filter((fieldId) => !fieldIds.has(fieldId));
  if (missingSelectedFields.length) {
    issues.push(`${missingSelectedFields.length} selected field${missingSelectedFields.length === 1 ? "" : "s"} could not be matched.`);
  }
  if (!report.selectedFieldIds.length && reportShowsDetails(report)) {
    issues.push("Choose at least one report field.");
  }
  if (reportShowsChart(report)) {
    if (!report.view.chartFieldId) {
      issues.push("Choose a chart X axis field.");
    }
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
  if (report.view.mode === "timeline" && !report.view.timelineDateField) {
    issues.push("Choose the timeline start field.");
  }
  if (report.view.mode === "timeline") {
    if (report.view.timelineDateField && !fieldIds.has(report.view.timelineDateField)) {
      issues.push("The timeline start field could not be matched.");
    }
    if (report.view.timelineEndField && !fieldIds.has(report.view.timelineEndField)) {
      issues.push("The timeline end field could not be matched.");
    }
  }
  if (report.view.mode === "calendar" && !report.view.calendarDateField) {
    issues.push("Choose the calendar date field.");
  }
  if (report.view.mode === "calendar" && report.view.calendarDateField && !fieldIds.has(report.view.calendarDateField)) {
    issues.push("The calendar date field could not be matched.");
  }
  if (report.view.mode === "kanban" && !report.view.kanbanField) {
    issues.push("Choose the kanban grouping field.");
  }
  if (report.view.mode === "kanban" && report.view.kanbanField && !fieldIds.has(report.view.kanbanField)) {
    issues.push("The kanban grouping field could not be matched.");
  }
  return issues;
}

interface PendingWorkbookImport {
  review: StudioWorkbookImportResult["review"];
  warnings: string[];
  primaryObjectId: string;
  importedObjectIds: string[];
  sourceTableId: string;
  baseObjects: Record<string, StudioObject>;
  currentObjects: Record<string, StudioObject>;
  importedTablesById: Record<string, TableDefinition>;
}

function normalizeImportMatchKey(value: string) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function findMatchingFieldIdByLabel(label: string, targetTable: TableDefinition) {
  const normalizedLabel = normalizeImportMatchKey(label);
  if (!normalizedLabel) return "";
  const exact = targetTable.fields.find((field) => normalizeImportMatchKey(field.label) === normalizedLabel);
  if (exact) return exact.id;
  const partial = targetTable.fields.find((field) => {
    const normalizedField = normalizeImportMatchKey(field.label);
    return normalizedField.includes(normalizedLabel) || normalizedLabel.includes(normalizedField);
  });
  return partial?.id || "";
}

function remapFilterTreeForImport(
  node: FilterNodeDefinition | undefined,
  fieldIdMap: Map<string, string>
): FilterNodeDefinition | null {
  if (!node) return null;
  if (isFilterGroupNode(node)) {
    const conditions = node.conditions
      .map((condition) => remapFilterTreeForImport(condition, fieldIdMap))
      .filter((condition): condition is FilterNodeDefinition => Boolean(condition));
    return conditions.length ? { ...node, conditions } : null;
  }
  const filterNode = node as FilterDefinition;
  const mappedFieldId = fieldIdMap.get(filterNode.fieldId || "") || "";
  return mappedFieldId ? { ...filterNode, fieldId: mappedFieldId } : null;
}

function remapImportedReportToSourceTable(
  report: ReportDefinition,
  importedTable: TableDefinition | null,
  targetTable: TableDefinition
): ReportDefinition {
  if (!importedTable) {
    return {
      ...report,
      sourceTableId: targetTable.id,
      selectedFieldIds: [],
      filters: [],
      filterTree: undefined,
      groups: [],
      sorts: [],
      summaryMetrics: [],
      view: {
        ...report.view,
        chartFieldId: "",
        chartSeriesFieldId: "",
        chartValueFieldId: "",
        chartSecondaryValueFieldId: "",
        timelineDateField: "",
        timelineEndField: "",
        calendarDateField: "",
        kanbanField: "",
        titleFieldId: ""
      },
      displayLabels: { fields: {}, chartValues: {} }
    };
  }

  const importedFieldById = new Map(importedTable.fields.map((field) => [field.id, field]));
  const fieldIdMap = new Map<string, string>();
  importedTable.fields.forEach((field) => {
    const matchedId = findMatchingFieldIdByLabel(field.label, targetTable);
    if (matchedId) {
      fieldIdMap.set(field.id, matchedId);
    }
  });
  const mapFieldId = (fieldId: string) => fieldIdMap.get(fieldId || "") || "";
  const selectedFieldIds = Array.from(new Set(report.selectedFieldIds.map(mapFieldId).filter(Boolean)));
  const filters = report.filters
    .map((filter) => {
      const mappedFieldId = mapFieldId(filter.fieldId);
      return mappedFieldId ? { ...filter, fieldId: mappedFieldId } : null;
    })
    .filter((filter): filter is FilterDefinition => Boolean(filter));
  const filterTreeNode = remapFilterTreeForImport(report.filterTree, fieldIdMap);
  const filterTree: ReportDefinition["filterTree"] = filterTreeNode && isFilterGroupNode(filterTreeNode) ? filterTreeNode : undefined;
  const groups = report.groups
    .map((group) => {
      const mappedFieldId = mapFieldId(group.fieldId);
      return mappedFieldId ? { ...group, fieldId: mappedFieldId } : null;
    })
    .filter((group): group is typeof report.groups[number] => Boolean(group));
  const sorts = report.sorts
    .map((sort) => {
      const mappedFieldId = mapFieldId(sort.fieldId);
      return mappedFieldId ? { ...sort, fieldId: mappedFieldId } : null;
    })
    .filter((sort): sort is typeof report.sorts[number] => Boolean(sort));
  const summaryMetrics = report.summaryMetrics
    .map((metric) => {
      const mappedFieldId = mapFieldId(metric.fieldId);
      return metric.op === "count" || mappedFieldId ? { ...metric, fieldId: mappedFieldId || metric.fieldId } : null;
    })
    .filter((metric): metric is typeof report.summaryMetrics[number] => Boolean(metric));

  return {
    ...report,
    sourceTableId: targetTable.id,
    selectedFieldIds,
    filters,
    filterTree,
    groups,
    sorts,
    summaryMetrics,
    view: {
      ...report.view,
      chartFieldId: mapFieldId(report.view.chartFieldId),
      chartSeriesFieldId: mapFieldId(report.view.chartSeriesFieldId),
      chartValueFieldId: mapFieldId(report.view.chartValueFieldId),
      chartSecondaryValueFieldId: mapFieldId(report.view.chartSecondaryValueFieldId),
      timelineDateField: mapFieldId(report.view.timelineDateField),
      timelineEndField: mapFieldId(report.view.timelineEndField),
      calendarDateField: mapFieldId(report.view.calendarDateField),
      kanbanField: mapFieldId(report.view.kanbanField),
      titleFieldId: mapFieldId(report.view.titleFieldId)
    },
    displayLabels: { fields: {}, chartValues: {} }
  };
}

function removeDeletedReportsFromDashboards(document: StudioDocument, reportIds: string[]) {
  if (!reportIds.length) return document;
  const reportIdSet = new Set(reportIds);
  Object.values(document.bundle.objects).forEach((object) => {
    if (object.type !== "dashboard") return;
    object.tabs = object.tabs.map((tab) => ({
      ...tab,
      widgets: tab.widgets.filter((widget) => widget.mode === "copied" || !reportIdSet.has(widget.reportId))
    }));
    object.runtimeFilters = object.runtimeFilters.map((filter) => ({
      ...filter,
      targetReportIds: filter.targetReportIds.filter((reportId) => !reportIdSet.has(reportId))
    }));
  });
  return document;
}

function stripRemovedObjectIds(document: StudioDocument, objectIds: string[]) {
  if (!objectIds.length) return document;
  const removedIds = new Set(objectIds);
  objectIds.forEach((objectId) => {
    delete document.bundle.objects[objectId];
  });
  document.bundle.order = document.bundle.order.filter((item) => !removedIds.has(item));
  document.favorites = document.favorites.filter((item) => !removedIds.has(item));
  document.recent = document.recent.filter((item) => !removedIds.has(item));
  return removeDeletedReportsFromDashboards(document, objectIds);
}

function rebuildPendingWorkbookImportObjects(
  baseObjects: Record<string, StudioObject>,
  importedTablesById: Record<string, TableDefinition>,
  targetTable: TableDefinition | null
) {
  const nextObjects: Record<string, StudioObject> = {};
  Object.entries(baseObjects).forEach(([objectId, object]) => {
    if (object.type === "report") {
      nextObjects[objectId] = targetTable
        ? remapImportedReportToSourceTable(object, importedTablesById[object.sourceTableId] || null, targetTable)
        : remapImportedReportToSourceTable(object, importedTablesById[object.sourceTableId] || null, {
          id: "",
          name: "",
          description: "",
          fields: []
        });
      return;
    }
    nextObjects[objectId] = clone(object);
  });
  return nextObjects;
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
    detected.objectOwnerFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Owner", "Object Owner", "Owner User ID", "Owner User", "Created By"]);
    detected.objectPersonalOwnerFieldId = findQuickbaseFieldIdByLabels(objectTable.fields, ["Personal Report Owner", "Personal Dashboard Owner", "Personal Owner", "Private Owner"]);
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
    sharedUserIds: [],
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
  rows,
  group,
  onChange,
  canRemove,
  onRemove
}: {
  table: TableDefinition;
  rows?: DataRow[];
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
              onChange(addFilterRuleToGroup(group, group.id, ""));
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
          const field = table.fields.find((candidate) => candidate.id === rule.fieldId) || null;
          const operatorOptions = filterOperatorOptionsForField(field);
          const valueOptions = Array.from(new Set([
            ...((field?.options || []).map((value) => String(value || "").trim()).filter(Boolean)),
            ...((rows || [])
              .map((row) => row[rule.fieldId])
              .flatMap((value) => Array.isArray(value) ? value : [value])
              .map((value) => String(value ?? "").trim())
              .filter(Boolean))
          ])).sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
            .map((value) => ({ value, label: value }));
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
              {valueOptions.length && field?.type !== "date" && field?.type !== "datetime" && field?.type !== "number" && field?.type !== "currency" ? (
                <SearchableSelect
                  value={rule.value}
                  options={valueOptions}
                  allowEmpty
                  emptyOptionLabel={filterNeedsValue(rule.operator) ? "Choose a value" : "No value needed"}
                  onChange={(value) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, value })))}
                />
              ) : (
                <input
                  type={field?.type === "date" ? "date" : field?.type === "datetime" ? "datetime-local" : field?.type === "number" || field?.type === "currency" ? "number" : "text"}
                  value={rule.value}
                  disabled={!filterNeedsValue(rule.operator)}
                  onChange={(event) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, value: event.target.value })))}
                  placeholder={filterNeedsValue(rule.operator) ? "Filter value" : "No value needed"}
                />
              )}
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
  rows,
  filterTree,
  sorts,
  onChangeFilterTree,
  onChangeSorts
}: {
  table: TableDefinition;
  rows?: DataRow[];
  filterTree: FilterGroupDefinition;
  sorts: ReportDefinition["sorts"];
  onChangeFilterTree: (filterTree: FilterGroupDefinition) => void;
  onChangeSorts: (sorts: ReportDefinition["sorts"]) => void;
}) {
  return (
    <div className="stack">
      <div className="card">
        <FilterGroupEditor table={table} rows={rows} group={filterTree} onChange={onChangeFilterTree} />
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Sorting</strong>
          <button
            type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onChangeSorts([...sorts, { id: uid("sort"), fieldId: "", direction: "asc" }]);
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
  const location = useLocation();
  const params = useParams();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const importXlsxInputRef = useRef<HTMLInputElement | null>(null);
  const schemaAutoloadedRef = useRef(false);
  const applyLaunchSessionToDocument = (document: StudioDocument) => normalizeStudioDocument({
    ...document,
    session: {
      ...document.session,
      currentUserId: launchContext.userId || document.session.currentUserId,
      launchSource: launchContext.launchSource || document.session.launchSource,
      launchRealmHostname: launchContext.realmHostname || document.session.launchRealmHostname,
      launchAppId: launchContext.appId || document.session.launchAppId
    }
  });
  const scopeDocument = (document: StudioDocument) => applyLaunchScopeToDocument(applyLaunchSessionToDocument(document), {
    launchSource: launchContext.launchSource,
    currentUserId: launchContext.userId,
    launchRealmHostname: launchContext.realmHostname,
    launchAppId: launchContext.appId
  }) || applyLaunchSessionToDocument(document);
  const [documentState, setDocumentState] = useState<StudioDocument>(() => scopeDocument(loadLocalDocument()));
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [savingRemote, setSavingRemote] = useState(false);
  const [history, setHistory] = useState<StudioDocument[]>([]);
  const [future, setFuture] = useState<StudioDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryScopeFilter, setLibraryScopeFilter] = useState<LibraryScopeFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [selectedHomeReportIds, setSelectedHomeReportIds] = useState<string[]>([]);
  const [dashboardInspectorTab, setDashboardInspectorTab] = useState<"design" | "filters">("design");
  const [activeTabId, setActiveTabId] = useState("");
  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [widgetTargetTabId, setWidgetTargetTabId] = useState("");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [runtimeFilterModalOpen, setRuntimeFilterModalOpen] = useState(false);
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
  const [sharingRosterUsers, setSharingRosterUsers] = useState<SharingRosterUser[]>([]);
  const [sharingRosterLoading, setSharingRosterLoading] = useState(false);
  const [sharingRosterError, setSharingRosterError] = useState("");
  const [sharingRosterQuery, setSharingRosterQuery] = useState("");
  const [refreshingCache, setRefreshingCache] = useState(false);
  const [refreshJob, setRefreshJob] = useState<RefreshJobStatus | null>(null);
  const [activityOverlay, setActivityOverlay] = useState<{ title: string; message: string } | null>(null);
  const [lastQuickbaseSync, setLastQuickbaseSync] = useState<QuickbaseSyncResult | null>(null);
  const [lastWorkbookImportReview, setLastWorkbookImportReview] = useState<StudioWorkbookImportResult["review"] | null>(null);
  const [lastWorkbookImportObjectIds, setLastWorkbookImportObjectIds] = useState<string[]>([]);
  const [pendingWorkbookImport, setPendingWorkbookImport] = useState<PendingWorkbookImport | null>(null);
  const [importReviewModalOpen, setImportReviewModalOpen] = useState(false);
  const activeQuickbaseProfile = useMemo(() => getActiveQuickbaseProfile(documentState), [documentState]);
  const activeQuickbaseConfig = activeQuickbaseProfile?.quickbase || documentState.quickbase;
  const activeProfileTables = useMemo(
    () => activeQuickbaseProfile ? getTablesForQuickbaseProfile(documentState, activeQuickbaseProfile.id) : [],
    [documentState, activeQuickbaseProfile]
  );
  const sharingRosterLookup = useMemo(
    () => new Map(sharingRosterUsers.map((user) => [user.userId, user])),
    [sharingRosterUsers]
  );
  const filteredSharingRosterUsers = useMemo(() => {
    const normalizedQuery = sharingRosterQuery.trim().toLowerCase();
    if (!normalizedQuery) return sharingRosterUsers;
    return sharingRosterUsers.filter((user) =>
      [user.label, user.userId, user.name, user.email, ...user.keywords]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [sharingRosterQuery, sharingRosterUsers]);

  useEffect(() => {
    if (!hasSharingRosterConfig(activeQuickbaseConfig)) {
      setSharingRosterUsers([]);
      setSharingRosterError("");
      setSharingRosterLoading(false);
      return;
    }
    let cancelled = false;
    setSharingRosterLoading(true);
    setSharingRosterError("");
    void fetchQuickbaseTablePreview(
      activeQuickbaseConfig,
      activeQuickbaseConfig.rosterTableId,
      [
        activeQuickbaseConfig.rosterUserIdFieldId,
        activeQuickbaseConfig.rosterEmployeeNameFieldId,
        activeQuickbaseConfig.rosterEmployeeEmailFieldId,
        activeQuickbaseConfig.rosterEmployeeRecordIdFieldId
      ].filter(Boolean),
      1000
    )
      .then((response) => {
        if (cancelled) return;
        const nextUsers = response.rows
          .map((row) => {
            const userId = String(row[activeQuickbaseConfig.rosterUserIdFieldId] || "").trim();
            if (!userId) return null;
            const name = String(row[activeQuickbaseConfig.rosterEmployeeNameFieldId] || "").trim();
            const email = String(row[activeQuickbaseConfig.rosterEmployeeEmailFieldId] || "").trim();
            const recordId = String(row[activeQuickbaseConfig.rosterEmployeeRecordIdFieldId] || "").trim();
            return {
              userId,
              name,
              email,
              recordId,
              label: buildSharingRosterLabel(name, email, userId),
              keywords: [name, email, recordId]
            } satisfies SharingRosterUser;
          })
          .filter((user): user is SharingRosterUser => Boolean(user))
          .sort((left, right) => left.label.localeCompare(right.label, undefined, { sensitivity: "base", numeric: true }));
        setSharingRosterUsers(nextUsers);
      })
      .catch((error) => {
        if (cancelled) return;
        setSharingRosterUsers([]);
        setSharingRosterError(error instanceof Error ? error.message : "Roster lookup failed.");
      })
      .finally(() => {
        if (cancelled) return;
        setSharingRosterLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeQuickbaseConfig]);

  const activeProfileRefreshValidation = getActiveProfileRefreshValidation(documentState, false);
  const staleMissingReportIdError = Boolean(
    activeQuickbaseProfile?.refreshStatus.lastError
    && /no quickbase source report id is configured/i.test(activeQuickbaseProfile.refreshStatus.lastError)
    && !activeProfileRefreshValidation
  );
  const savedRowsForApp = activeQuickbaseProfile?.refreshStatus.cachedRowCount || 0;
  const refreshStatusTitle = activeQuickbaseProfile?.refreshStatus.running
    ? "Refreshing saved data"
    : activeQuickbaseProfile?.refreshStatus.lastSuccessAt
      ? (savedRowsForApp > 0 ? "Saved data is ready" : "Refresh finished but nothing was saved")
      : "No saved data yet";
  const refreshStatusDetail = (!staleMissingReportIdError ? activeQuickbaseProfile?.refreshStatus.lastError : "")
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
  const [importEditingReportId, setImportEditingReportId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateObjectDraft>(() => {
    const document = scopeDocument(loadLocalDocument());
    return buildStudioBuilderDraft(document.bundle.tables[0], "report", String(document.session.currentUserId || "").trim(), uid);
  });
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
  const lastImportPreloadTableIdRef = useRef("");

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get("panel") === "settings") {
      setDrawer("settings");
    }
  }, [location.search]);

  const bundle = documentState.bundle;
  const currentUserId = String(documentState.session.currentUserId || "").trim();
  const objects = useMemo(() => bundle.order.map((id) => bundle.objects[id]).filter(Boolean), [bundle]);
  const importReviewObjectIds = pendingWorkbookImport?.importedObjectIds || lastWorkbookImportObjectIds;
  const importReviewObjects = pendingWorkbookImport?.currentObjects || bundle.objects;
  const importReviewSourceTable = pendingWorkbookImport?.sourceTableId
    ? bundle.tables.find((table) => table.id === pendingWorkbookImport.sourceTableId) || null
    : null;
  const importedReviewReports = useMemo(
    () => importReviewObjectIds
      .map((id) => importReviewObjects[id])
      .filter((object): object is ReportDefinition => Boolean(object) && object.type === "report")
      .map((report) => ({
        report,
        table: pendingWorkbookImport
          ? importReviewSourceTable
          : bundle.tables.find((table) => table.id === report.sourceTableId) || null
      })),
    [bundle.tables, importReviewObjectIds, importReviewObjects, importReviewSourceTable, pendingWorkbookImport]
  );
  const pendingImportedReviewReports = useMemo(
    () => pendingWorkbookImport
      ? importedReviewReports.filter(({ report, table }) => collectReportImportIssues(report, table).length > 0)
      : importedReviewReports,
    [importedReviewReports, pendingWorkbookImport]
  );
  const importedReviewDashboardCount = useMemo(
    () => importReviewObjectIds
      .map((id) => importReviewObjects[id])
      .filter((object) => object?.type === "dashboard").length,
    [importReviewObjectIds, importReviewObjects]
  );
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
  const activeDashboardReportOptions = useMemo(() => {
    if (!activeDashboard) return [] as Array<{ value: string; label: string }>;
    const seen = new Set<string>();
    const reports: Array<{ value: string; label: string }> = [];
    activeDashboard.tabs.forEach((tab) => {
      tab.widgets.forEach((widget) => {
        const report = widget.mode === "copied" && widget.snapshot ? widget.snapshot : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
        if (!report || seen.has(report.id)) return;
        seen.add(report.id);
        reports.push({ value: report.id, label: report.name });
      });
    });
    return reports.sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: "base" }));
  }, [activeDashboard, bundle.objects]);
  const activeDashboardFieldOptionsByTableId = useMemo(
    () => Object.fromEntries(activeDashboardRefreshTables.map((table) => [table.id, getSortedFieldOptions(table)])),
    [activeDashboardRefreshTables]
  );
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
  const importBuilderIdentity = importEditingReportId ? (
    <div className="import-builder-identity">
      <div>
        <div className="eyebrow">Imported Report</div>
        <strong>{createDraft.name.trim() || "Untitled report"}</strong>
      </div>
      <span className="badge brand">{getImportDraftTypeLabel(createDraft)}</span>
    </div>
  ) : null;
  const validation = activeObject ? validationMessages(activeObject, activeTable) : [];
  const createDraftPreviewReport = useMemo<ReportDefinition | null>(() => {
    if (createDraft.type !== "report" || !createDraftTable) return null;
    const existingPreviewReport = editingReportId
      ? (
        (importEditingReportId && pendingWorkbookImport?.currentObjects[editingReportId]?.type === "report"
          ? pendingWorkbookImport.currentObjects[editingReportId]
          : bundle.objects[editingReportId]) as ReportDefinition | undefined
      )
      : undefined;
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
      sharedUserIds: createDraft.sharedUserIds,
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
  }, [bundle.objects, createDraft, createDraftTable, editingReportId, importEditingReportId, pendingWorkbookImport]);
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

  async function runWithActivityOverlay<T>(title: string, message: string, action: () => Promise<T>) {
    const startedAt = Date.now();
    setActivityOverlay({ title, message });
    try {
      return await action();
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed < ACTIVITY_OVERLAY_MIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, ACTIVITY_OVERLAY_MIN_MS - elapsed));
      }
      setActivityOverlay(null);
    }
  }

  async function runWorkbookImportWithOverlay<T>(fileName: string, action: () => Promise<T>) {
    const phases = [
      `Uploading ${fileName}…`,
      "Reading workbook sheets and tabs…",
      "Building draft reports and dashboard tabs…",
      "Preparing the import review…"
    ];
    let phaseIndex = 0;
    setActivityOverlay({ title: "Importing xlsx", message: phases[phaseIndex] });
    const phaseTimer = window.setInterval(() => {
      phaseIndex = Math.min(phaseIndex + 1, phases.length - 1);
      setActivityOverlay({ title: "Importing xlsx", message: phases[phaseIndex] });
    }, 4000);
    const startedAt = Date.now();
    try {
      return await action();
    } finally {
      window.clearInterval(phaseTimer);
      const elapsed = Date.now() - startedAt;
      if (elapsed < ACTIVITY_OVERLAY_MIN_MS) {
        await new Promise((resolve) => window.setTimeout(resolve, ACTIVITY_OVERLAY_MIN_MS - elapsed));
      }
      setActivityOverlay(null);
    }
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
    notifyWorkspaceUpdated(documentState);
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
          result: runReport(report, table, bundle.data[report.sourceTableId] || [], buildDashboardFilters(activeDashboard, report.id, runtimeValues, report.sourceTableId)),
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

  function updateRuntimeFilter(filterId: string, updater: (filter: DashboardDefinition["runtimeFilters"][number]) => DashboardDefinition["runtimeFilters"][number]) {
    if (!activeDashboard) return;
    updateObject({
      ...activeDashboard,
      runtimeFilters: activeDashboard.runtimeFilters.map((filter) => filter.id === filterId ? updater(filter) : filter)
    });
  }

  function collectFieldValueOptions(tableId: string, fieldId: string) {
    if (!fieldId) return [] as Array<{ value: string; label: string }>;
    const table = bundle.tables.find((item) => item.id === tableId) || null;
    if (!table) return [] as Array<{ value: string; label: string }>;
    const declaredOptions = (table.fields.find((field) => field.id === fieldId)?.options || [])
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const rowValues = (bundle.data[tableId] || [])
      .map((row) => row[fieldId])
      .flatMap((value) => Array.isArray(value) ? value : [value])
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);
    return Array.from(new Set([...declaredOptions, ...rowValues]))
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }))
      .map((value) => ({ value, label: value }));
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
    setImportEditingReportId(null);
    setCreateStep(getStudioBuilderSteps(type)[0]);
    setCreatePreviewPage(1);
    setCreateModalOpen(true);
  }

  function openEditReportModal(report: ReportDefinition) {
    const table = bundle.tables.find((item) => item.id === report.sourceTableId) || null;
    setCreateDraft(buildDraftFromReport(report, table));
    setEditingReportId(report.id);
    setImportEditingReportId(null);
    setCreateStep("basics");
    setCreatePreviewPage(1);
    setCreateModalOpen(true);
  }

  function openImportedReviewReportModal(report: ReportDefinition, table: TableDefinition | null) {
    if (!table) {
      pushToast("Choose the source table for this workbook first.", "warn");
      return;
    }
    setCreateDraft(buildDraftFromReport(report, table));
    setEditingReportId(report.id);
    setImportEditingReportId(report.id);
    setCreateStep("data");
    setCreatePreviewPage(1);
    setCreateModalOpen(true);
  }

  function closeCreateModal() {
    setCreateModalOpen(false);
    setEditingReportId(null);
    setImportEditingReportId(null);
  }

  function updateCreateDraftTable(tableId: string) {
    const table = bundle.tables.find((item) => item.id === tableId) || bundle.tables[0] || null;
    if (!table) return;
    setCreateDraft((current) => ({
      ...current,
      tableId: table.id,
      sourceReportOverrides: {},
      selectedFieldIds: [],
      filterTree: createFilterGroup("and", []),
      sorts: [],
      summaryMetrics: [],
      view: {
        ...current.view,
        showChartInTable: false,
        showSummary: current.view.showSummary ?? true,
        showDetails: current.view.showDetails ?? true,
        chartTitle: current.view.chartTitle || "",
        decimalPlaces: Number.isFinite(Number(current.view.decimalPlaces)) ? Math.max(0, Math.min(6, Number(current.view.decimalPlaces))) : 2,
        chartOrientation: "vertical",
        chartFieldId: "",
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
        titleFieldId: "",
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
      const sharing = normalizeStudioBuilderScopeOwner(createDraft.scope, currentUserId, createDraft.ownerUserId, createDraft.sharedUserIds);
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
        sharedUserIds: sharing.sharedUserIds,
        updatedAt: new Date().toISOString(),
        runtimeFilters: [],
        sourceReportOverrides: {},
        tabs: [{ id: uid("tab"), name: "Overview", widgets: [] }]
      };
      applyDocumentUpdate((draft) => {
        draft.bundle.objects[dashboard.id] = dashboard;
        draft.bundle.order.unshift(dashboard.id);
      });
      closeCreateModal();
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
    const existingReport = editingReportId
      ? (
        (importEditingReportId && pendingWorkbookImport?.currentObjects[editingReportId]?.type === "report"
          ? pendingWorkbookImport.currentObjects[editingReportId]
          : bundle.objects[editingReportId]) as ReportDefinition | undefined
      )
      : undefined;
    const sharing = normalizeStudioBuilderScopeOwner(createDraft.scope, currentUserId, createDraft.ownerUserId, createDraft.sharedUserIds);
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
      sharedUserIds: sharing.sharedUserIds,
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
    if (importEditingReportId) {
      const nextImportState = pendingWorkbookImport
        ? {
            ...pendingWorkbookImport,
            currentObjects: {
              ...pendingWorkbookImport.currentObjects,
              [importEditingReportId]: report
            }
          }
        : null;
      if (nextImportState) {
        setPendingWorkbookImport(nextImportState);
      } else {
        updateImportedReviewReport(importEditingReportId, () => report);
      }
      closeCreateModal();
      if (nextImportState) {
        const remainingReports = nextImportState.importedObjectIds
          .map((objectId) => nextImportState.currentObjects[objectId])
          .filter((object): object is ReportDefinition => Boolean(object) && object.type === "report")
          .filter((candidate) => collectReportImportIssues(candidate, bundle.tables.find((tableDefinition) => tableDefinition.id === nextImportState.sourceTableId) || null).length > 0);
        if (!remainingReports.length) {
          void finalizeWorkbookImport(nextImportState);
          pushToast("Imported report saved. Opening the dashboard and applying the workbook.");
          return;
        }
        pushToast(`Imported report saved. ${remainingReports.length} report${remainingReports.length === 1 ? "" : "s"} still need review.`);
        return;
      }
      pushToast("Imported report setup updated.");
      return;
    }
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[report.id] = report;
      if (!draft.bundle.order.includes(report.id)) {
        draft.bundle.order.unshift(report.id);
      }
    });
    closeCreateModal();
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
    if (activeObject?.type === "report" || (bundle.objects[objectId]?.type === "report")) {
      removeDeletedReportsFromDashboards(nextDocument, [objectId]);
    }

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    navigate(buildHostedRoute(`/studio/${nextDocument.bundle.order[0] || ""}`));
    pushToast("Object removed.", "warn");
    try {
      await persistRemote(nextDocument, { removedObjectIds: [objectId] });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Delete save failed after local removal.", "danger");
    }
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

    const nextDocument = clone(documentState);
    reportIds.forEach((reportId) => {
      delete nextDocument.bundle.objects[reportId];
      nextDocument.bundle.order = nextDocument.bundle.order.filter((item) => item !== reportId);
      nextDocument.favorites = nextDocument.favorites.filter((item) => item !== reportId);
      nextDocument.recent = nextDocument.recent.filter((item) => item !== reportId);
    });
    removeDeletedReportsFromDashboards(nextDocument, reportIds);

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setSelectedHomeReportIds([]);
    setDocumentState(nextDocument);
    if (activeReport && reportIds.includes(activeReport.id)) {
      navigate(buildHostedRoute("/studio"));
    }
    pushToast(`Deleted ${reportIds.length} report${reportIds.length === 1 ? "" : "s"}. Use Undo if needed.`, "warn");
    try {
      await persistRemote(nextDocument, { removedObjectIds: reportIds });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Bulk delete save failed after local removal.", "danger");
    }
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

  async function persistRemote(nextDocument: StudioDocument, options?: { removedObjectIds?: string[] }) {
    setSavingRemote(true);
    try {
      const response = await saveStudioDocument(nextDocument, { removedObjectIds: options?.removedObjectIds || [] });
      const persistedDocument = normalizeStudioDocument(response.document);
      if (options?.removedObjectIds?.length) {
        stripRemovedObjectIds(persistedDocument, options.removedObjectIds);
      }
      setDocumentState(scopeDocument(persistedDocument));
      notifyWorkspaceUpdated();
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
    await runWithActivityOverlay("Saving to Quickbase and server", "Saving platform settings and workspace changes…", async () => {
      await persistRemote(documentState);
    });
  }

  async function reloadRemote() {
    await runWithActivityOverlay("Loading from server", "Loading the latest hosted platform document…", async () => {
      try {
        const response = await fetchStudioDocument();
        setDocumentState(scopeDocument(normalizeStudioDocument(response.document)));
        setHistory([]);
        setFuture([]);
        pushToast("Reloaded hosted studio.");
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Reload failed.", "danger");
      }
    });
  }

  async function loadQuickbaseMetadata(silent = false) {
    const profile = activeQuickbaseProfile;
    if (!profile) {
      pushToast("Add a Quickbase app profile first.", "warn");
      return null;
    }
    setQuickbaseSchemaLoading(true);
    try {
      return await runWithActivityOverlay("Loading tables and fields", `Loading the Quickbase schema for ${profile.label}…`, async () => {
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
        }
      });
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
      await runWithActivityOverlay("Finding Quickbase apps", `Looking up apps you can access in ${profile.quickbase.realmHostname}…`, async () => {
        try {
          const response = await fetchQuickbaseApps(profile.quickbase);
          setRealmApps(response.apps);
          if (!silent) {
            pushToast(`Found ${response.apps.length} Quickbase apps you can access in this realm.`);
          }
        } catch (error) {
          pushToast(error instanceof Error ? error.message : "Quickbase app lookup failed.", "danger");
        }
      });
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

  useEffect(() => {
    const sourceTableId = pendingWorkbookImport?.sourceTableId || "";
    if (!sourceTableId || sourceTableId === lastImportPreloadTableIdRef.current) return;
    lastImportPreloadTableIdRef.current = sourceTableId;
    void startStudioRefresh()
      .then(() => undefined)
      .catch(() => undefined);
  }, [pendingWorkbookImport?.sourceTableId]);

  async function refreshAllNow() {
    const refreshValidation = getFullRefreshValidation(documentState);
    if (refreshValidation) {
      pushToast(refreshValidation, "warn");
      return;
    }
    setRefreshingCache(true);
    try {
      await runWithActivityOverlay("Preparing refresh", "Saving current settings and starting a full cache refresh…", async () => {
        const saved = await saveStudioDocument(documentState);
        setDocumentState(scopeDocument(normalizeStudioDocument(saved.document)));
        setLastQuickbaseSync(saved.sync || null);
        const response = await startStudioRefresh();
        setRefreshJob(response.job);
      });
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

  async function handleImportXlsx(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setXlsxImporting(true);
    try {
      const response = await runWorkbookImportWithOverlay(file.name, () => importStudioWorkbook(file));
      const sourceTableId = "";
      lastImportPreloadTableIdRef.current = "";
      const baseObjects = Object.fromEntries(
        response.importedObjectIds
          .map((objectId) => response.document.bundle.objects[objectId])
          .filter((object): object is StudioObject => Boolean(object))
          .map((object) => [object.id, clone(object)])
      );
      const importedTablesById = Object.fromEntries(
        response.importedTableIds
          .map((tableId) => response.document.bundle.tables.find((table) => table.id === tableId))
          .filter((table): table is TableDefinition => Boolean(table))
          .map((table) => [table.id, clone(table)])
      );
      const targetTable = sourceTableId ? bundle.tables.find((table) => table.id === sourceTableId) || null : null;
      setPendingWorkbookImport({
        review: response.review,
        warnings: response.warnings,
        primaryObjectId: response.primaryObjectId,
        importedObjectIds: response.importedObjectIds,
        sourceTableId,
        baseObjects,
        currentObjects: rebuildPendingWorkbookImportObjects(baseObjects, importedTablesById, targetTable),
        importedTablesById
      });
      setImportReviewModalOpen(true);
      const importedType = response.review.dashboardCreated ? "dashboard workbook" : response.importedObjectIds.length > 1 ? "workbook" : "sheet";
      pushToast(`Parsed ${importedType} from ${file.name}. Choose the real source table before creating anything.`);
      if (!bundle.tables.length) {
        pushToast("Load or configure a real platform table first. Imported workbooks no longer create placeholder tables.", "warn");
      }
      if (response.warnings.length) {
        pushToast(`${response.warnings.length} import note${response.warnings.length === 1 ? "" : "s"} recorded. Review the import summary for details.`, "warn");
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "XLSX import failed.", "danger");
    } finally {
      setXlsxImporting(false);
      if (event.target) event.target.value = "";
    }
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
    if (pendingWorkbookImport) {
      setPendingWorkbookImport((current) => {
        if (!current) return current;
        const report = current.currentObjects[reportId];
        if (!report || report.type !== "report") return current;
        return {
          ...current,
          currentObjects: {
            ...current.currentObjects,
            [reportId]: updater(clone(report))
          }
        };
      });
      return;
    }
    const current = bundle.objects[reportId];
    if (!current || current.type !== "report") return;
    updateObject(updater(clone(current)));
  }

  function closeImportReviewModal() {
    setImportReviewModalOpen(false);
    lastImportPreloadTableIdRef.current = "";
    if (pendingWorkbookImport) {
      setPendingWorkbookImport(null);
    }
  }

  async function finalizeWorkbookImport(importState: PendingWorkbookImport) {
    const sourceTable = bundle.tables.find((table) => table.id === importState.sourceTableId) || null;
    if (!sourceTable) {
      pushToast("Choose the real source table before creating imported reports.", "warn");
      return;
    }
    const issues = importState.importedObjectIds.flatMap((objectId) => {
      const object = importState.currentObjects[objectId];
      if (!object || object.type !== "report") return [];
      return collectReportImportIssues(object, sourceTable);
    });
    if (issues.length) {
      pushToast("Resolve the remaining imported field issues before creating the workbook objects.", "warn");
      return;
    }
    const nextDocument = clone(documentState);
    importState.importedObjectIds.forEach((objectId) => {
      const object = importState.currentObjects[objectId];
      if (!object) return;
      nextDocument.bundle.objects[objectId] = clone(object);
    });
    nextDocument.bundle.order = [
      ...importState.importedObjectIds.filter((objectId) => Boolean(importState.currentObjects[objectId])),
      ...nextDocument.bundle.order.filter((objectId) => !importState.importedObjectIds.includes(objectId))
    ];

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    setLastWorkbookImportReview(importState.review);
    setLastWorkbookImportObjectIds(importState.importedObjectIds);
    setPendingWorkbookImport(null);
    setImportReviewModalOpen(false);
    if (importState.primaryObjectId) {
      navigate(buildHostedRoute(`/studio/${importState.primaryObjectId}`));
    }
    pushToast(`Created imported ${importState.review.dashboardCreated ? "dashboard and reports" : "reports"} using ${sourceTable.name}.`);
    await persistRemote(nextDocument);
  }

  function updatePendingImportSourceTable(tableId: string) {
    const targetTable = bundle.tables.find((table) => table.id === tableId) || null;
    setPendingWorkbookImport((current) => {
      if (!current) return current;
      return {
        ...current,
        sourceTableId: tableId,
        currentObjects: rebuildPendingWorkbookImportObjects(current.baseObjects, current.importedTablesById, targetTable)
      };
    });
  }

  async function applyPendingWorkbookImport() {
    if (!pendingWorkbookImport) return;
    await finalizeWorkbookImport(pendingWorkbookImport);
  }

  const pendingImportActionLabel = pendingWorkbookImport
    ? pendingImportedReviewReports.length
      ? ((pendingWorkbookImport.review.dashboardCreated ? "Save imported dashboard" : "Save imported reports"))
      : (pendingWorkbookImport.review.dashboardCreated ? "Save imported dashboard" : "Save imported reports")
    : "";

  function renderStudioOverlays() {
    return (
      <>
        {activityOverlay ? (
          <RefreshOverlay
            title={activityOverlay.title}
            indeterminate
            job={{ message: activityOverlay.message }}
          />
        ) : null}
        {importReviewModalOpen && (pendingWorkbookImport || lastWorkbookImportReview) ? (
          <div className="studio-modal-backdrop" onClick={closeImportReviewModal}>
            <section className="studio-modal studio-import-review-modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <div>
                  <strong>Imported workbook review</strong>
                  <div className="micro">
                    {(pendingWorkbookImport?.review || lastWorkbookImportReview)?.workbookName} · {(pendingWorkbookImport ? pendingImportedReviewReports.length : importedReviewReports.length)} report{(pendingWorkbookImport ? pendingImportedReviewReports.length : importedReviewReports.length) === 1 ? "" : "s"}
                    {importedReviewDashboardCount ? ` · ${importedReviewDashboardCount} dashboard candidate${importedReviewDashboardCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <button type="button" onClick={closeImportReviewModal}>{pendingWorkbookImport ? "Cancel import" : "Close"}</button>
              </div>

              {pendingWorkbookImport ? (
                <div className="sync-status sync-status-warn">
                  <strong>Choose the real source table first</strong>
                  <span>This workbook has only been parsed. Nothing has been created yet. Pick the existing platform table that should drive every imported report, then fix any fields that still need a match before you create the dashboard and reports.</span>
                </div>
              ) : null}

              {(pendingWorkbookImport?.review || lastWorkbookImportReview)?.dashboardCreated ? (
                <div className="sync-status sync-status-ok">
                  <strong>Dashboard candidate ready</strong>
                  <span>{pendingWorkbookImport ? "The workbook structure was reconstructed into draft reports and dashboard tabs. Only reports that still need field setup stay in this workflow. When the last one is saved, the dashboard will open automatically." : "The workbook was reconstructed into native reports and dashboard tabs. Review each imported report here and fix any fields that still need attention."}</span>
                </div>
              ) : null}

              {pendingWorkbookImport ? (
                <div className="card">
                  <div className="filter-grid compact-grid">
                    <label className="field">
                      <span>Source table for this workbook</span>
                      <SearchableSelect
                        value={pendingWorkbookImport.sourceTableId}
                        options={bundle.tables.map((table) => ({ value: table.id, label: table.name, keywords: [table.description] }))}
                        allowEmpty
                        emptyOptionLabel="Choose an existing platform table"
                        onChange={updatePendingImportSourceTable}
                      />
                    </label>
                  </div>
                  <div className="micro">
                    Imported workbooks no longer create placeholder tables. Every imported report and dashboard card will be tied to this existing platform table.
                  </div>
                </div>
              ) : null}

              {pendingWorkbookImport ? (
                <div className="studio-actions import-review-actions-top">
                  <button type="button" className="ghost-button" onClick={closeImportReviewModal}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => void applyPendingWorkbookImport()}
                    disabled={!pendingWorkbookImport.sourceTableId || pendingImportedReviewReports.length > 0}
                  >
                    {pendingImportActionLabel}
                  </button>
                </div>
              ) : null}

              <div className="stack">
                {(pendingWorkbookImport ? pendingImportedReviewReports : importedReviewReports).map(({ report, table }) => {
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

                      <div className="summary-grid import-review-summary-grid">
                        <div className="summary-card">
                          <strong>{matchedReferencedCount}</strong>
                          <span>Matched referenced fields</span>
                        </div>
                        <div className="summary-card">
                          <strong>{Math.max(referencedFieldIds.length - matchedReferencedCount, 0)}</strong>
                          <span>Fields still needing attention</span>
                        </div>
                        <div className="summary-card">
                          <strong>{report.selectedFieldIds.length}</strong>
                          <span>Selected detail fields</span>
                        </div>
                      </div>

                      <div className="studio-actions">
                        <button type="button" onClick={() => openImportedReviewReportModal(report, table)}>
                          Open full report setup
                        </button>
                      </div>

                      <div className="micro">
                        Use the full report builder to map fields, reorder columns, set filters, sorts, summaries, chart axes, series fields, and any secondary-axis settings before applying the workbook import.
                      </div>
                    </article>
                  );
                })}
                {!(pendingWorkbookImport ? pendingImportedReviewReports : importedReviewReports).length ? (
                  <div className="empty-hint">
                    {pendingWorkbookImport
                      ? "Every imported report has the fields it needs. Saving the last report will create the workbook automatically."
                      : "No imported reports are available to review."}
                  </div>
                ) : null}
              </div>
              {pendingWorkbookImport ? (
                <div className="studio-actions">
                  <button type="button" className="ghost-button" onClick={closeImportReviewModal}>Cancel</button>
                  <button
                    type="button"
                    onClick={() => void applyPendingWorkbookImport()}
                    disabled={!pendingWorkbookImport.sourceTableId || pendingImportedReviewReports.length > 0}
                  >
                    {pendingImportActionLabel}
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
        {runtimeFilterModalOpen && activeDashboard ? (
          <div className="studio-modal-backdrop" onClick={() => setRuntimeFilterModalOpen(false)}>
            <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <div>
                  <strong>Dashboard runtime filters</strong>
                  <div className="micro">{activeDashboard.name} · Configure runtime filters in one place.</div>
                </div>
                <button type="button" onClick={() => setRuntimeFilterModalOpen(false)}>Close</button>
              </div>
              <div className="stack">
                {activeDashboard.runtimeFilters.length ? activeDashboard.runtimeFilters.map((filter) => {
                  const resolvedTableId = filter.sourceTableId || (activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0]?.id || "" : "");
                  const selectedTable = activeDashboardRefreshTables.find((table) => table.id === resolvedTableId) || null;
                  const fieldOptions = resolvedTableId ? (activeDashboardFieldOptionsByTableId[resolvedTableId] || []) : [];
                  const valueOptions = resolvedTableId && filter.fieldId ? collectFieldValueOptions(resolvedTableId, filter.fieldId) : [];
                  return (
                    <div className="card" key={filter.id}>
                      <div className="card-head">
                        <strong>{filter.label || "Runtime filter"}</strong>
                        <button type="button" onClick={() => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.filter((item) => item.id !== filter.id) })}>Remove</button>
                      </div>
                      <div className="filter-grid compact-grid">
                        <label className="field">
                          <span>Label</span>
                          <input value={filter.label} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, label: event.target.value }))} />
                        </label>
                        {activeDashboardRefreshTables.length > 1 ? (
                          <label className="field">
                            <span>Table</span>
                            <SearchableSelect
                              value={resolvedTableId}
                              options={activeDashboardRefreshTables.map((table) => ({ value: table.id, label: table.name, keywords: [table.description] }))}
                              allowEmpty
                              emptyOptionLabel="Choose dashboard table"
                              onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, sourceTableId: value, fieldId: "", defaultValue: "" }))}
                            />
                          </label>
                        ) : (
                          <label className="field">
                            <span>Table</span>
                            <input value={selectedTable?.name || "No dashboard table"} disabled />
                          </label>
                        )}
                        <label className="field">
                          <span>Field</span>
                          <SearchableSelect
                            value={filter.fieldId}
                            options={fieldOptions}
                            allowEmpty
                            emptyOptionLabel={resolvedTableId ? "Choose table field" : "Choose a table first"}
                            onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, fieldId: value, defaultValue: "" }))}
                          />
                        </label>
                        <label className="field">
                          <span>Mode</span>
                          <select value={filter.mode} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, mode: event.target.value as "global" | "selected", targetReportIds: event.target.value === "global" ? [] : current.targetReportIds }))}>
                            <option value="global">Global</option>
                            <option value="selected">Selected reports</option>
                          </select>
                        </label>
                        {valueOptions.length ? (
                          <label className="field">
                            <span>Default value</span>
                            <SearchableSelect
                              value={filter.defaultValue}
                              options={valueOptions}
                              allowEmpty
                              emptyOptionLabel="No default value"
                              onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, defaultValue: value }))}
                            />
                          </label>
                        ) : (
                          <label className="field">
                            <span>Default value</span>
                            <input value={filter.defaultValue} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, defaultValue: event.target.value }))} />
                          </label>
                        )}
                      </div>
                      {filter.mode === "selected" ? (
                        <div className="stack-compact">
                          <span className="micro">Select which reports on the current dashboard this runtime filter should affect.</span>
                          <div className="filter-grid compact-grid">
                            {activeDashboardReportOptions.map((reportOption) => (
                              <label className="toggle-row" key={reportOption.value}>
                                <input
                                  type="checkbox"
                                  checked={filter.targetReportIds.includes(reportOption.value)}
                                  onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({
                                    ...current,
                                    targetReportIds: event.target.checked
                                      ? Array.from(new Set([...current.targetReportIds, reportOption.value]))
                                      : current.targetReportIds.filter((item) => item !== reportOption.value)
                                  }))}
                                />
                                {reportOption.label}
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  );
                }) : <div className="empty-hint">No runtime filters yet.</div>}
                <div className="studio-actions modal-actions">
                  <button
                    type="button"
                    onClick={() => updateObject({
                      ...activeDashboard,
                      runtimeFilters: [
                        ...activeDashboard.runtimeFilters,
                        {
                          id: uid("runtime"),
                          label: "New filter",
                          fieldId: "",
                          sourceTableId: activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0].id : "",
                          mode: "global",
                          targetReportIds: [],
                          defaultValue: ""
                        }
                      ]
                    })}
                  >
                    Add runtime filter
                  </button>
                  <button type="button" className="ghost-button" onClick={() => setRuntimeFilterModalOpen(false)}>Done</button>
                </div>
              </div>
            </section>
          </div>
        ) : null}
        {createModalOpen ? (
          <div className="studio-modal-backdrop" onClick={closeCreateModal}>
            <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
              <div className="card-head">
                <div>
                  <strong>{importEditingReportId ? "Edit Imported Report Setup" : editingReportId ? "Edit Report" : `Create ${createDraft.type === "report" ? "Report" : "Dashboard"}`}</strong>
                  <div className="micro">{importEditingReportId ? "Use the same builder workflow as a normal report: fields, filters, sorts, and chart setup all stay together here before the workbook import is applied." : editingReportId ? "Update the report configuration here. Changes stay in the modal instead of moving into a side setup column." : "Start fresh with the same field, filter, and sorting controls from the legacy builder."}</div>
                </div>
                <button onClick={closeCreateModal}>Close</button>
              </div>
              {importBuilderIdentity}

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
                          disabled={Boolean(editingReportId)}
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
                    <SharingScopeEditor
                      scope={createDraft.scope}
                      ownerUserId={createDraft.ownerUserId}
                      sharedUserIds={createDraft.sharedUserIds}
                      currentUserId={currentUserId}
                      rosterUsers={filteredSharingRosterUsers}
                      rosterLookup={sharingRosterLookup}
                      rosterLoading={sharingRosterLoading}
                      rosterError={sharingRosterError}
                      rosterConfigured={hasSharingRosterConfig(activeQuickbaseConfig)}
                      rosterQuery={sharingRosterQuery}
                      onRosterQueryChange={setSharingRosterQuery}
                      onScopeChange={(scope) => setCreateDraft((current) => ({
                        ...current,
                        ...normalizeStudioBuilderScopeOwner(scope, currentUserId, current.ownerUserId, current.sharedUserIds)
                      }))}
                      onSharedUsersChange={(sharedUserIds) => setCreateDraft((current) => ({ ...current, sharedUserIds }))}
                    />
                  </>
                ) : null}

                {activeCreateStep === "data" && createDraft.type === "report" && createDraftTable ? (
                  <StudioReportDraftDataStep
                    tables={bundle.tables}
                    createDraft={createDraft}
                    createDraftTable={createDraftTable}
                    chartValueLabelOptions={chartValueLabelOptions}
                    setCreateDraft={setCreateDraft}
                    updateCreateDraftTable={updateCreateDraftTable}
                  />
                ) : null}

                {activeCreateStep === "filters" && createDraft.type === "report" && createDraftTable ? (
                  <ReportFiltersAndSortsEditor
                    table={createDraftTable}
                    rows={bundle.data[createDraftTable.id] || []}
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
                      {importEditingReportId ? "Save imported report setup" : editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
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

  const defaultUrl = buildHostedHashUrl(`/${activeObject.type}/${activeObject.id}`);
  const viewerUrl = buildHostedHashUrl(`/${activeObject.type}/${activeObject.id}`, { viewer: true });
  const embedUrl = buildHostedHashUrl(`/${activeObject.type}/${activeObject.id}`, { embed: true, viewer: true });
  const shortcutsSection = hasActiveObject ? (
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
  ) : null;

  return (
    <>
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" && refreshJob.status !== "cancelled" ? (
        <RefreshOverlay title="Refreshing all reports and dashboards" job={refreshJob} />
      ) : null}
      <section className={`studio-page ${activeDashboard ? "studio-page-dashboard" : "studio-page-report"}`}>
      <div className="studio-canvas">
        {shortcutsSection}
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
                  <ClearableInputField
                    label="Card search"
                    id="studio-widget-search"
                    name="studioWidgetSearch"
                    value={widgetSearch}
                    onChange={setWidgetSearch}
                    placeholder="Find cards or reports"
                  />
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
                  window.open(buildHostedHashUrl(`/studio/${reportId}`), "_blank", "noopener,noreferrer");
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
                <SharingScopeEditor
                  scope={activeDashboard.scope}
                  ownerUserId={activeDashboard.ownerUserId}
                  sharedUserIds={activeDashboard.sharedUserIds}
                  currentUserId={currentUserId}
                  rosterUsers={filteredSharingRosterUsers}
                  rosterLookup={sharingRosterLookup}
                  rosterLoading={sharingRosterLoading}
                  rosterError={sharingRosterError}
                  rosterConfigured={hasSharingRosterConfig(activeQuickbaseConfig)}
                  rosterQuery={sharingRosterQuery}
                  onRosterQueryChange={setSharingRosterQuery}
                  onScopeChange={(scope) => updateObject({
                    ...activeDashboard,
                    ...normalizeStudioBuilderScopeOwner(scope, currentUserId, activeDashboard.ownerUserId, activeDashboard.sharedUserIds)
                  })}
                  onSharedUsersChange={(sharedUserIds) => updateObject({ ...activeDashboard, sharedUserIds })}
                />
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
                <div className="card">
                  <div className="card-head">
                    <strong>Runtime filters</strong>
                    <button type="button" onClick={() => setRuntimeFilterModalOpen(true)}>Open runtime filters</button>
                  </div>
                  <div className="stack-compact">
                    <span className="micro">
                      Configure dashboard runtime filters in a dedicated modal. Fields are limited to the tables used by this dashboard.
                    </span>
                    {activeDashboard.runtimeFilters.length ? activeDashboard.runtimeFilters.map((filter) => {
                      const sourceTableId = filter.sourceTableId || (activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0]?.id || "" : "");
                      const sourceTable = activeDashboardRefreshTables.find((table) => table.id === sourceTableId) || null;
                      const fieldLabel = sourceTable?.fields.find((field) => field.id === filter.fieldId)?.label || filter.fieldId || "No field selected";
                      return (
                        <div className="inline-edit-row" key={filter.id}>
                          <strong>{filter.label}</strong>
                          <span className="micro">
                            {sourceTable ? `${sourceTable.name} · ${fieldLabel}` : fieldLabel}
                            {filter.mode === "selected" && filter.targetReportIds.length ? ` · ${filter.targetReportIds.length} selected report${filter.targetReportIds.length === 1 ? "" : "s"}` : " · all current dashboard reports"}
                          </span>
                        </div>
                      );
                    }) : <div className="empty-hint">No runtime filters yet.</div>}
                  </div>
                </div>
              </>
            ) : null}
          </div>
        </aside>
      ) : null}

      {createModalOpen ? (
        <div className="studio-modal-backdrop" onClick={closeCreateModal}>
          <section className="studio-modal" onClick={(event) => event.stopPropagation()}>
            <div className="card-head">
              <div>
                <strong>{importEditingReportId ? "Edit Imported Report Setup" : editingReportId ? "Edit Report" : `Create ${createDraft.type === "report" ? "Report" : "Dashboard"}`}</strong>
                <div className="micro">{importEditingReportId ? "Use the same builder workflow as a normal report: fields, filters, sorts, and chart setup all stay together here before the workbook import is applied." : editingReportId ? "Update the report configuration here. Changes stay in the modal instead of moving into a side setup column." : "Start fresh with the same field, filter, and sorting controls from the legacy builder."}</div>
              </div>
              <button onClick={closeCreateModal}>Close</button>
            </div>
            {importBuilderIdentity}

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
                        disabled={Boolean(editingReportId)}
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
                  <SharingScopeEditor
                    scope={createDraft.scope}
                    ownerUserId={createDraft.ownerUserId}
                    sharedUserIds={createDraft.sharedUserIds}
                    currentUserId={currentUserId}
                    rosterUsers={filteredSharingRosterUsers}
                    rosterLookup={sharingRosterLookup}
                    rosterLoading={sharingRosterLoading}
                    rosterError={sharingRosterError}
                    rosterConfigured={hasSharingRosterConfig(activeQuickbaseConfig)}
                    rosterQuery={sharingRosterQuery}
                    onRosterQueryChange={setSharingRosterQuery}
                    onScopeChange={(scope) => setCreateDraft((current) => ({
                      ...current,
                      ...normalizeStudioBuilderScopeOwner(scope, currentUserId, current.ownerUserId, current.sharedUserIds)
                    }))}
                    onSharedUsersChange={(sharedUserIds) => setCreateDraft((current) => ({ ...current, sharedUserIds }))}
                  />
                </>
              ) : null}

              {activeCreateStep === "data" && createDraft.type === "report" && createDraftTable ? (
                <StudioReportDraftDataStep
                  tables={bundle.tables}
                  createDraft={createDraft}
                  createDraftTable={createDraftTable}
                  chartValueLabelOptions={chartValueLabelOptions}
                  setCreateDraft={setCreateDraft}
                  updateCreateDraftTable={updateCreateDraftTable}
                />
              ) : null}

              {activeCreateStep === "filters" && createDraft.type === "report" && createDraftTable ? (
                <ReportFiltersAndSortsEditor
                  table={createDraftTable}
                  rows={bundle.data[createDraftTable.id] || []}
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
                    {importEditingReportId ? "Save imported report setup" : editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
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
