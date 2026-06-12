import { useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  applyDashboardRowPreset as applyDashboardRowPresetInDefinition,
  buildMergedTableForJoins,
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
  getDashboardWidgetPlacements,
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
  listUsers,
  type PlatformUser,
  type QuickbaseRealmApp,
  type QuickbaseAppSchema,
  type QuickbaseSyncResult,
  type StudioWorkbookImportResult,
  type StudioWorkbookSourceImportResult,
  fetchStudioRefreshJob,
  cancelStudioRefreshJob,
  fetchStudioVersions,
  restoreStudioVersion,
  startStudioRefresh,
  saveStudioDocument,
  fetchStudioSources,
  fetchFieldUniqueValues,
  updateSourceKeyField
} from "../lib/studioApi";
import { createExportSaveTarget, downloadExportJob, fetchExportJobStatus, fetchExportJobs, renderDashboard, startDashboardExportJob, startReportExportJob, runReport as runReportFromServer } from "../lib/api";
import { applyLaunchScopeToDocument } from "../lib/catalog";
import { buildDashboardExportDefinition } from "../lib/dashboardExport";
import { buildHostedHashUrl, buildHostedRoute } from "../lib/embed";
import { ChartPreview } from "./ChartPreview";
import { RefreshOverlay } from "./RefreshOverlay";
import { WorkbookUploadModal, type WorkbookUploadResult } from "./WorkbookUploadModal";
import { StudioDraftReviewStep } from "./StudioDraftReviewStep";
import { StudioDashboardPreview } from "./StudioDashboardPreview";
import { StudioReportDraftDataStep } from "./StudioReportDraftDataStep";
import { StudioReportDraftBasicsStep } from "./StudioReportDraftBasicsStep";
import { StudioReportDraftViewStep } from "./StudioReportDraftViewStep";
import { StudioReportPreview } from "./StudioReportPreview";
import { SearchableSelect } from "./SearchableSelect";
import { StudioSettingsPanel } from "./StudioSettingsPanel";
import { StudioWorkspaceEmptyState } from "./StudioWorkspaceEmptyState";
import { StudioWorkspaceHome } from "./StudioWorkspaceHome";
import { ClearableInputField } from "./ClearableInputField";
import {
  DEFAULT_CHART_COLORS,
  chartAggregationOptions,
  chartPrimaryFieldLabel,
  chartRequiresSeries,
  chartSeriesFieldLabel,
  chartValueFieldLabel,
  getFieldComparisonOptions,
  getChartAxisLabels,
  getSortedFieldOptions,
  normalizeChartPercentMode,
  reportShowsChart,
  reportShowsDetails,
  reportShowsSummary
} from "./studioReportUtils";

const STORAGE_KEY = "hosted-reporting-studio-v2";
const ACTIVITY_OVERLAY_MIN_MS = 700;
const WORKSPACE_REFRESH_SIGNAL_KEY = "hosted-reporting-workspace-refresh-v1";
const WORKSPACE_REFRESH_EVENT = "studio:workspace-updated";
const SHARED_WORKSPACE_SNAPSHOT_KEY = "studio-shared-workspace-snapshot-v1";
const SHARED_WORKSPACE_DIRTY_KEY = "studio-shared-workspace-dirty-v1";

type TerminalRefreshJob = RefreshJobStatus & { status: "complete" | "failed" | "cancelled" };

function isRefreshJobTerminal(job: RefreshJobStatus | null): job is null | TerminalRefreshJob {
  return !job || job.status === "complete" || job.status === "failed" || job.status === "cancelled";
}

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
  userId: string;   // stores platform user email as the stable ID
  name: string;
  email: string;
  recordId: string;
  label: string;
  keywords: string[];
}

type CreateStep = StudioBuilderStep;
type CreateObjectDraft = StudioBuilderDraft;
type DashboardAddMode = "chooser" | "existing";

interface DashboardWidgetBuilderDraft {
  reportId: string;
  titleOverride: string;
  hideTitle: boolean;
  width: number;
  height: number;
  tabId: string;
  createNewTab: boolean;
  newTabName: string;
  newTabColor: string;
  displayMode: "inherit" | "table" | "summary" | "chart";
  showSummary: boolean;
  showDetails: boolean;
}

type DashboardBuilderFlow =
  | null
  | {
      type: "create-widget-report";
      dashboardId: string;
      widgetDraft: DashboardWidgetBuilderDraft;
    }
  | {
      type: "edit-widget-report";
      dashboardId: string;
      tabId: string;
      widgetId: string;
      reportId: string;
    };

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
    sourceJoins: clone(report.sourceJoins || []),
    sourceReportOverrides: clone(report.sourceReportOverrides || {}),
    selectedFieldIds: clone(report.selectedFieldIds || []),
    filterTree: clone(report.filterTree || createFilterGroup("and", clone(report.filters || []))),
    groups: clone(report.groups || []),
    sorts: clone(report.sorts || []),
    summaryMetrics: clone(report.summaryMetrics || []),
    view: clone(report.view),
    displayLabels: clone(report.displayLabels || { fields: {}, chartValues: {} })
  };
}

function buildDashboardWidgetDraft(defaults?: Partial<DashboardWidgetBuilderDraft>): DashboardWidgetBuilderDraft {
  return {
    reportId: defaults?.reportId || "",
    titleOverride: defaults?.titleOverride || "",
    hideTitle: defaults?.hideTitle === true,
    width: Math.max(1, Math.min(12, Number(defaults?.width) || 6)),
    height: Math.max(2, Math.min(10, Number(defaults?.height) || 4)),
    tabId: defaults?.tabId || "",
    createNewTab: defaults?.createNewTab === true,
    newTabName: defaults?.newTabName || "",
    newTabColor: defaults?.newTabColor || "#0d7c66",
    displayMode: defaults?.displayMode || "inherit",
    showSummary: defaults?.showSummary ?? false,
    showDetails: defaults?.showDetails ?? false
  };
}

function normalizeSharedUserIds(userIds: string[]) {
  return Array.from(new Set((userIds || []).map((value) => String(value || "").trim()).filter(Boolean)));
}

// Platform users are always the source for sharing — no Quickbase roster needed
function hasSharingRosterConfig(_config: QuickbaseConnectionConfig) {
  return true; // sharing is always based on platform users
}

function buildSharingUserLabel(user: PlatformUser): string {
  const name = (user.displayName || "").trim();
  const email = (user.email || "").trim();
  if (name && email) return `${name} (${email})`;
  return email || name || user.id;
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
  rosterConfigured?: boolean; // kept for compat but unused
  rosterQuery: string;
  onRosterQueryChange: (value: string) => void;
  onScopeChange: (scope: StudioObjectScope) => void;
  onSharedUsersChange: (userIds: string[]) => void;
}) {
  const selectedUsers = normalizeSharedUserIds(sharedUserIds)
    .map((userId) => rosterLookup.get(userId) || {
      userId,
      name: "",
      email: userId,
      recordId: "",
      label: userId,
      keywords: []
    });

  return (
    <div className="card">
      <div className="card-head">
        <strong>Sharing</strong>
        <span className="micro">Control who can access this report or dashboard.</span>
      </div>
      <label className="field">
        <span>Access</span>
        <select value={scope} onChange={(event) => onScopeChange(event.target.value as StudioObjectScope)}>
          <option value="global">Shared with everyone — any user who can sign in</option>
          <option value="selected">Specific users or roles only</option>
          <option value="personal">Personal — only me</option>
        </select>
      </label>
      {scope === "personal" && (
        <div className="micro">Only <strong>{ownerUserId || currentUserId || "you"}</strong> can see this item.</div>
      )}
      {scope === "selected" ? (
        <div className="stack-compact">
          {rosterError ? (
            <div className="sync-status sync-status-warn">
              <strong>Could not load platform users</strong>
              <span>{rosterError}</span>
            </div>
          ) : null}
          {selectedUsers.length > 0 && (
            <div>
              <div className="micro" style={{ marginBottom: 4 }}>
                <strong>{selectedUsers.length}</strong> user{selectedUsers.length === 1 ? "" : "s"} selected:
              </div>
              <div className="badge-row">
                {selectedUsers.map((user) => (
                  <span
                    className="badge"
                    key={user.userId}
                    style={{ cursor: "pointer" }}
                    title="Click to remove"
                    onClick={() => onSharedUsersChange(sharedUserIds.filter((id) => id !== user.userId))}
                  >
                    {user.label} ✕
                  </span>
                ))}
              </div>
            </div>
          )}
          <ClearableInputField
            label="Search platform users"
            id="sharing-roster-search"
            name="sharingRosterSearch"
            value={rosterQuery}
            onChange={onRosterQueryChange}
            placeholder="Type a name or email to find users…"
          />
          <div className="card surface stack-compact">
            {rosterLoading ? (
              <div className="empty-hint">Loading platform users…</div>
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
              <div className="empty-hint">{rosterQuery ? "No users match that search." : "No platform users found."}</div>
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

function hasProfileRefreshSourceConfig(profile: { refreshSource?: { tableIds?: string[]; reportIds?: Record<string, string> } } | null | undefined) {
  const tableIds = Array.isArray(profile?.refreshSource?.tableIds) ? profile.refreshSource.tableIds.filter(Boolean) : [];
  const reportIds = Object.values(profile?.refreshSource?.reportIds || {}).filter((value) => String(value || "").trim());
  return tableIds.length > 0 || reportIds.length > 0;
}

function mergeRefreshSourceFallback(baseDocument: StudioDocument, incomingDocument: StudioDocument) {
  return normalizeStudioDocument({
    ...incomingDocument,
    activeQuickbaseProfileId: incomingDocument.activeQuickbaseProfileId || baseDocument.activeQuickbaseProfileId,
    quickbaseProfiles: incomingDocument.quickbaseProfiles.map((profile) => {
      const baseProfile = baseDocument.quickbaseProfiles.find((item) => item.id === profile.id);
      const baseKeyFieldIds = baseProfile?.refreshSource?.keyFieldIds || {};
      // Always merge keyFieldIds from the base (pre-save) document — they're local-only and not stored in QB
      const mergedKeyFieldIds = { ...(profile.refreshSource?.keyFieldIds || {}), ...baseKeyFieldIds };
      if (hasProfileRefreshSourceConfig(profile) || !hasProfileRefreshSourceConfig(baseProfile)) {
        return {
          ...profile,
          refreshSource: { ...(profile.refreshSource || {}), keyFieldIds: mergedKeyFieldIds }
        };
      }
      return {
        ...profile,
        refreshSource: {
          tableIds: [...(baseProfile?.refreshSource?.tableIds || [])],
          reportIds: { ...(baseProfile?.refreshSource?.reportIds || {}) },
          keyFieldIds: mergedKeyFieldIds
        }
      };
    })
  });
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

function buildWorkspaceSnapshotSignature(document: StudioDocument) {
  return JSON.stringify(stripLocalDocumentData(document));
}

function setSharedWorkspaceDirtyState(dirty: boolean) {
  try {
    window.localStorage.setItem(SHARED_WORKSPACE_DIRTY_KEY, dirty ? "1" : "0");
  } catch {}
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
  sourceTables: TableDefinition[];
  skippedReportIds: string[];
  reportTypeOverrides: Record<string, string>;
  baseObjects: Record<string, StudioObject>;
  currentObjects: Record<string, StudioObject>;
  importedTablesById: Record<string, TableDefinition>;
}

const IMPORT_REPORT_TYPE_OPTIONS = [
  { value: "table", label: "Table" },
  { value: "summary", label: "Summary" },
  { value: "chart:bar", label: "Bar Chart" },
  { value: "chart:line", label: "Line Chart" },
  { value: "chart:pie", label: "Pie Chart" },
  { value: "chart:doughnut", label: "Doughnut" },
  { value: "chart:area", label: "Area Chart" },
  { value: "chart:horizontalBar", label: "Horizontal Bar" },
  { value: "chart:scatter", label: "Scatter" },
  { value: "timeline", label: "Timeline" },
  { value: "calendar", label: "Calendar" },
  { value: "kanban", label: "Kanban" },
] as const;

function getImportReportTypeKey(report: StudioObject): string {
  if (report.type !== "report") return "table";
  const mode = (report as ReportDefinition).view?.mode;
  if (mode === "chart") return `chart:${(report as ReportDefinition).view?.chartType || "bar"}`;
  return mode || "table";
}

function applyImportTypeKeyToReport(report: ReportDefinition, typeKey: string): ReportDefinition {
  if (typeKey.startsWith("chart:")) {
    const chartType = typeKey.slice(6) as ReportDefinition["view"]["chartType"];
    return { ...report, view: { ...report.view, mode: "chart" as const, chartType } };
  }
  return { ...report, view: { ...report.view, mode: typeKey as ReportDefinition["view"]["mode"] } };
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

function bestMatchTable(importedTable: TableDefinition | null, candidates: TableDefinition[]): TableDefinition | null {
  if (!importedTable || !candidates.length) return null;
  const importedLabels = new Set(importedTable.fields.map((f) => f.label.trim().toLowerCase()).filter(Boolean));
  let best: TableDefinition | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const score = candidate.fields.reduce((n, f) => n + (importedLabels.has(f.label.trim().toLowerCase()) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore >= 1 ? best : null;
}

function rebuildPendingWorkbookImportObjects(
  baseObjects: Record<string, StudioObject>,
  importedTablesById: Record<string, TableDefinition>,
  targetTable: TableDefinition | null,
  skippedReportIds: string[] = [],
  reportTypeOverrides: Record<string, string> = {},
  availableTables: TableDefinition[] = []
) {
  const skippedSet = new Set(skippedReportIds);
  const nextObjects: Record<string, StudioObject> = {};
  Object.entries(baseObjects).forEach(([objectId, object]) => {
    if (object.type === "report") {
      if (skippedSet.has(objectId)) return;
      const importedTable = importedTablesById[object.sourceTableId] || null;
      const effectiveTarget = targetTable || bestMatchTable(importedTable, availableTables);
      const remapped = effectiveTarget
        ? remapImportedReportToSourceTable(object, importedTable, effectiveTarget)
        : remapImportedReportToSourceTable(object, importedTable, {
          id: "",
          name: "",
          description: "",
          fields: []
        });
      const typeOverride = reportTypeOverrides[objectId];
      const withType = typeOverride
        ? applyImportTypeKeyToReport(remapped as ReportDefinition, typeOverride)
        : remapped;
      nextObjects[objectId] = withType;
      return;
    }
    const dashboardCopy = clone(object);
    dashboardCopy.tabs = dashboardCopy.tabs
      .map((tab) => ({
        ...tab,
        widgets: tab.widgets.filter((widget) => !skippedSet.has(widget.reportId))
      }))
      .filter((tab) => tab.widgets.length > 0);
    dashboardCopy.runtimeFilters = dashboardCopy.runtimeFilters.map((filter) => ({
      ...filter,
      targetReportIds: filter.targetReportIds.filter((reportId) => !skippedSet.has(reportId))
    }));
    if (dashboardCopy.tabs.length) {
      nextObjects[objectId] = dashboardCopy;
    }
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
      chartColors: DEFAULT_CHART_COLORS,
      chartValueColors: {},
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
    if (reportShowsChart(object) && !object.view.chartFieldId) messages.push(`Choose a ${chartPrimaryFieldLabel(object.view.chartType).toLowerCase()} for the chart.`);
    if (reportShowsChart(object) && chartRequiresSeries(object.view.chartType) && !object.view.chartSeriesFieldId) messages.push(`Choose a ${chartSeriesFieldLabel(object.view.chartType).toLowerCase()} for the chart.`);
    if (reportShowsChart(object) && !chartAggregationOptions(object.view.chartType).some((option) => option.value === (object.view.chartAggregation === "avg" ? "average" : object.view.chartAggregation))) messages.push("The selected aggregation is not allowed for this chart type.");
    if (reportShowsChart(object) && object.view.chartAggregation !== "count" && !object.view.chartValueFieldId) messages.push(`Choose a ${chartValueFieldLabel(object.view.chartType).toLowerCase()} for the chart.`);
    if (reportShowsChart(object) && object.view.chartAggregation === "percent" && !normalizeChartPercentMode(object.view.chartType, object.view.chartPercentMode)) messages.push("Choose a percent mode for this chart.");
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

function FilterValueComboInput({
  sourceId,
  fieldId,
  field,
  value,
  onChange,
  existingOptions
}: {
  sourceId: string;
  fieldId: string;
  field: TableDefinition["fields"][number] | null;
  value: string;
  onChange: (v: string) => void;
  existingOptions: string[];
}) {
  const [fetchedValues, setFetchedValues] = useState<string[]>([]);
  useEffect(() => {
    if (!sourceId || !fieldId) return;
    if (field?.type === "date" || field?.type === "datetime" || field?.type === "number" || field?.type === "currency") return;
    fetchFieldUniqueValues(sourceId, fieldId)
      .then((r) => setFetchedValues(r.values))
      .catch(() => {});
  }, [sourceId, fieldId, field?.type]);
  const isDateType = field?.type === "date" || field?.type === "datetime";
  const isNumericType = field?.type === "number" || field?.type === "currency";
  if (isDateType) {
    return (
      <input
        type={field?.type === "date" ? "date" : "datetime-local"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter date"
      />
    );
  }
  if (isNumericType) {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter value"
      />
    );
  }
  const allSuggestions = Array.from(new Set([...existingOptions, ...fetchedValues]))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  const listId = `fv-${sourceId}-${fieldId}`.replace(/[^a-z0-9-]/gi, "-");
  return (
    <>
      <input
        type="text"
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Type or pick a value…"
      />
      {allSuggestions.length > 0 && (
        <datalist id={listId}>
          {allSuggestions.map((v) => <option key={v} value={v} />)}
        </datalist>
      )}
    </>
  );
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
  function renderFilterValueEditor(rule: FilterDefinition, field: TableDefinition["fields"][number] | null, valueOptions: Array<{ value: string; label: string }>) {
    const needsValue = filterNeedsValue(rule.operator);
    const comparisonFieldOptions = rule.fieldId ? getFieldComparisonOptions(table, rule.fieldId) : fieldOptions;
    if (!needsValue) return null;
    return (
      <>
        <select
          value={rule.valueSource || "literal"}
          onChange={(event) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({
            ...currentRule,
            valueSource: event.target.value as "literal" | "field",
            value: event.target.value === "field" ? "" : currentRule.value,
            compareFieldId: event.target.value === "field" ? currentRule.compareFieldId || "" : ""
          })))}
        >
          <option value="literal">{field?.type === "date" || field?.type === "datetime" ? "specific date" : "specific value"}</option>
          <option value="field">{field?.type === "date" || field?.type === "datetime" ? "the date in the field" : "the value in the field"}</option>
        </select>
        {(rule.valueSource || "literal") === "field" ? (
          <SearchableSelect
            value={rule.compareFieldId || ""}
            options={comparisonFieldOptions}
            allowEmpty
            emptyOptionLabel="Choose a comparison field"
            onChange={(value) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, compareFieldId: value })))}
          />
        ) : (
          <FilterValueComboInput
            sourceId={table.id}
            fieldId={rule.fieldId}
            field={field}
            value={rule.value}
            onChange={(value) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({ ...currentRule, value })))}
            existingOptions={valueOptions.map((o) => o.value)}
          />
        )}
      </>
    );
  }
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
            className="btn-create"
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
            className="btn-create"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onChange(addFilterGroupToGroup(group, group.id));
            }}
          >
            Add group
          </button>
          {canRemove && onRemove ? <button type="button" className="btn-danger" onClick={onRemove}>Remove group</button> : null}
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
                    value: filterNeedsValue(nextOperator) ? currentRule.value : "",
                    valueSource: "literal",
                    compareFieldId: ""
                  };
                }))}
              />
              <select
                value={rule.operator}
                onChange={(event) => onChange(updateFilterRuleInGroup(group, rule.id, (currentRule) => ({
                  ...currentRule,
                  operator: event.target.value as FilterOperator,
                  value: filterNeedsValue(event.target.value as FilterOperator) ? currentRule.value : "",
                  valueSource: filterNeedsValue(event.target.value as FilterOperator) ? (currentRule.valueSource || "literal") : "literal",
                  compareFieldId: filterNeedsValue(event.target.value as FilterOperator) ? currentRule.compareFieldId || "" : ""
                })))}
              >
                {operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              {renderFilterValueEditor(rule, field, valueOptions)}
              <button type="button" className="btn-danger" onClick={() => onChange(removeFilterNodeFromGroup(group, rule.id))}>Remove</button>
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
            className="btn-create"
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
  settingsMode = false,
  userPermissions = {},
  launchContext
}: {
  openSettingsSignal?: number;
  refreshAllSignal?: number;
  settingsMode?: boolean;
  userPermissions?: Record<string, boolean>;
  launchContext: { launchSource: "quickbase-button" | "local-dev" | null; userId: string; realmHostname: string; appId: string };
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  // Permission helper — when no permissions provided (auth off / admin), everything is allowed
  const canDo = (key: string) => Object.keys(userPermissions).length === 0 || userPermissions[key] === true;
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
  const lastRemoteSnapshotKeyRef = useRef(buildWorkspaceSnapshotSignature(scopeDocument(loadLocalDocument())));
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [savingRemote, setSavingRemote] = useState(false);
  const [history, setHistory] = useState<StudioDocument[]>([]);
  const [future, setFuture] = useState<StudioDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [libraryScopeFilter, setLibraryScopeFilter] = useState<LibraryScopeFilter>("all");
  const [librarySort, setLibrarySort] = useState<"name-asc" | "name-desc" | "updated-desc" | "updated-asc">("updated-desc");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [selectedHomeReportIds, setSelectedHomeReportIds] = useState<string[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [widgetTargetTabId, setWidgetTargetTabId] = useState("");
  const widgetSearch = "";
  const [dashboardAddModalOpen, setDashboardAddModalOpen] = useState(false);
  const [dashboardAddMode, setDashboardAddMode] = useState<DashboardAddMode>("chooser");
  const [dashboardWidgetDraft, setDashboardWidgetDraft] = useState<DashboardWidgetBuilderDraft>(buildDashboardWidgetDraft());
  const [dashboardSettingsModalOpen, setDashboardSettingsModalOpen] = useState(false);
  const [dashboardBuilderFlow, setDashboardBuilderFlow] = useState<DashboardBuilderFlow>(null);
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

  // Load platform users once for sharing — no Quickbase roster needed
  useEffect(() => {
    let cancelled = false;
    setSharingRosterLoading(true);
    setSharingRosterError("");
    void listUsers()
      .then((response) => {
        if (cancelled) return;
        const platformUsers: SharingRosterUser[] = [
          ...(response.users || []),
        ]
          .filter((u) => u.email)
          .map((u): SharingRosterUser => {
            const label = buildSharingUserLabel(u);
            return {
              userId: u.email, // use email as stable ID
              name: u.displayName || "",
              email: u.email,
              recordId: u.id || "",
              label,
              keywords: [u.displayName || "", u.email, u.role || ""]
            };
          })
          .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
        setSharingRosterUsers(platformUsers);
      })
      .catch((error) => {
        if (cancelled) return;
        setSharingRosterUsers([]);
        setSharingRosterError(error instanceof Error ? error.message : "Could not load platform users.");
      })
      .finally(() => {
        if (cancelled) return;
        setSharingRosterLoading(false);
      });
    return () => { cancelled = true; };
  }, []); // load once

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
  const [postgresReportResult, setPostgresReportResult] = useState<ReportRunResult | null>(null);
  const [liveDashboardPreviewResult, setLiveDashboardPreviewResult] = useState<DashboardRunResult | null>(null);
  const dashboardRenderVersionRef = useRef(0);
  const [postgresReportLoading, setPostgresReportLoading] = useState(false);
  const [dataImportVersion, setDataImportVersion] = useState(0);
  const [previewPage, setPreviewPage] = useState(1);
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [liveExportJobs, setLiveExportJobs] = useState<ExportJobStatus[]>([]);
  const [postgresSourceIds, setPostgresSourceIds] = useState<Set<string>>(new Set());
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
  const [xlsxUploadModalOpen, setXlsxUploadModalOpen] = useState(false);
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
  const importReviewSheetOptions = useMemo(
    () => pendingWorkbookImport
      ? pendingWorkbookImport.review.sheets
          .filter((sheet) => sheet.importedReportId)
          .map((sheet) => {
            const reportId = String(sheet.importedReportId || "");
            const report = pendingWorkbookImport.baseObjects[reportId];
            const detectedType = report?.type === "report" ? getImportReportTypeKey(report) : "table";
            const selectedType = pendingWorkbookImport.reportTypeOverrides[reportId] || detectedType;
            return {
              reportId,
              sheetName: sheet.sheetName,
              reportName: report?.type === "report" ? report.name : (sheet.sheetName || reportId),
              skipped: pendingWorkbookImport.skippedReportIds.includes(reportId),
              detectedType,
              selectedType
            };
          })
      : [],
    [pendingWorkbookImport]
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
  const activeDashboardTabOptions = useMemo(
    () => activeDashboard?.tabs.map((tab) => ({ value: tab.id, label: tab.name })) || [],
    [activeDashboard?.tabs]
  );
  const activeDashboardRuntimeFilterOptions = useMemo(() => {
    if (!activeDashboard) return {} as Record<string, Array<{ value: string; label: string }>>;
    return Object.fromEntries(
      activeDashboard.runtimeFilters.map((filter) => {
        const sourceTableId = filter.sourceTableId || (activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0]?.id || "" : "");
        return [filter.id, sourceTableId && filter.fieldId ? collectFieldValueOptions(sourceTableId, filter.fieldId) : []];
      })
    );
  }, [activeDashboard, activeDashboardRefreshTables, bundle.data, bundle.tables]);
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
      groups: createDraft.groups || [],
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
    setActivityOverlay({ title: "Importing Excel file", message: phases[phaseIndex] });
    const phaseTimer = window.setInterval(() => {
      phaseIndex = Math.min(phaseIndex + 1, phases.length - 1);
      setActivityOverlay({ title: "Importing Excel file", message: phases[phaseIndex] });
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
        const currentJob = draft.exportJobs[currentIndex];
        const nextJob = {
          ...currentJob,
          ...entry
        };
        if (JSON.stringify(currentJob) === JSON.stringify(nextJob)) {
          return;
        }
        draft.exportJobs[currentIndex] = nextJob;
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
      const table = bundle.tables.find((item) => item.id === object.sourceTableId || item.quickbaseTableId === object.sourceTableId);
      const response = await startReportExportJob({ reportId: object.id, report: object, table });
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
      dashboard: buildDashboardExportDefinition(
        object,
        Object.fromEntries(
          Object.values(bundle.objects)
            .filter((item): item is ReportDefinition => item.type === "report")
            .map((report) => [report.id, report])
        )
      ),
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

  function buildExportFilename(name: string, format: "xlsx" | "json") {
    const safe = String(name || "export")
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
    return `${safe || "export"} ${timestamp}.${format}`;
  }

  async function saveExportJobToMachine(job: StudioExportJob) {
    if (job.format !== "xlsx" || !job.sourceJobId) {
      pushToast("Only completed Excel exports can be saved here.", "warn");
      return;
    }
    const object = bundle.objects[job.objectId];
    const filename = buildExportFilename(object?.name || job.objectId, "xlsx");
    const saveTarget = await createExportSaveTarget(filename);
    if (!saveTarget) return;
    downloadExportJob(job.sourceJobId, {
      saveTarget,
      fallbackFilename: filename
    });
    pushToast("Saving export to your machine.");
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
    setSharedWorkspaceDirtyState(buildWorkspaceSnapshotSignature(documentState) !== lastRemoteSnapshotKeyRef.current);
  }, [documentState]);

  useEffect(() => {
    setDocumentState((current) => scopeDocument(current));
  }, [launchContext.appId, launchContext.launchSource, launchContext.realmHostname, launchContext.userId]);

  useEffect(() => {
    let active = true;
    setLoadingRemote(true);
    // Capture localStorage snapshot before the async fetch so we can detect objects the server
    // lost (e.g. a crash between the disk write and the Postgres write completing).
    const localSnapshot = loadLocalDocument();
    fetchStudioDocument()
      .then((response) => {
        if (!active) return;
        const next = scopeDocument(normalizeStudioDocument(response.document));
        next.sync.lastLoadedAt = new Date().toISOString();
        // If the server is missing objects that localStorage has (server lost state after a
        // restart), merge those objects back in so the next user action re-persists them.
        const serverObjectIds = new Set(Object.keys(next.bundle.objects));
        const localObjects = localSnapshot.bundle.objects || {};
        const lostIds = Object.keys(localObjects).filter(id => !serverObjectIds.has(id));
        // Record the server's snapshot BEFORE merging lost objects so the dirty indicator
        // correctly shows that the merged state hasn't been pushed to the server yet.
        lastRemoteSnapshotKeyRef.current = buildWorkspaceSnapshotSignature(next);
        let toRepush: StudioDocument | null = null;
        if (lostIds.length > 0) {
          const mergedObjects = { ...localObjects, ...next.bundle.objects };
          const lostOrderItems = (localSnapshot.bundle.order || []).filter(id => lostIds.includes(id));
          next.bundle = {
            ...next.bundle,
            objects: mergedObjects,
            order: [...new Set([...next.bundle.order, ...lostOrderItems])].filter(id => Boolean(mergedObjects[id]))
          };
          toRepush = scopeDocument(next);
        }
        setSharedWorkspaceDirtyState(false);
        setDocumentState(toRepush || next);
        // Auto-repair: push the merged state back to the server so the recovered objects
        // are durable again. Fire-and-forget; a toast will confirm when complete.
        if (toRepush != null) {
          void persistRemote(toRepush);
        }
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

  // Fetch Postgres-backed source IDs on mount so we can filter data source dropdowns
  // to only show tables that have actual data in the database (app_entities).
  useEffect(() => {
    let active = true;
    fetchStudioSources().then((response) => {
      if (!active) return;
      const ids = new Set<string>();
      for (const source of response.sources) {
        ids.add(source.sourceId);
        if (source.table?.id) ids.add(source.table.id);
        if ((source.table as { quickbaseTableId?: string } | null)?.quickbaseTableId) {
          ids.add((source.table as { quickbaseTableId?: string }).quickbaseTableId!);
        }
      }
      setPostgresSourceIds(ids);
    }).catch(() => { /* non-fatal, fall back to showing all tables */ });
    return () => { active = false; };
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
    setRuntimeValues((current) => {
      const nextEntries = Object.fromEntries(
        activeDashboard.runtimeFilters.map((filter) => [filter.id, current[filter.id] ?? (filter.defaultValue || "")])
      );
      const currentKeys = Object.keys(current);
      const nextKeys = Object.keys(nextEntries);
      if (
        currentKeys.length === nextKeys.length
        && nextKeys.every((key) => current[key] === nextEntries[key])
      ) {
        return current;
      }
      return nextEntries;
    });
  }, [activeDashboard?.id, activeDashboard?.runtimeFilters]);

  useEffect(() => {
    const nextSelectedWidgetId = resolveSelectedDashboardWidgetId(activeDashboardTab, selectedWidgetId);
    if (selectedWidgetId && nextSelectedWidgetId !== selectedWidgetId) {
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
    if (!activeDashboard) return;
    if (!dashboardAddModalOpen) return;
    setDashboardWidgetDraft((current) => {
      const fallbackTabId = activeDashboardTab?.id || activeDashboard.defaultTabId || activeDashboard.tabs[0]?.id || "";
      if (current.createNewTab || (current.tabId && activeDashboard.tabs.some((tab) => tab.id === current.tabId))) {
        return current;
      }
      return { ...current, tabId: fallbackTabId };
    });
  }, [activeDashboard, activeDashboardTab?.id, dashboardAddModalOpen]);

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

  // Fetch report result from server API for Postgres/Excel sources (no in-memory bundle data)
  useEffect(() => {
    let active = true;
    if (!activeReport || !activeTable) {
      setPostgresReportResult(null);
      setPostgresReportLoading(false);
      return;
    }
    if ((bundle.data[activeReport.sourceTableId]?.length || 0) > 0) {
      setPostgresReportResult(null);
      setPostgresReportLoading(false);
      return;
    }
    const quickbaseConfig = getQuickbaseConfigForTable(documentState, activeTable);
    if (quickbaseConfig.realmHostname && quickbaseConfig.userToken && quickbaseConfig.appId) {
      setPostgresReportResult(null);
      setPostgresReportLoading(false);
      return;
    }
    setPostgresReportLoading(true);
    runReportFromServer(activeReport.id, [], { report: activeReport })
      .then((result) => {
        if (active) { setPostgresReportResult(result); setPostgresReportLoading(false); }
      })
      .catch(() => {
        if (active) { setPostgresReportResult(null); setPostgresReportLoading(false); }
      });
    return () => { active = false; };
  }, [
    activeReport?.id,
    activeReport?.updatedAt,
    activeTable?.id,
    bundle.data,
    documentState.activeQuickbaseProfileId,
    documentState.quickbase.realmHostname,
    documentState.quickbase.userToken,
    dataImportVersion
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
  }, [
    activeDashboard?.id,
    exportJob?.id,
    exportJob?.objectId,
    exportJob?.objectType,
    exportJob?.format,
    exportJob?.status,
    exportJob?.progress,
    exportJob?.message,
    exportJob?.filename,
    exportJob?.error,
    exportJob?.updatedAt,
    exportJob?.createdAt,
    runtimeValues
  ]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "complete" || downloadedJobId === exportJob.id) return;
    setDownloadedJobId(exportJob.id);
    pushToast("Export is ready. Use Save to machine in Export.");
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
      const nextH = clampDashboardWidgetHeight(session.startH + Math.round((event.clientY - session.startY) / 96));
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
    const items = filterStudioLibraryItems(visibleObjects, {
      currentUserId,
      favorites: documentState.favorites,
      recentIds: documentState.recent,
      query: libraryQuery,
      typeFilter: libraryFilter,
      scopeFilter: libraryScopeFilter,
      favoritesOnly,
      recentOnly
    });
    return [...items].sort((a, b) => {
      if (librarySort === "name-asc") return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      if (librarySort === "name-desc") return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      if (librarySort === "updated-asc") return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(); // updated-desc default
    });
  }, [currentUserId, visibleObjects, libraryQuery, libraryFilter, libraryScopeFilter, librarySort, favoritesOnly, recentOnly, documentState.favorites, documentState.recent]);
  const filteredHomeReportIds = useMemo(
    () => filteredObjects.filter((object): object is ReportDefinition => object.type === "report").map((object) => object.id),
    [filteredObjects]
  );

  const localReportResult = useMemo(() => {
    if (!activeReport || !activeTable) return null;
    return runReport(activeReport, activeTable, bundle.data[activeReport.sourceTableId] || []);
  }, [activeReport, activeTable, bundle.data]);
  const hasCachedRowsForActiveReport = Boolean(activeReport && (bundle.data[activeReport.sourceTableId]?.length || 0) > 0);
  const reportResult = hasCachedRowsForActiveReport ? localReportResult : (liveReportResult || postgresReportResult || localReportResult);

  const activeDashboardId = activeDashboard?.id;
  useEffect(() => {
    if (!activeDashboardId) { setLiveDashboardPreviewResult(null); return; }
    const version = ++dashboardRenderVersionRef.current;
    renderDashboard(activeDashboardId, {})
      .then((result) => { if (version === dashboardRenderVersionRef.current) setLiveDashboardPreviewResult(result); })
      .catch(() => { if (version === dashboardRenderVersionRef.current) setLiveDashboardPreviewResult(null); });
  }, [activeDashboardId, dataImportVersion]);

  const dashboardResult = useMemo(() => {
    if (!activeDashboard) return null;
    // Build a lookup of live widget results fetched from Postgres via the API.
    const liveWidgetMap = new Map<string, DashboardRunResult["tabs"][number]["widgets"][number]>();
    if (liveDashboardPreviewResult) {
      for (const tab of liveDashboardPreviewResult.tabs) {
        for (const w of tab.widgets) {
          liveWidgetMap.set(w.widgetId, w);
        }
      }
    }
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
        const hasLocalData = (bundle.data[report.sourceTableId]?.length || 0) > 0;
        const liveWidget = liveWidgetMap.get(widget.id);
        const result = hasLocalData
          ? runReport(report, table, bundle.data[report.sourceTableId] || [], buildDashboardFilters(activeDashboard, report.id, runtimeValues, report.sourceTableId, widget, tab.id))
          : (liveWidget?.result ?? createEmptyDashboardReportResult(report.id, report.sourceTableId, "Preview ready"));
        return {
          widgetId: widget.id,
          widget,
          report,
          result,
          status: "complete" as const,
          message: "Preview ready"
        };
      })
    );
    return buildDashboardResult(activeDashboard, widgets);
  }, [activeDashboard, bundle, runtimeValues, liveDashboardPreviewResult]);

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
    const tab = activeDashboard.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const placements = getDashboardWidgetPlacements(tab);
    const current = placements.find((p) => p.widgetId === widgetId);
    if (!current) return;
    const w = current.endCol - current.startCol + 1;
    let newX = current.startCol;
    let newY = current.startRow;
    if (direction === "left") newX = Math.max(1, current.startCol - 1);
    else if (direction === "right") newX = Math.min(13 - w, current.startCol + 1);
    else if (direction === "up") newY = Math.max(1, current.startRow - 1);
    else if (direction === "down") newY = current.startRow + 1;
    if (newX === current.startCol && newY === current.startRow) return;
    placeDashboardWidget(tabId, widgetId, { x: newX, y: newY });
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

  function createDashboardTabInDefinition(
    dashboard: DashboardDefinition,
    options?: { name?: string; color?: string }
  ) {
    const nextTab = {
      id: uid("tab"),
      name: options?.name?.trim() || `Tab ${dashboard.tabs.length + 1}`,
      color: options?.color || "#0d7c66",
      widgets: []
    };
    return {
      dashboard: {
        ...dashboard,
        defaultTabId: dashboard.defaultTabId || nextTab.id,
        tabs: [...dashboard.tabs, nextTab]
      },
      tabId: nextTab.id
    };
  }

  function removeDashboardTabWithFallback(tabId: string) {
    if (!activeDashboard) return;
    const sourceTab = activeDashboard.tabs.find((tab) => tab.id === tabId);
    if (!sourceTab) return;
    if (activeDashboard.tabs.length === 1) {
      const resetTab = { ...sourceTab, name: sourceTab.name || "Overview", widgets: [] };
      writeObject({
        ...activeDashboard,
        defaultTabId: resetTab.id,
        tabs: [resetTab]
      });
      setActiveTabId(resetTab.id);
      setSelectedWidgetId("");
      return;
    }
    const fallbackTab = activeDashboard.tabs.find((tab) => tab.id !== tabId) || activeDashboard.tabs[0];
    const nextTabs = activeDashboard.tabs
      .filter((tab) => tab.id !== tabId)
      .map((tab) => tab.id === fallbackTab.id ? { ...tab, widgets: [...tab.widgets, ...sourceTab.widgets] } : tab);
    writeObject({
      ...activeDashboard,
      defaultTabId: activeDashboard.defaultTabId === tabId ? fallbackTab.id : activeDashboard.defaultTabId,
      tabs: nextTabs
    });
    setActiveTabId(fallbackTab.id);
    if (sourceTab.widgets.some((widget) => widget.id === selectedWidgetId)) {
      setSelectedWidgetId(sourceTab.widgets[0]?.id || "");
    }
  }

  function addDashboardWidgetWithDraft(
    draft: DashboardWidgetBuilderDraft,
    options?: { reportId?: string; afterWidgetId?: string; selectAfterAdd?: boolean }
  ) {
    if (!activeDashboard) return null;
    const reportId = options?.reportId || draft.reportId;
    const report = objects.find((object): object is ReportDefinition => object.type === "report" && object.id === reportId);
    if (!report) {
      pushToast("Choose a report or graph first.", "warn");
      return null;
    }
    let nextDashboard = clone(activeDashboard);
    let targetTabId = draft.tabId || activeDashboardTab?.id || nextDashboard.defaultTabId || nextDashboard.tabs[0]?.id || "";
    if (draft.createNewTab || !targetTabId || !nextDashboard.tabs.some((tab) => tab.id === targetTabId)) {
      const created = createDashboardTabInDefinition(nextDashboard, {
        name: draft.newTabName,
        color: draft.newTabColor
      });
      nextDashboard = created.dashboard;
      targetTabId = created.tabId;
    }
    const widgetId = uid("widget");
    const newWidget = {
      id: widgetId,
      title: draft.titleOverride.trim(),
      hideTitle: draft.hideTitle,
      zIndex: (nextDashboard.tabs.flatMap((tab) => tab.widgets).reduce((max, widget) => Math.max(max, widget.zIndex || 0), 0) || 0) + 1,
      mode: "linked" as const,
      displayMode: draft.displayMode,
      showDetails: draft.showDetails,
      showSummary: draft.showSummary,
      reportId: report.id,
      filterBehavior: "use-dashboard-filters" as const,
      runtimeFilterMappings: {},
      layout: { w: draft.width, h: draft.height }
    };
    writeObject(insertDashboardWidget(nextDashboard, targetTabId, newWidget, options?.afterWidgetId));
    setActiveTabId(targetTabId);
    if (options?.selectAfterAdd !== false) {
      setSelectedWidgetId(widgetId);
    }
    return { widgetId, tabId: targetTabId };
  }

  function addDashboardWidget(tabId: string, reportId: string, afterWidgetId?: string) {
    addDashboardWidgetWithDraft(
      buildDashboardWidgetDraft({
        reportId,
        tabId,
        width: 6,
        height: 4,
        displayMode: "inherit",
        showSummary: false,
        showDetails: false
      }),
      { afterWidgetId }
    );
  }

  function cloneSelectedDashboardReport() {
    if (!activeDashboard || !activeDashboardTab || !selectedDashboardWidget || !selectedDashboardWidgetReport) return;
    const reportCopy = clone(selectedDashboardWidgetReport);
    reportCopy.id = uid("report");
    reportCopy.name = `${selectedDashboardWidgetReport.name} Copy`;
    reportCopy.updatedAt = new Date().toISOString();

    const widgetId = uid("widget");
    const widgetCopy = {
      ...clone(selectedDashboardWidget),
      id: widgetId,
      reportId: reportCopy.id,
      snapshot: selectedDashboardWidget.mode === "copied" ? clone(reportCopy) : undefined
    };

    applyDocumentUpdate((draft) => {
      draft.bundle.objects[reportCopy.id] = reportCopy;
      draft.bundle.order.unshift(reportCopy.id);
      const dashboard = draft.bundle.objects[activeDashboard.id];
      if (!dashboard || dashboard.type !== "dashboard") return;
      draft.bundle.objects[activeDashboard.id] = insertDashboardWidget(
        dashboard,
        activeDashboardTab.id,
        widgetCopy,
        selectedDashboardWidget.id
      );
    });

    setSelectedWidgetId(widgetId);
    pushToast("Report cloned and added to the dashboard.");
  }

  function setDashboardWidgetZIndex(tabId: string, widgetId: string, direction: "forward" | "backward") {
    if (!activeDashboard) return;
    const currentLevels = activeDashboard.tabs.flatMap((tab) => tab.widgets.map((widget) => widget.zIndex || 0));
    const maxZ = currentLevels.length ? Math.max(...currentLevels) : 0;
    updateActiveDashboardWidget(tabId, widgetId, (widget) => ({
      ...widget,
      zIndex: direction === "forward" ? maxZ + 1 : Math.max(0, (widget.zIndex || 0) - 1)
    }));
  }

  function resetDashboardWidgetSize(tabId: string, widgetId: string) {
    if (!activeDashboard) return;
    updateActiveDashboardWidget(tabId, widgetId, (widget) => ({
      ...widget,
      layout: {
        ...widget.layout,
        w: 6,
        h: widget.displayMode === "summary" ? 3 : 4
      }
    }));
  }

  function resetDashboardWidgetPosition(tabId: string, widgetId: string) {
    if (!activeDashboard) return;
    placeDashboardWidget(tabId, widgetId, { x: 1, y: 1 });
  }

  function alignDashboardWidget(tabId: string, widgetId: string, edge: "left" | "right" | "top" | "bottom") {
    if (!activeDashboard) return;
    const widget = activeDashboard.tabs.find((tab) => tab.id === tabId)?.widgets.find((candidate) => candidate.id === widgetId);
    if (!widget) return;
    const layout = widget.layout || { w: 6, h: 4, x: 1, y: 1 };
    const rows = resolveDashboardRowsForTab(tabId);
    const bottomRow = rows[rows.length - 1];
    if (edge === "left") {
      placeDashboardWidget(tabId, widgetId, { x: 1, y: layout.y || 1 });
      return;
    }
    if (edge === "right") {
      placeDashboardWidget(tabId, widgetId, { x: Math.max(1, 13 - clampDashboardWidgetWidth(layout.w)), y: layout.y || 1 });
      return;
    }
    if (edge === "top") {
      placeDashboardWidget(tabId, widgetId, { x: layout.x || 1, y: 1 });
      return;
    }
    placeDashboardWidget(tabId, widgetId, { x: layout.x || 1, y: Math.max(1, (bottomRow?.endRow || 1) - clampDashboardWidgetHeight(layout.h) + 1) });
  }

  function moveDashboardWidgetToNewTab(widget: DashboardDefinition["tabs"][number]["widgets"][number], tabName: string, color: string) {
    if (!activeDashboard || !activeDashboardTab) return;
    const created = createDashboardTabInDefinition(activeDashboard, { name: tabName, color });
    const moved = moveDashboardWidgetToTabInDefinition(created.dashboard, activeDashboardTab.id, widget.id, created.tabId);
    writeObject(moved);
    setActiveTabId(created.tabId);
    setSelectedWidgetId(widget.id);
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

  function openDashboardAddModal() {
    if (!activeDashboard) return;
    setDashboardAddMode("chooser");
    setDashboardWidgetDraft(buildDashboardWidgetDraft({
      tabId: activeDashboardTab?.id || activeDashboard.defaultTabId || activeDashboard.tabs[0]?.id || "",
      titleOverride: "",
      hideTitle: false,
      width: 6,
      height: 4,
      displayMode: "inherit",
      showSummary: false,
      showDetails: false
    }));
    setDashboardAddModalOpen(true);
  }

  async function saveDashboardBeforeBuilderAction(activityMessage: string) {
    if (!activeDashboard) return;
    await runWithActivityOverlay("Saving dashboard", activityMessage, async () => {
      await persistRemote(documentState);
    });
  }

  async function beginCreateDashboardReport() {
    if (!activeDashboard) return;
    await saveDashboardBeforeBuilderAction("Saving the current dashboard before opening the report builder…");
    setDashboardBuilderFlow({
      type: "create-widget-report",
      dashboardId: activeDashboard.id,
      widgetDraft: dashboardWidgetDraft
    });
    setDashboardAddModalOpen(false);
    await openCreateModal("report");
  }

  async function beginEditDashboardWidgetReport(widget: DashboardDefinition["tabs"][number]["widgets"][number], report: ReportDefinition) {
    if (!activeDashboard || !activeDashboardTab) return;
    setSelectedWidgetId("");
    await saveDashboardBeforeBuilderAction("Saving the current dashboard before opening the report editor…");
    setDashboardBuilderFlow({
      type: "edit-widget-report",
      dashboardId: activeDashboard.id,
      tabId: activeDashboardTab.id,
      widgetId: widget.id,
      reportId: report.id
    });
    openEditReportModal(report);
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

  function handleCloseCreateModal() {
    closeCreateModal();
    setDashboardBuilderFlow(null);
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
        showSummary: current.view.showSummary ?? false,
        showDetails: current.view.showDetails ?? false,
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
        defaultTabId: "",
        tabs: [{ id: uid("tab"), name: "Overview", color: "#0d7c66", widgets: [] }]
      };
      dashboard.defaultTabId = dashboard.tabs[0].id;
      const nextDocument = clone(documentState);
      nextDocument.bundle.objects[dashboard.id] = dashboard;
      if (!nextDocument.bundle.order.includes(dashboard.id)) {
        nextDocument.bundle.order.unshift(dashboard.id);
      }
      setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
      setFuture([]);
      setDocumentState(nextDocument);
      closeCreateModal();
      navigate(buildHostedRoute(`/studio/${dashboard.id}`));
      pushToast("Dashboard created.");
      void persistRemote(nextDocument);
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
      sourceJoins: clone(createDraft.sourceJoins || []),
      sourceReportOverrides: clone(createDraft.sourceReportOverrides),
      selectedFieldIds: createDraft.selectedFieldIds,
      filters: flattenFilterTree(createDraft.filterTree),
      filterTree: clone(createDraft.filterTree),
      groups: clone(createDraft.groups || []),
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
          pushToast("All reports are ready. Click Save to create the dashboard and reports.");
        } else {
          pushToast(`Imported report saved. ${remainingReports.length} report${remainingReports.length === 1 ? "" : "s"} still need review.`);
        }
        return;
      }
      pushToast("Imported report setup updated.");
      return;
    }
    const nextDocument = clone(documentState);
    nextDocument.bundle.objects[report.id] = report;
    if (!nextDocument.bundle.order.includes(report.id)) {
      nextDocument.bundle.order.unshift(report.id);
    }
    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    closeCreateModal();
    if (dashboardBuilderFlow?.type === "create-widget-report" && dashboardBuilderFlow.dashboardId === activeDashboard?.id && !existingReport) {
      const added = addDashboardWidgetWithDraft(dashboardBuilderFlow.widgetDraft, { reportId: report.id });
      setDashboardBuilderFlow(null);
      pushToast(added ? "Report created and added to the dashboard." : "Report created.");
      void persistRemote(nextDocument);
      return;
    }
    if (dashboardBuilderFlow?.type === "edit-widget-report" && dashboardBuilderFlow.dashboardId === activeDashboard?.id && dashboardBuilderFlow.reportId === report.id) {
      setDashboardBuilderFlow(null);
      pushToast("Report updated and dashboard preserved.");
      void persistRemote(nextDocument);
      return;
    }
    navigate(buildHostedRoute(`/studio/${report.id}`));
    pushToast(existingReport ? "Report updated." : "Report created.");
    void persistRemote(nextDocument);
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
    const removedObject = bundle.objects[objectId];
    delete nextDocument.bundle.objects[objectId];
    nextDocument.bundle.order = nextDocument.bundle.order.filter((item) => item !== objectId);
    nextDocument.favorites = nextDocument.favorites.filter((item) => item !== objectId);
    nextDocument.recent = nextDocument.recent.filter((item) => item !== objectId);
    delete nextDocument.personalOverrides.dashboards[objectId];
    if (removedObject?.type === "report") {
      removeDeletedReportsFromDashboards(nextDocument, [objectId]);
    }

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    navigate(buildHostedRoute(`/studio/${nextDocument.bundle.order[0] || ""}`));
    pushToast(`${removedObject?.type === "dashboard" ? "Dashboard" : "Object"} removed.`, "warn");
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

  async function persistRemote(nextDocument: StudioDocument, options?: { removedObjectIds?: string[]; silent?: boolean }): Promise<boolean> {
    setSavingRemote(true);
    try {
      const response = await saveStudioDocument(nextDocument, { removedObjectIds: options?.removedObjectIds || [] });
      const persistedDocument = mergeRefreshSourceFallback(nextDocument, normalizeStudioDocument(response.document));
      if (options?.removedObjectIds?.length) {
        stripRemovedObjectIds(persistedDocument, options.removedObjectIds);
      }
      const scopedPersistedDocument = scopeDocument(persistedDocument);
      lastRemoteSnapshotKeyRef.current = buildWorkspaceSnapshotSignature(scopedPersistedDocument);
      setSharedWorkspaceDirtyState(false);
      setDocumentState(scopedPersistedDocument);
      notifyWorkspaceUpdated();
      setLastQuickbaseSync(response.sync || null);
      if (!options?.silent) {
        if (response.sync?.enabled) {
          if (response.sync.ok) {
            pushToast(`${response.sync.message} ${response.sync.savedObjects} objects · ${response.sync.savedSettings} settings · ${response.sync.savedVersions} versions.`, "ok");
          } else {
            pushToast(response.sync.message, "warn");
          }
        } else {
          pushToast("Hosted studio saved.");
        }
      }
      return true;
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
      return false;
    } finally {
      setSavingRemote(false);
    }
  }

  async function loadHostedDocumentIntoState(options?: {
    resetHistory?: boolean;
    successMessage?: string;
    failureMessage?: string;
  }) {
    const response = await fetchStudioDocument();
    const next = scopeDocument(mergeRefreshSourceFallback(documentState, normalizeStudioDocument(response.document)));
    next.sync.lastLoadedAt = new Date().toISOString();
    lastRemoteSnapshotKeyRef.current = buildWorkspaceSnapshotSignature(next);
    setSharedWorkspaceDirtyState(false);
    setDocumentState(next);
    if (options?.resetHistory) {
      setHistory([]);
      setFuture([]);
    }
    if (options?.successMessage) {
      pushToast(options.successMessage);
    }
    return next;
  }

  async function saveRemote() {
    await runWithActivityOverlay("Saving settings", "Saving all platform settings and workspace changes…", async () => {
      await persistRemote(documentState);
      try {
        await loadHostedDocumentIntoState();
      } catch (error) {
        pushToast(error instanceof Error ? `Saved changes, but the hosted studio could not be reloaded: ${error.message}` : "Saved changes, but the hosted studio could not be reloaded.", "warn");
      }
    });
  }

  async function reloadRemote(options: { showOverlay?: boolean } = {}) {
    const action = async () => {
      try {
        await loadHostedDocumentIntoState({
          resetHistory: true,
          successMessage: "Reloaded hosted studio."
        });
      } catch (error) {
        pushToast(error instanceof Error ? error.message : "Reload failed.", "danger");
      }
    };
    if (options.showOverlay === false) {
      await action();
      return;
    }
    await runWithActivityOverlay("Loading from server", "Loading all hosted platform settings and workspace changes…", action);
  }

  async function loadQuickbaseMetadata(silent = false) {
    const profile = activeQuickbaseProfile;
    if (!profile) {
      pushToast("Add a Quickbase app profile first.", "warn");
      return null;
    }
    setQuickbaseSchemaLoading(true);
    try {
      return await runWithActivityOverlay("Loading tables and fields", `Loading the data schema for ${profile.label}…`, async () => {
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
      await runWithActivityOverlay("Finding apps", `Looking up apps you can access in ${profile.quickbase.realmHostname}…`, async () => {
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
      const existingKeyFieldIds = profile.refreshSource.keyFieldIds || {};
      profile.refreshSource.keyFieldIds = Object.fromEntries(
        Object.entries(existingKeyFieldIds).filter(([tableId]) => nextTableIds.includes(tableId))
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

  function updateRefreshSourceKeyFieldId(tableId: string, keyFieldId: string) {
    applyDocumentUpdate((draft) => {
      const profile = draft.quickbaseProfiles.find((item) => item.id === draft.activeQuickbaseProfileId);
      if (!profile) return;
      profile.refreshSource.keyFieldIds = {
        ...(profile.refreshSource.keyFieldIds || {}),
        [tableId]: keyFieldId
      };
    });
    // Also persist immediately to app_entities so key field survives without explicit Save
    void updateSourceKeyField(tableId, keyFieldId).catch(() => {});
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
    if (isRefreshJobTerminal(refreshJob)) return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then(async (response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshingCache(false);
            pushToast(`Refreshed ${response.job.tableCount || 0} tables and cached ${(response.job.rowCount || 0).toLocaleString()} rows.`, "ok");
            setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
            await reloadRemote({ showOverlay: false });
            setDataImportVersion((v) => v + 1);
            setRefreshJob(null);
          } else if (response.job.status === "cancelled") {
            setRefreshingCache(false);
            pushToast("Data sync cancelled.", "warn");
          } else if (response.job.status === "failed") {
            setRefreshingCache(false);
            pushToast(response.job.error || response.job.message, "danger");
          }
        })
        .catch((error) => {
          setRefreshJob((current) => current && current.id === refreshJob.id && !isRefreshJobTerminal(current)
            ? {
                ...current,
                message: error instanceof Error
                  ? `Data sync is running — status check failed momentarily. Still syncing… (${error.message})`
                  : "Data sync is running — status check failed momentarily. Still syncing…"
              }
            : current);
        });
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  useEffect(() => {
    if (!refreshJob) return;
    if (refreshJob.status === "complete") {
      setRefreshingCache(false);
      setRefreshJob({ ...refreshJob, status: "running", progress: 99, message: "Loading refreshed data…" });
      void reloadRemote({ showOverlay: false }).finally(() => {
        setDataImportVersion((v) => v + 1);
        setRefreshJob(null);
      });
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
    if (drawer === "settings") {
      void reloadRemote({ showOverlay: false });
    }
  }, [drawer]);

  useEffect(() => {
    const sourceTableId = pendingWorkbookImport?.sourceTableId || "";
    if (!sourceTableId || sourceTableId === lastImportPreloadTableIdRef.current) return;
    lastImportPreloadTableIdRef.current = sourceTableId;
    void startStudioRefresh(activeQuickbaseProfile?.id || "")
      .then(() => undefined)
      .catch(() => undefined);
  }, [pendingWorkbookImport?.sourceTableId]);

  // When a data-source import pre-sets sourceTableId but the bundle wasn't ready yet,
  // rebuild currentObjects once the source table appears in bundle.tables.
  useEffect(() => {
    if (!pendingWorkbookImport?.sourceTableId) return;
    const sourceTable = bundle.tables.find((t) => t.id === pendingWorkbookImport.sourceTableId);
    if (!sourceTable) return;
    const needsRemap = Object.values(pendingWorkbookImport.currentObjects).some((obj) => {
      if (!obj || obj.type !== "report") return false;
      return Boolean(pendingWorkbookImport.importedTablesById[(obj as ReportDefinition).sourceTableId]);
    });
    if (!needsRemap) return;
    setPendingWorkbookImport((current) => {
      if (!current) return current;
      const st = bundle.tables.find((t) => t.id === current.sourceTableId);
      if (!st) return current;
      return {
        ...current,
        currentObjects: rebuildPendingWorkbookImportObjects(current.baseObjects, current.importedTablesById, st, current.skippedReportIds, current.reportTypeOverrides)
      };
    });
  }, [pendingWorkbookImport?.sourceTableId, bundle.tables]);

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
        const next = scopeDocument(normalizeStudioDocument(saved.document));
        lastRemoteSnapshotKeyRef.current = buildWorkspaceSnapshotSignature(next);
        setSharedWorkspaceDirtyState(false);
        setDocumentState(next);
        setLastQuickbaseSync(saved.sync || null);
        const response = await startStudioRefresh(activeQuickbaseProfile?.id || "");
        setRefreshJob(response.job);
        if (response.job.status === "complete") {
          setRefreshingCache(false);
          pushToast(`Refreshed ${response.job.tableCount || 0} tables and cached ${(response.job.rowCount || 0).toLocaleString()} rows.`, "ok");
          setRefreshJob({ ...response.job, status: "running", progress: 99, message: "Loading refreshed data…" });
          await reloadRemote({ showOverlay: false });
          setRefreshJob(null);
        } else if (response.job.status === "cancelled") {
          setRefreshingCache(false);
          pushToast(response.job.message || "Data sync cancelled.", "warn");
        } else if (response.job.status === "failed") {
          setRefreshingCache(false);
          pushToast(response.job.error || response.job.message || "Data sync failed.", "danger");
        }
      });
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Data sync failed.", "danger");
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
        sourceTables: [],
        skippedReportIds: [],
        reportTypeOverrides: {},
        baseObjects,
        currentObjects: rebuildPendingWorkbookImportObjects(baseObjects, importedTablesById, targetTable, [], {}),
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

  async function handleWorkbookUploadSuccess(result: WorkbookUploadResult) {
    if ((result.mode === "template" || result.mode === "data-source") && result.workbookImport) {
      // Reload first so bundle.tables has the source table (important for data-source mode)
      if (result.mode === "data-source" && result.sourceImport) {
        await loadHostedDocumentIntoState({ resetHistory: false });
      }
      const response = result.workbookImport;
      const sourceTables = result.mode === "data-source"
        ? ((result.sourceImport as StudioWorkbookSourceImportResult | undefined)?.sources || [])
            .map((s) => s.table)
            .filter((t): t is TableDefinition => Boolean(t))
        : [];
      const sourceId = sourceTables.length === 1 ? sourceTables[0].id : "";
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
      const targetTable = sourceTables.length === 1 ? sourceTables[0] : null;
      if (sourceTables.length > 0) {
        setPostgresSourceIds((prev) => {
          const updated = new Set(prev);
          for (const t of sourceTables) updated.add(t.id);
          return updated;
        });
      }
      setPendingWorkbookImport({
        review: response.review,
        warnings: response.warnings,
        primaryObjectId: response.primaryObjectId,
        importedObjectIds: response.importedObjectIds,
        sourceTableId: sourceId,
        sourceTables,
        skippedReportIds: [],
        reportTypeOverrides: {},
        baseObjects,
        currentObjects: rebuildPendingWorkbookImportObjects(baseObjects, importedTablesById, targetTable, [], {}, sourceTables),
        importedTablesById
      });
      setImportReviewModalOpen(true);
      const importedType = response.review.dashboardCreated ? "dashboard workbook" : response.importedObjectIds.length > 1 ? "workbook" : "sheet";
      const sourcePart = sourceId ? ` Data imported to "${(result.sourceImport as { sources?: { sourceName: string }[] } | undefined)?.sources?.[0]?.sourceName || "source"}". ` : "";
      pushToast(`Parsed ${importedType} from workbook.${sourcePart} Review report types and save.`);
    } else if (result.mode === "data-source" && result.sourceImport) {
      // Data-only reimport (recreate=false), no report creation
      await loadHostedDocumentIntoState({ resetHistory: false });
      setDataImportVersion((v) => v + 1);
      fetchStudioSources().then((response) => {
        const ids = new Set<string>();
        for (const source of response.sources) {
          ids.add(source.sourceId);
          if (source.table?.id) ids.add(source.table.id);
          if ((source.table as { quickbaseTableId?: string } | null)?.quickbaseTableId) {
            ids.add((source.table as { quickbaseTableId?: string }).quickbaseTableId!);
          }
        }
        setPostgresSourceIds(ids);
      }).catch(() => {});
      const { sources } = result.sourceImport as typeof result.sourceImport & { sources: { sourceName: string }[] };
      const sourcePart = sources.length === 1 ? `"${sources[0].sourceName}"` : `${sources.length} data sources`;
      pushToast(`Imported ${sourcePart}.`);
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
    const finalImportedObjectIds = importState.importedObjectIds.filter((objectId) => Boolean(importState.currentObjects[objectId]));
    const finalImportedReports = finalImportedObjectIds
      .map((objectId) => importState.currentObjects[objectId])
      .filter((object): object is ReportDefinition => Boolean(object) && object.type === "report");
    // For multi-source imports, reports already have individual sourceTableIds set; check those instead
    const reportsHaveValidTables = finalImportedReports.length > 0 && finalImportedReports.every((r) =>
      r.sourceTableId && (bundle.tables.some((t) => t.id === r.sourceTableId) || importState.sourceTables.some((t) => t.id === r.sourceTableId))
    );
    if (!sourceTable && !reportsHaveValidTables) {
      pushToast("Choose the real source table before creating imported reports.", "warn");
      return;
    }
    if (!finalImportedReports.length) {
      pushToast("Keep at least one imported tab before creating the dashboard.", "warn");
      return;
    }
    const issues = finalImportedObjectIds.flatMap((objectId) => {
      const object = importState.currentObjects[objectId];
      if (!object || object.type !== "report") return [];
      const reportTable = sourceTable || bundle.tables.find((t) => t.id === object.sourceTableId) || importState.sourceTables.find((t) => t.id === object.sourceTableId) || null;
      return collectReportImportIssues(object, reportTable);
    });
    if (issues.length) {
      pushToast("Resolve the remaining imported field issues before creating the workbook objects.", "warn");
      return;
    }
    const nextDocument = clone(documentState);
    finalImportedObjectIds.forEach((objectId) => {
      const object = importState.currentObjects[objectId];
      if (!object) return;
      nextDocument.bundle.objects[objectId] = clone(object);
    });
    nextDocument.bundle.order = [
      ...finalImportedObjectIds,
      ...nextDocument.bundle.order.filter((objectId) => !importState.importedObjectIds.includes(objectId))
    ];

    setHistory((previous) => [clone(documentState), ...previous].slice(0, 60));
    setFuture([]);
    setDocumentState(nextDocument);
    setLastWorkbookImportReview(importState.review);
    setLastWorkbookImportObjectIds(finalImportedObjectIds);
    setPendingWorkbookImport(null);
    setImportReviewModalOpen(false);
    const nextPrimaryObjectId = importState.currentObjects[importState.primaryObjectId]
      ? importState.primaryObjectId
      : finalImportedObjectIds[0] || "";
    const sourceLabel = sourceTable?.name || (importState.sourceTables.length > 1 ? `${importState.sourceTables.length} data sources` : importState.sourceTables[0]?.name || "source data");
    // Save FIRST — only navigate after confirmed server save so the portal sees the
    // new objects immediately. Retry once on failure. If still failing, stay on the
    // current page so the user can retry via the Save button; do NOT navigate because
    // the dashboard builder would appear correct from local state but vanish on reload.
    let saved = await persistRemote(nextDocument, { silent: true });
    if (!saved) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2000));
      saved = await persistRemote(nextDocument, { silent: true });
    }
    if (saved) {
      pushToast(`Created imported ${importState.review.dashboardCreated ? "dashboard and reports" : "reports"} using ${sourceLabel}.`);
      if (nextPrimaryObjectId) {
        navigate(buildHostedRoute(`/studio/${nextPrimaryObjectId}`));
      }
    } else {
      pushToast(`Import created but could not save to server. Use the Save button to retry — do not reload until saved.`, "danger");
      // Do not navigate — user stays on the page with the dirty indicator visible.
    }
    setDataImportVersion((v) => v + 1);
    fetchStudioSources().then((response) => {
      const ids = new Set<string>();
      for (const source of response.sources) {
        ids.add(source.sourceId);
        if (source.table?.id) ids.add(source.table.id);
        if ((source.table as { quickbaseTableId?: string } | null)?.quickbaseTableId) {
          ids.add((source.table as { quickbaseTableId?: string }).quickbaseTableId!);
        }
      }
      setPostgresSourceIds(ids);
    }).catch(() => {});
  }

  function updatePendingImportSourceTable(tableId: string) {
    const targetTable = bundle.tables.find((table) => table.id === tableId) || null;
    setPendingWorkbookImport((current) => {
      if (!current) return current;
      return {
        ...current,
        sourceTableId: tableId,
        currentObjects: rebuildPendingWorkbookImportObjects(current.baseObjects, current.importedTablesById, targetTable, current.skippedReportIds, current.reportTypeOverrides)
      };
    });
  }

  function updatePendingImportSkippedReports(reportIds: string[]) {
    setPendingWorkbookImport((current) => {
      if (!current) return current;
      const nextSkippedReportIds = Array.from(new Set(reportIds.map((value) => String(value || "").trim()).filter(Boolean)));
      const sourceTable = current.sourceTableId ? bundle.tables.find((table) => table.id === current.sourceTableId) || null : null;
      return {
        ...current,
        skippedReportIds: nextSkippedReportIds,
        currentObjects: rebuildPendingWorkbookImportObjects(current.baseObjects, current.importedTablesById, sourceTable, nextSkippedReportIds, current.reportTypeOverrides, current.sourceTables)
      };
    });
  }

  function updatePendingImportReportType(reportId: string, typeKey: string) {
    setPendingWorkbookImport((current) => {
      if (!current) return current;
      const nextOverrides = { ...current.reportTypeOverrides, [reportId]: typeKey };
      const sourceTable = current.sourceTableId ? bundle.tables.find((table) => table.id === current.sourceTableId) || null : null;
      return {
        ...current,
        reportTypeOverrides: nextOverrides,
        currentObjects: rebuildPendingWorkbookImportObjects(current.baseObjects, current.importedTablesById, sourceTable, current.skippedReportIds, nextOverrides, current.sourceTables)
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
        <WorkbookUploadModal
          open={xlsxUploadModalOpen}
          onClose={() => setXlsxUploadModalOpen(false)}
          onSuccess={(result) => { void handleWorkbookUploadSuccess(result); }}
        />
        {importReviewModalOpen && (pendingWorkbookImport || lastWorkbookImportReview) ? (
          <div className="studio-modal-backdrop">
            <section className="studio-modal studio-import-review-modal">
              <div className="card-head">
                <div>
                  <strong>Imported workbook review</strong>
                  <div className="micro">
                    {(pendingWorkbookImport?.review || lastWorkbookImportReview)?.workbookName} · {importedReviewReports.length} report{importedReviewReports.length === 1 ? "" : "s"}
                    {importedReviewDashboardCount ? ` · ${importedReviewDashboardCount} dashboard candidate${importedReviewDashboardCount === 1 ? "" : "s"}` : ""}
                  </div>
                </div>
                <button type="button" className="btn-neutral" onClick={closeImportReviewModal}>{pendingWorkbookImport ? "Cancel import" : "Close"}</button>
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

              {pendingWorkbookImport && importReviewSheetOptions.length ? (
                <div className="card import-review-sheets-card">
                  <div className="card-head">
                    <strong>Reports &amp; charts found in workbook</strong>
                    <div className="micro">Toggle on to create · sorted by tab</div>
                  </div>
                  <div className="import-review-sheet-list">
                    {(() => {
                      const tabKey = (name: string) => name.includes(" · ") ? name.split(" · ")[0] : name;
                      const reportDisplayName = (name: string) => name.includes(" · ") ? name.split(" · ").slice(1).join(" · ") : name;
                      const sorted = [...importReviewSheetOptions].sort((a, b) =>
                        a.sheetName.localeCompare(b.sheetName, undefined, { numeric: true, sensitivity: "base" })
                      );
                      const groups: { tabName: string; items: typeof sorted }[] = [];
                      sorted.forEach((item) => {
                        const itemTabName = tabKey(item.sheetName);
                        const last = groups[groups.length - 1];
                        if (last && last.tabName === itemTabName) {
                          last.items.push(item);
                        } else {
                          groups.push({ tabName: itemTabName, items: [item] });
                        }
                      });
                      return groups.flatMap(({ tabName, items }) => [
                        <div className="import-review-tab-header" key={`tab-${tabName}`}>{tabName}</div>,
                        ...items.map((item) => (
                          <div className={`import-review-sheet-row${item.skipped ? " import-review-sheet-row--off" : ""}`} key={item.reportId}>
                            <label className="import-review-sheet-toggle">
                              <input
                                type="checkbox"
                                checked={!item.skipped}
                                onChange={(event) => {
                                  const nextSkipped = event.target.checked
                                    ? pendingWorkbookImport.skippedReportIds.filter((id) => id !== item.reportId)
                                    : Array.from(new Set([...pendingWorkbookImport.skippedReportIds, item.reportId]));
                                  updatePendingImportSkippedReports(nextSkipped);
                                }}
                              />
                            </label>
                            <div className="import-review-sheet-info">
                              <span className="import-review-sheet-name">{reportDisplayName(item.reportName)}</span>
                            </div>
                            {!item.skipped ? (
                              <select
                                className="import-review-type-select"
                                value={item.selectedType}
                                onChange={(e) => updatePendingImportReportType(item.reportId, e.target.value)}
                              >
                                {IMPORT_REPORT_TYPE_OPTIONS.map((opt) => (
                                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="import-review-sheet-skip-label">skip</span>
                            )}
                          </div>
                        ))
                      ]);
                    })()}
                  </div>
                </div>
              ) : null}

              <div className="stack">
                {(pendingWorkbookImport ? importedReviewReports : importedReviewReports).map(({ report, table }) => {
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
                            {report.view.mode === "chart" ? report.view.chartType : report.view.mode} · {table?.name || (pendingWorkbookImport ? "Select a source table above" : "No source table")}
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
                {!importedReviewReports.length ? (
                  <div className="empty-hint">
                    {pendingWorkbookImport
                      ? "No reports were found in this workbook."
                      : "No imported reports are available to review."}
                  </div>
                ) : null}
              </div>
              {pendingWorkbookImport ? (
                <div className="studio-actions">
                  <button type="button" className="ghost-button btn-neutral" onClick={closeImportReviewModal}>Cancel</button>
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
        {dashboardAddModalOpen && activeDashboard ? (
          <div className="studio-modal-backdrop">
            <section className="studio-modal studio-dashboard-builder-modal">
              <div className="card-head">
                <div>
                  <strong>Add report/graph</strong>
                  <div className="micro">Create a new report/graph or place an existing one on this dashboard.</div>
                </div>
                <button type="button" className="btn-neutral" onClick={() => setDashboardAddModalOpen(false)}>Close</button>
              </div>
              <div className="builder-stepper">
                <button type="button" className={dashboardAddMode === "chooser" ? "active-tab" : ""} onClick={() => setDashboardAddMode("chooser")}>Choose action</button>
                <button type="button" className={dashboardAddMode === "existing" ? "active-tab" : ""} onClick={() => setDashboardAddMode("existing")}>Add existing</button>
              </div>
              {dashboardAddMode === "chooser" ? (
                <div className="summary-grid">
                  <button type="button" className="summary-card dashboard-builder-action-card" onClick={() => void beginCreateDashboardReport()}>
                    <strong>Create new report/graph</strong>
                    <span>Autosave the dashboard, open the existing report builder in this window, then place the new report automatically.</span>
                  </button>
                  <button type="button" className="summary-card dashboard-builder-action-card" onClick={() => setDashboardAddMode("existing")}>
                    <strong>Add existing report/graph</strong>
                    <span>Search an existing report, set widget overrides, choose a tab, and place it on the grid.</span>
                  </button>
                </div>
              ) : (
                <div className="stack">
                  <div className="filter-grid compact-grid">
                    <label className="field">
                      <span>Existing report/graph</span>
                      <SearchableSelect value={dashboardWidgetDraft.reportId} options={reportObjectOptions} allowEmpty emptyOptionLabel="Choose a saved report" onChange={(value) => setDashboardWidgetDraft((current) => ({ ...current, reportId: value }))} />
                    </label>
                    <label className="field">
                      <span>Title override</span>
                      <input value={dashboardWidgetDraft.titleOverride} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, titleOverride: event.target.value }))} placeholder="Leave blank to use the report title" />
                    </label>
                    <label className="toggle-row"><input type="checkbox" checked={dashboardWidgetDraft.hideTitle} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, hideTitle: event.target.checked }))} /> Hide title</label>
                    <label className="field-inline"><span>Width</span><input type="number" min="1" max="12" value={dashboardWidgetDraft.width} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, width: Number(event.target.value) }))} /></label>
                    <label className="field-inline"><span>Height</span><input type="number" min="2" max="10" value={dashboardWidgetDraft.height} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, height: Number(event.target.value) }))} /></label>
                    <label className="field">
                      <span>Display mode</span>
                      <select value={dashboardWidgetDraft.displayMode} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, displayMode: event.target.value as DashboardWidgetBuilderDraft["displayMode"] }))}>
                        <option value="inherit">Inherit report view</option>
                        <option value="table">Table</option>
                        <option value="summary">Metrics / KPI</option>
                        <option value="chart">Chart</option>
                      </select>
                    </label>
                    <label className="toggle-row"><input type="checkbox" checked={dashboardWidgetDraft.showSummary} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, showSummary: event.target.checked }))} /> Show summary metrics</label>
                    <label className="toggle-row"><input type="checkbox" checked={dashboardWidgetDraft.showDetails} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, showDetails: event.target.checked }))} /> Show row details</label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field">
                      <span>Target tab</span>
                      <select value={dashboardWidgetDraft.createNewTab ? "__new__" : dashboardWidgetDraft.tabId} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, createNewTab: event.target.value === "__new__", tabId: event.target.value === "__new__" ? current.tabId : event.target.value }))}>
                        {activeDashboardTabOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        <option value="__new__">Create new tab</option>
                      </select>
                    </label>
                    {dashboardWidgetDraft.createNewTab ? (
                      <>
                        <label className="field"><span>New tab name</span><input value={dashboardWidgetDraft.newTabName} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, newTabName: event.target.value }))} /></label>
                        <label className="field"><span>New tab color</span><input type="color" value={dashboardWidgetDraft.newTabColor} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, newTabColor: event.target.value }))} /></label>
                      </>
                    ) : null}
                  </div>
                  <div className="studio-actions modal-actions">
                    <button type="button" className="ghost-button btn-neutral" onClick={() => setDashboardAddModalOpen(false)}>Cancel</button>
                    <button type="button" className="btn-create" disabled={!dashboardWidgetDraft.reportId} onClick={() => {
                      const added = addDashboardWidgetWithDraft(dashboardWidgetDraft);
                      if (!added) return;
                      setDashboardAddModalOpen(false);
                      pushToast("Widget added to the dashboard.");
                    }}>
                      Add to dashboard
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        ) : null}
        {dashboardSettingsModalOpen && activeDashboard ? (
          <div className="studio-modal-backdrop">
            <section className="studio-modal studio-dashboard-builder-modal">
              <div className="card-head">
                <div>
                  <strong>Dashboard settings</strong>
                  <div className="micro">Changes apply immediately — click Save to persist to server.</div>
                </div>
                <div className="studio-actions">
                  <button type="button" className="btn-neutral ghost-button" onClick={() => setDashboardSettingsModalOpen(false)}>Done</button>
                  <button type="button" onClick={() => { void saveRemote(); setDashboardSettingsModalOpen(false); }}>Save &amp; close</button>
                </div>
              </div>
              <div className="stack">
                <div className="card">
                  <div className="card-head">
                    <strong>Tabs</strong>
                    <button type="button" className="btn-create" onClick={() => {
                      const created = createDashboardTabInDefinition(activeDashboard, { color: "#0d7c66" });
                      writeObject(created.dashboard);
                      setActiveTabId(created.tabId);
                    }}>Add tab</button>
                  </div>
                  <div className="stack-compact">
                    {activeDashboard.tabs.map((tab, index) => (
                      <div className="card" key={tab.id}>
                        <div className="filter-grid compact-grid">
                          <label className="field"><span>Name</span><input value={tab.name} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, name: event.target.value } : item) })} /></label>
                          <label className="field"><span>Color</span><input type="color" value={tab.color || "#0d7c66"} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, color: event.target.value } : item) })} /></label>
                          <label className="toggle-row"><input type="radio" checked={activeDashboard.defaultTabId === tab.id} name="default-dashboard-tab" onChange={() => updateObject({ ...activeDashboard, defaultTabId: tab.id })} /> Default tab</label>
                        </div>
                        <div className="widget-edit-actions">
                          <button type="button" disabled={index === 0} onClick={() => {
                            const nextTabs = [...activeDashboard.tabs];
                            [nextTabs[index - 1], nextTabs[index]] = [nextTabs[index], nextTabs[index - 1]];
                            updateObject({ ...activeDashboard, tabs: nextTabs });
                          }}>Up</button>
                          <button type="button" disabled={index === activeDashboard.tabs.length - 1} onClick={() => {
                            const nextTabs = [...activeDashboard.tabs];
                            [nextTabs[index + 1], nextTabs[index]] = [nextTabs[index], nextTabs[index + 1]];
                            updateObject({ ...activeDashboard, tabs: nextTabs });
                          }}>Down</button>
                          <button type="button" className="ghost-button btn-danger" onClick={() => removeDashboardTabWithFallback(tab.id)}>Delete tab</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="card">
                  <div className="card-head">
                    <strong>Runtime filters</strong>
                    <button
                      type="button"
                      className="btn-create"
                      onClick={() => updateObject({
                        ...activeDashboard,
                        runtimeFilters: [
                          ...activeDashboard.runtimeFilters,
                          {
                            id: uid("runtime"),
                            label: "New filter",
                            fieldId: "",
                            sourceTableId: activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0].id : "",
                            uiType: "single-select",
                            mode: "global",
                            scope: "dashboard",
                            targetReportIds: [],
                            targetTabIds: [],
                            targetWidgetIds: [],
                            operator: "equals",
                            defaultValue: "",
                            displayOrder: activeDashboard.runtimeFilters.length,
                            collapsedByDefault: false,
                            allowBlank: false,
                            valueSource: "literal",
                            compareFieldId: ""
                          }
                        ]
                      })}
                    >
                      Add runtime filter
                    </button>
                  </div>
                  <div className="stack-compact">
                    {activeDashboard.runtimeFilters.length ? activeDashboard.runtimeFilters
                      .slice()
                      .sort((left, right) => (left.displayOrder ?? 0) - (right.displayOrder ?? 0))
                      .map((filter, index) => {
                        const resolvedTableId = filter.sourceTableId || (activeDashboardRefreshTables.length === 1 ? activeDashboardRefreshTables[0]?.id || "" : "");
                        const selectedTable = activeDashboardRefreshTables.find((table) => table.id === resolvedTableId) || null;
                        const fieldOptions = resolvedTableId ? (activeDashboardFieldOptionsByTableId[resolvedTableId] || []) : [];
                        const selectedField = selectedTable?.fields.find((field) => field.id === filter.fieldId) || null;
                        const operatorOptions = filterOperatorOptionsForField(selectedField);
                        const comparisonFieldOptions = selectedTable && filter.fieldId ? getFieldComparisonOptions(selectedTable, filter.fieldId) : [];
                        const valueOptions = activeDashboardRuntimeFilterOptions[filter.id] || [];
                        return (
                          <div className="card" key={filter.id}>
                            <div className="card-head">
                              <strong>{filter.label || "Runtime filter"}</strong>
                              <button type="button" className="ghost-button btn-danger" onClick={() => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.filter((item) => item.id !== filter.id) })}>Remove</button>
                            </div>
                            <div className="filter-grid compact-grid">
                              <label className="field"><span>Label</span><input value={filter.label} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, label: event.target.value }))} /></label>
                              <label className="field">
                                <span>Display order</span>
                                <input type="number" min="0" value={filter.displayOrder ?? index} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, displayOrder: Number(event.target.value) }))} />
                              </label>
                              <label className="field">
                                <span>Filter UI</span>
                                <select value={filter.uiType || "single-select"} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, uiType: event.target.value as typeof current.uiType }))}>
                                  <option value="single-select">Single-select dropdown</option>
                                  <option value="searchable-dropdown">Searchable dropdown</option>
                                  <option value="multi-select">Multi-select dropdown</option>
                                  <option value="date-range">Date range</option>
                                  <option value="number-range">Number range</option>
                                  <option value="user-picker">User picker</option>
                                  <option value="boolean-toggle">Boolean toggle</option>
                                </select>
                              </label>
                              {activeDashboardRefreshTables.length > 1 ? (
                                <label className="field">
                                  <span>Table</span>
                                  <SearchableSelect value={resolvedTableId} options={activeDashboardRefreshTables.map((table) => ({ value: table.id, label: table.name, keywords: [table.description] }))} allowEmpty emptyOptionLabel="Choose dashboard table" onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, sourceTableId: value, fieldId: "", defaultValue: "" }))} />
                                </label>
                              ) : (
                                <label className="field"><span>Table</span><input value={selectedTable?.name || "No dashboard table"} disabled /></label>
                              )}
                              <label className="field">
                                <span>Field</span>
                                <SearchableSelect
                                  value={filter.fieldId}
                                  options={fieldOptions}
                                  allowEmpty
                                  emptyOptionLabel={resolvedTableId ? "Choose table field" : "Choose a table first"}
                                  onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, fieldId: value, defaultValue: "", valueSource: "literal", compareFieldId: "" }))}
                                />
                              </label>
                              <label className="field">
                                <span>Applies to</span>
                                <select value={filter.scope || "dashboard"} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, scope: event.target.value as typeof current.scope }))}>
                                  <option value="dashboard">Entire dashboard</option>
                                  <option value="tab">Specific tabs</option>
                                  <option value="widgets">Selected widgets</option>
                                </select>
                              </label>
                              <label className="field"><span>Operator</span><select value={filter.operator} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, operator: event.target.value as FilterOperator }))}>{operatorOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                              <label className="toggle-row"><input type="checkbox" checked={filter.collapsedByDefault === true} onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, collapsedByDefault: event.target.checked }))} /> Start collapsed</label>
                            </div>
                            {filter.scope === "tab" ? (
                              <div className="filter-grid compact-grid">
                                {activeDashboard.tabs.map((tab) => (
                                  <label className="toggle-row" key={tab.id}>
                                    <input
                                      type="checkbox"
                                      checked={filter.targetTabIds?.includes(tab.id) || false}
                                      onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({
                                        ...current,
                                        targetTabIds: event.target.checked
                                          ? Array.from(new Set([...(current.targetTabIds || []), tab.id]))
                                          : (current.targetTabIds || []).filter((item) => item !== tab.id)
                                      }))}
                                    />
                                    {tab.name}
                                  </label>
                                ))}
                              </div>
                            ) : null}
                            {filter.scope === "widgets" ? (
                              <div className="filter-grid compact-grid">
                                {activeDashboard.tabs.flatMap((tab) => tab.widgets.map((widget) => ({ id: widget.id, label: `${tab.name} · ${widget.title || widget.reportId}` }))).map((widget) => (
                                  <label className="toggle-row" key={widget.id}>
                                    <input
                                      type="checkbox"
                                      checked={filter.targetWidgetIds?.includes(widget.id) || false}
                                      onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({
                                        ...current,
                                        targetWidgetIds: event.target.checked
                                          ? Array.from(new Set([...(current.targetWidgetIds || []), widget.id]))
                                          : (current.targetWidgetIds || []).filter((item) => item !== widget.id)
                                      }))}
                                    />
                                    {widget.label}
                                  </label>
                                ))}
                              </div>
                            ) : null}
                            {valueOptions.length ? (
                              <label className="field">
                                <span>Default value</span>
                                <SearchableSelect value={filter.defaultValue} options={valueOptions} allowEmpty emptyOptionLabel="No default (show all)" onChange={(value) => updateRuntimeFilter(filter.id, (current) => ({ ...current, defaultValue: value }))} />
                              </label>
                            ) : (
                              <label className="field"><span>Default value <span className="micro">(optional)</span></span><input value={filter.defaultValue} placeholder="Leave blank to show all" onChange={(event) => updateRuntimeFilter(filter.id, (current) => ({ ...current, defaultValue: event.target.value }))} /></label>
                            )}
                          </div>
                        );
                      }) : <div className="empty-hint">No runtime filters configured yet.</div>}
                  </div>
                </div>

                {activeDashboardRefreshTables.length ? (
                  <div className="card">
                    <div className="card-head">
                      <strong>Source report overrides</strong>
                      <span className="micro">Optional dashboard-only Quickbase report IDs.</span>
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
                              placeholder="Optional Quickbase report ID"
                            />
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          </div>
        ) : null}
        {createModalOpen ? (
          <div className="studio-modal-backdrop">
            <section className="studio-modal">
              <div className="card-head">
                <div>
                  <strong>{importEditingReportId ? "Edit Imported Report Setup" : editingReportId ? "Edit Report" : `Create ${createDraft.type === "report" ? "Report" : "Dashboard"}`}</strong>
                  <div className="micro">{importEditingReportId ? "Use the same builder workflow as a normal report: fields, filters, sorts, and chart setup all stay together here before the workbook import is applied." : editingReportId ? "Update the report configuration here. Changes stay in the modal instead of moving into a side setup column." : "Start fresh with the same field, filter, and sorting controls from the legacy builder."}</div>
                </div>
                <button className="btn-neutral" onClick={handleCloseCreateModal}>Close</button>
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
                    {createDraft.type === "report" ? (
                      <StudioReportDraftBasicsStep
                        createDraft={createDraft}
                        createDraftTable={createDraftTable}
                        setCreateDraft={setCreateDraft}
                      />
                    ) : null}
                  </>
                ) : null}

                {activeCreateStep === "data" && createDraft.type === "report" && createDraftTable ? (
                  <StudioReportDraftDataStep
                    tables={postgresSourceIds.size > 0
                      ? bundle.tables.filter((t) => postgresSourceIds.has(t.id) || (t.quickbaseTableId ? postgresSourceIds.has(t.quickbaseTableId) : false))
                      : bundle.tables}
                    createDraft={createDraft}
                    createDraftTable={createDraftTable}
                    chartValueLabelOptions={chartValueLabelOptions}
                    setCreateDraft={setCreateDraft}
                    updateCreateDraftTable={updateCreateDraftTable}
                  />
                ) : null}

                {activeCreateStep === "filters" && createDraft.type === "report" && createDraftTable ? (
                  <ReportFiltersAndSortsEditor
                    table={buildMergedTableForJoins(
                      createDraftTable,
                      createDraft.sourceJoins || [],
                      (createDraft.sourceJoins || []).map((j) => bundle.tables.find((t) => t.id === j.sourceTableId)).filter(Boolean) as import("@studio/shared").TableDefinition[]
                    )}
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
                    createDraftPreviewChartData={createDraftPreview?.chartData || []}
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
                    <button type="button" className="ghost-button btn-neutral" onClick={() => setCreateStep(createSteps[Math.max(0, createSteps.indexOf(activeCreateStep) - 1)])}>
                      Back
                    </button>
                  ) : null}
                  {activeCreateStep !== "review" ? (
                    <button
                      type="button"
                      className="btn-system"
                      onClick={() => setCreateStep(createSteps[Math.min(createSteps.length - 1, createSteps.indexOf(activeCreateStep) + 1)])}
                      disabled={createStepIssues.length > 0}
                    >
                      Next
                    </button>
                  ) : (
                    <button className="btn-create" onClick={createFromDraft} disabled={createDraftIssues.length > 0}>
                      {importEditingReportId ? "Save imported report setup" : editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
                    </button>
                  )}
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {drawer ? (
          <div className={drawer === "settings" ? "studio-modal-backdrop" : "studio-drawer-backdrop"}>
            <section className={drawer === "settings" ? "studio-modal studio-settings-modal" : "studio-drawer"}>
              <div className="card-head">
                <strong>{drawer === "settings" ? "System Settings" : drawer === "share" ? "Share" : drawer === "templates" ? "Templates" : drawer === "export" ? "Export" : "History"}</strong>
                <button className="btn-neutral" onClick={() => setDrawer(null)}>Close</button>
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
                  updateRefreshSourceKeyFieldId={updateRefreshSourceKeyFieldId}
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
                    <button className="btn-export" onClick={exportWorkbook}>Download Excel file</button>
                    <button className="btn-export" onClick={exportJson}>Download JSON file</button>
                    <button className="btn-system" onClick={() => { void refreshExportJobs(); }}>Refresh status</button>
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
                              <button className="btn-export" onClick={() => { void saveExportJobToMachine(job); }}>Save to machine</button>
                            ) : null}
                            {job.format === "xlsx" ? (
                              <button className="btn-system" onClick={() => { void retryExportJob(job); }}>
                                {job.status === "failed" ? "Retry" : "Run again"}
                              </button>
                            ) : null}
                            {job.format === "json" ? <button className="btn-export" onClick={exportJson}>Download again</button> : null}
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

  // ── Settings page mode: renders ONLY the settings panel, no builder UI ──────
  if (settingsMode) {
    return (
      <section className="settings-full-page">
        <div className="settings-full-page-header">
          <div>
            <span className="badge brand">Platform</span>
            <h1 style={{ margin: "6px 0 0", fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em" }}>System Settings</h1>
          </div>
          <button className="ghost-button btn-neutral" onClick={() => navigate(-1)}>← Back</button>
        </div>
        <div style={{ padding: "24px 28px" }}>
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
            updateRefreshSourceKeyFieldId={updateRefreshSourceKeyFieldId}
            saveRemote={saveRemote}
            refreshAllNow={refreshAllNow}
            reloadRemote={reloadRemote}
          />
        </div>
      </section>
    );
  }

  if (!activeObject && !visibleObjects.length) {
    return (
      <>
        {refreshJob ? (
          <RefreshOverlay title={refreshJob.status === "complete" ? "Data sync complete" : refreshJob.status === "failed" ? "Data sync failed" : refreshJob.status === "cancelled" ? "Data sync cancelled" : "Syncing all reports and dashboards"} job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)} onCancel={refreshJob.id && (refreshJob.status === "running" || refreshJob.status === "queued") ? () => { void cancelStudioRefreshJob(refreshJob.id).catch(() => {}); } : undefined} />
        ) : null}
        <section className="studio-page studio-page-empty">
          <StudioWorkspaceEmptyState
            loadingRemote={loadingRemote}
            lastSavedAt={documentState.sync.lastSavedAt}
            savingRemote={savingRemote}
            xlsxImporting={xlsxImporting}
            onSave={saveRemote}
            onCreateReport={() => { void openCreateModal("report"); }}
            onCreateDashboard={() => { void openCreateModal("dashboard"); }}
            onImportXlsx={() => setXlsxUploadModalOpen(true)}
            onUseTemplate={() => setDrawer("templates")} canCreate={canDo("building.create")} canImport={canDo("data.import")}
          />
        </section>
        {renderStudioOverlays()}
      </>
    );
  }

  if (!activeObject) {
    return (
      <>
        {refreshJob ? (
          <RefreshOverlay title={refreshJob.status === "complete" ? "Data sync complete" : refreshJob.status === "failed" ? "Data sync failed" : refreshJob.status === "cancelled" ? "Data sync cancelled" : "Syncing all reports and dashboards"} job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)} onCancel={refreshJob.id && (refreshJob.status === "running" || refreshJob.status === "queued") ? () => { void cancelStudioRefreshJob(refreshJob.id).catch(() => {}); } : undefined} />
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
            librarySort={librarySort}
            onLibrarySortChange={setLibrarySort}
            hasPersonalObjects={visibleObjects.some((object) => object.scope === "personal")}
            filteredObjects={filteredObjects}
            selectedReportIds={selectedHomeReportIds}
            templates={[...documentState.templates.layouts, ...documentState.templates.yaml]}
            openLinksInNewTab={openLinksInNewTab}
            onSave={saveRemote}
            onOpenSettings={() => setDrawer("settings")}
            onCreateReport={() => { void openCreateModal("report"); }}
            onCreateDashboard={() => { void openCreateModal("dashboard"); }}
            onImportXlsx={() => setXlsxUploadModalOpen(true)}
            onUseTemplate={() => setDrawer("templates")} canCreate={canDo("building.create")} canImport={canDo("data.import")}
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
  const shortcutsSection = hasActiveObject && !activeDashboard ? (
    <div className="surface stack studio-shortcuts-panel">
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
    </div>
  ) : null;

  const overlayOpen = xlsxUploadModalOpen || importReviewModalOpen || dashboardAddModalOpen || dashboardSettingsModalOpen || createModalOpen || Boolean(drawer);

  const objectActionDock = hasActiveObject && !activeDashboard && !overlayOpen ? (
    <div className="studio-builder-dock" role="region" aria-label="Building actions">
      <div className="studio-builder-dock-inner">
        <Link className="ghost-button btn-neutral" to={buildHostedRoute("/studio")}>Back to Building home</Link>
        <button onClick={() => addTemplate(activeObject.type === "dashboard" ? "layout" : "yaml")}>Save as template</button>
        {activeReport && canDo("building.edit") ? <button onClick={() => openEditReportModal(activeReport)}>Edit report</button> : null}
        {activeReport && canDo("building.delete") ? <button className="btn-danger" onClick={() => deleteObject(activeReport.id)}>Delete report</button> : null}
        <button onClick={() => toggleFavorite(activeObject.id)}>{documentState.favorites.includes(activeObject.id) ? "Unfavorite" : "Favorite"}</button>
        <button onClick={() => cloneObject(activeObject)}>Clone</button>
        <button onClick={undo} disabled={!history.length}>Undo</button>
        <button onClick={redo} disabled={!future.length}>Redo</button>
        <button onClick={() => setDrawer("share")}>Share</button>
        {canDo("reports.export") && <button className="btn-export" onClick={() => setDrawer("export")}>Export</button>}
        <button onClick={openVersions}>History</button>
      </div>
    </div>
  ) : null;

  return (
    <>
      {refreshJob ? (
        <RefreshOverlay title={refreshJob.status === "complete" ? "Data sync complete" : refreshJob.status === "failed" ? "Data sync failed" : refreshJob.status === "cancelled" ? "Data sync cancelled" : "Syncing all reports and dashboards"} job={refreshJob} status={refreshJob.status} onDismiss={() => setRefreshJob(null)} onCancel={refreshJob.id && (refreshJob.status === "running" || refreshJob.status === "queued") ? () => { void cancelStudioRefreshJob(refreshJob.id).catch(() => {}); } : undefined} />
      ) : null}
      <section className={`studio-page ${activeDashboard ? "studio-page-dashboard" : "studio-page-report"}`}>
      <div className={`studio-canvas ${hasActiveObject ? "studio-canvas-active" : ""}`}>
        {hasActiveObject ? <div className="studio-workspace-top">{shortcutsSection}</div> : null}
        <div className="hero studio-hero">
          <div>
            <span className="badge brand">{hasActiveObject ? typeLabel(activeObject.type) : "Workspace"}</span>
            <h1>{activeObject.name}</h1>
            <p>{activeObject.description || "Build, save, share, and export reports and dashboards from one workspace."}</p>
            <div className="micro-row">
              {loadingRemote ? <span>Loading…</span> : null}
              {documentState.sync.lastSavedAt ? <span>Last saved {new Date(documentState.sync.lastSavedAt).toLocaleString()}</span> : null}
            </div>
          </div>
          {!hasActiveObject ? (
          <div className="link-toolbar">
            <Link className="ghost-button btn-neutral" to={buildHostedRoute("/studio")}>Back to Building home</Link>
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
            {canDo("building.create") && !hasActiveObject ? <button className="btn-create" onClick={() => openCreateModal("report")}>Create report</button> : null}
            {canDo("building.create") && !hasActiveObject ? <button className="btn-create" onClick={() => openCreateModal("dashboard")}>Create dashboard</button> : null}
            {!hasActiveObject ? <button onClick={() => setXlsxUploadModalOpen(true)} disabled={xlsxImporting}>{xlsxImporting ? "Importing xlsx…" : "Import xlsx"}</button> : null}
            {activeReport ? <button onClick={() => openEditReportModal(activeReport)}>Edit report</button> : null}
            {activeReport ? <button className="btn-danger" onClick={() => deleteObject(activeReport.id)}>Delete report</button> : null}
            {hasActiveObject ? <button onClick={() => toggleFavorite(activeObject.id)}>{documentState.favorites.includes(activeObject.id) ? "Unfavorite" : "Favorite"}</button> : null}
            {hasActiveObject ? <button onClick={() => cloneObject(activeObject)}>Clone</button> : null}
            <button onClick={undo} disabled={!history.length}>Undo</button>
            <button onClick={redo} disabled={!future.length}>Redo</button>
            {hasActiveObject ? <button onClick={() => setDrawer("share")}>Share</button> : null}
            {hasActiveObject && canDo("reports.export") ? <button className="btn-export" onClick={() => setDrawer("export")}>Export</button> : null}
            {hasActiveObject ? <button onClick={openVersions}>History</button> : null}
          </div>
          ) : null}
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
                <Link className="ghost-button btn-help" to={buildHostedRoute("/help")}>Open manual</Link>
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

        {activeReport && activeTable && (reportResult || liveReportLoading || postgresReportLoading) ? (
          <section className="surface stack studio-report-preview-panel">
            <div className="card-head">
              <strong>Report Preview</strong>
              <span className="micro">
                {(liveReportLoading || postgresReportLoading) && !reportResult ? "Loading report data…" : `${reportResult?.totalRows || 0} rows · ${activeTable.name}`}
              </span>
            </div>
            {reportResult ? (
              <>
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
              <div className="empty-hint">Loading live data for this report.</div>
            )}
          </section>
        ) : null}

        {activeDashboard && dashboardResult ? (
          <section className="surface studio-dashboard-preview-panel dashboard-builder-shell">
          <div className="dashboard-builder-main">
            <div className="dashboard-builder-toolbar">
              <div className="dashboard-builder-toolbar-actions">
                {canDo("building.edit") && <button type="button" className="btn-create" onClick={openDashboardAddModal}>Add report/graph</button>}
                {canDo("building.edit") && <button type="button" className="ghost-button btn-system" onClick={() => setDashboardSettingsModalOpen(true)}>Dashboard settings</button>}
              </div>
              <div className="dashboard-builder-toolbar-meta">
                <span className="micro">{activeDashboard.tabs.length} tabs</span>
                <span className="micro">{activeDashboard.tabs.reduce((sum, tab) => sum + tab.widgets.length, 0)} widgets</span>
              </div>
            </div>
            <div className="dashboard-builder-toolbar dashboard-builder-toolbar-secondary">
              <div className="dashboard-builder-toolbar-actions">
                <Link className="ghost-button btn-neutral" to={buildHostedRoute("/studio")}>Back to Building home</Link>
                <button type="button" onClick={() => addTemplate("layout")}>Save as template</button>
                <button type="button" onClick={snapshotCurrentObject}>Save version</button>
                <button type="button" onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to server"}</button>
                <button type="button" onClick={() => toggleFavorite(activeDashboard.id)}>{documentState.favorites.includes(activeDashboard.id) ? "Unfavorite" : "Favorite"}</button>
                <button type="button" onClick={() => cloneObject(activeDashboard)}>Clone dashboard</button>
                {canDo("building.delete") && <button type="button" className="btn-danger" onClick={() => deleteObject(activeDashboard.id)}>Delete dashboard</button>}
                <button type="button" onClick={undo} disabled={!history.length}>Undo</button>
                <button type="button" onClick={redo} disabled={!future.length}>Redo</button>
                <button type="button" onClick={() => setDrawer("share")}>Share</button>
                {canDo("reports.export") && <button type="button" className="btn-export" onClick={() => setDrawer("export")}>Export</button>}
                <button type="button" onClick={openVersions}>History</button>
              </div>
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
            <div className="studio-tab-strip dashboard-builder-tab-strip">
              {activeDashboard.tabs.map((tab) => (
                <button
                  key={tab.id}
                  className={tab.id === activeTabId ? "active-tab" : ""}
                  onClick={() => setActiveTabId(tab.id)}
                  style={{
                    borderColor: tab.color || undefined,
                    background: tab.id === activeTabId && tab.color ? `${tab.color}18` : undefined,
                    color: tab.id === activeTabId && tab.color ? tab.color : undefined
                  }}
                >
                  {tab.name}
                  {activeDashboard.defaultTabId === tab.id ? <span className="micro"> · default</span> : null}
                </button>
              ))}
            </div>
            {activeDashboardTab && !activeDashboardTab.widgets.length ? (
              <div className="dashboard-empty-builder-state">
                <strong>This tab is empty.</strong>
                <span>Add a report or graph to start building the dashboard layout on this tab.</span>
                <button type="button" className="btn-create" onClick={openDashboardAddModal}>Add report/graph</button>
              </div>
            ) : null}
            {activeDashboardTab?.widgets.length ? (
              <StudioDashboardPreview
                dashboard={{ ...activeDashboard, tabs: activeDashboard.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
                result={{ ...dashboardResult, tabs: dashboardResult.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
                tables={bundle.tables}
                runtimeValues={runtimeValues}
                runtimeFilterOptionsById={activeDashboardRuntimeFilterOptions}
                setRuntimeValues={setRuntimeValues}
                widgetSearch={widgetSearch}
                activeTabId={activeTabId}
                selectedWidgetId={selectedWidgetId}
                draggingWidget={draggingWidget}
                onSelectWidget={(tabId, widgetId) => {
                  setActiveTabId(tabId);
                  setSelectedWidgetId(widgetId);
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
                onBeginResizeWidget={beginWidgetResize}
                onMoveWidget={moveDashboardWidget}
              />
            ) : null}
          </div>
          {activeDashboard && selectedDashboardWidget && activeDashboardTab ? (
          <aside className="dashboard-builder-widget-panel" onClick={(event) => event.stopPropagation()}>
            <div className="studio-section-head dashboard-builder-panel-head">
              <div>
                <div className="eyebrow">Widget settings</div>
                <h2>{selectedDashboardWidget.title || selectedDashboardWidgetReport?.name || "Widget"}</h2>
              </div>
              <button type="button" className="ghost-button btn-neutral" onClick={() => setSelectedWidgetId("")}>✕</button>
            </div>
            <div className="card">
                  <div className="card-head">
                    <strong>Report actions</strong>
                    <span className="micro">{selectedDashboardWidgetReport?.name || selectedDashboardWidget.reportId}</span>
                  </div>
                  <div className="widget-edit-actions">
                    {selectedDashboardWidgetReport ? (
                      <button type="button" onClick={() => void beginEditDashboardWidgetReport(selectedDashboardWidget, selectedDashboardWidgetReport)}>Edit report</button>
                    ) : null}
                    {selectedDashboardWidgetReport ? <button type="button" onClick={cloneSelectedDashboardReport}>Clone report</button> : null}
                    <button type="button" className="btn-danger" onClick={() => removeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id)}>Remove from dashboard</button>
                  </div>
            </div>

            <div className="card">
                  <div className="card-head">
                    <strong>Widget settings</strong>
                    <span className="micro">Dashboard-only presentation</span>
                  </div>
                  <div className="widget-editor-grid">
                    <label className="field">
                      <span>Title override</span>
                      <input value={selectedDashboardWidget.title} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, title: event.target.value }))} />
                    </label>
                    <label className="toggle-row"><input type="checkbox" checked={selectedDashboardWidget.hideTitle === true} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, hideTitle: event.target.checked }))} /> Hide title</label>
                    <label className="field">
                      <span>Display mode</span>
                      <select value={selectedDashboardWidget.displayMode} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, displayMode: event.target.value as "inherit" | "table" | "summary" | "chart" }))}>
                        <option value="inherit">Inherit report</option>
                        <option value="table">Table</option>
                        <option value="summary">Metrics / KPI</option>
                        <option value="chart">Chart</option>
                      </select>
                    </label>
                    <label className="field-inline"><span>Width</span><input type="number" min="1" max="12" value={selectedDashboardWidget.layout.w} onChange={(event) => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, { w: Number(event.target.value), h: selectedDashboardWidget.layout.h })} /></label>
                    <label className="field-inline"><span>Height</span><input type="number" min="2" max="10" value={selectedDashboardWidget.layout.h} onChange={(event) => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, { w: selectedDashboardWidget.layout.w, h: Number(event.target.value) })} /></label>
                    <label className="field-inline"><span>X</span><input type="number" min="1" max="12" value={selectedDashboardWidget.layout.x || 1} onChange={(event) => placeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, { x: Number(event.target.value), y: selectedDashboardWidget.layout.y || 1 })} /></label>
                    <label className="field-inline"><span>Y</span><input type="number" min="1" max="99" value={selectedDashboardWidget.layout.y || 1} onChange={(event) => placeDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, { x: selectedDashboardWidget.layout.x || 1, y: Number(event.target.value) })} /></label>
                    <label className="toggle-row"><input type="checkbox" checked={selectedDashboardWidget.showSummary} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, showSummary: event.target.checked }))} /> Show summary metrics</label>
                    <label className="toggle-row"><input type="checkbox" checked={selectedDashboardWidget.showDetails} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, showDetails: event.target.checked }))} /> Show row details</label>
                    {selectedDashboardWidget.showDetails && selectedDashboardWidgetReport && !selectedDashboardWidgetReport.selectedFieldIds.length ? (
                      <p style={{ margin: "4px 0 0", padding: "6px 8px", background: "var(--warning-bg)", border: "1px solid #FCD34D", borderRadius: 4, fontSize: "0.8em", color: "var(--warning)" }}>No detail fields configured on this report (Step 2). Edit the report to select columns, or all fields will be used during export.</p>
                    ) : null}
                  </div>
            </div>

            <div className="card">
                  <div className="card-head">
                    <strong>Tab management</strong>
                    <span className="micro">Move or copy this widget across tabs</span>
                  </div>
                  <label className="field">
                    <span>Existing tab</span>
                    <select value={widgetTargetTabId} onChange={(event) => setWidgetTargetTabId(event.target.value)}>
                      {activeDashboardTabOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  </label>
                  <div className="widget-edit-actions">
                    <button type="button" disabled={!widgetTargetTabId || widgetTargetTabId === activeDashboardTab.id} onClick={() => moveDashboardWidgetToTab(activeDashboardTab.id, selectedDashboardWidget.id, widgetTargetTabId)}>Move to tab</button>
                    <button type="button" disabled={!widgetTargetTabId || widgetTargetTabId === activeDashboardTab.id} onClick={() => copyDashboardWidgetToTab(activeDashboardTab.id, selectedDashboardWidget.id, widgetTargetTabId)}>Copy to tab</button>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>New tab name</span><input value={dashboardWidgetDraft.newTabName} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, newTabName: event.target.value }))} placeholder="New tab" /></label>
                    <label className="field"><span>New tab color</span><input type="color" value={dashboardWidgetDraft.newTabColor} onChange={(event) => setDashboardWidgetDraft((current) => ({ ...current, newTabColor: event.target.value }))} /></label>
                  </div>
                  <button type="button" onClick={() => moveDashboardWidgetToNewTab(selectedDashboardWidget, dashboardWidgetDraft.newTabName, dashboardWidgetDraft.newTabColor)}>Create tab and move widget</button>
            </div>

            <div className="card">
                  <div className="card-head">
                    <strong>Runtime filter behavior</strong>
                    <span className="micro">Choose how dashboard filters affect this widget</span>
                  </div>
                  <label className="field">
                    <span>Filter behavior</span>
                    <select value={selectedDashboardWidget.filterBehavior || "use-dashboard-filters"} onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({ ...widget, filterBehavior: event.target.value as typeof widget.filterBehavior }))}>
                      <option value="use-dashboard-filters">Use dashboard filters</option>
                      <option value="ignore-dashboard-filters">Ignore dashboard filters</option>
                      <option value="custom-mappings">Custom mappings</option>
                    </select>
                  </label>
                  {activeDashboard.runtimeFilters.length ? activeDashboard.runtimeFilters.map((filter) => (
                    <label className="field" key={filter.id}>
                      <span>{filter.label}</span>
                      <select
                        value={selectedDashboardWidget.runtimeFilterMappings?.[filter.id] || ""}
                        onChange={(event) => updateActiveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, (widget) => ({
                          ...widget,
                          runtimeFilterMappings: {
                            ...(widget.runtimeFilterMappings || {}),
                            [filter.id]: event.target.value
                          }
                        }))}
                      >
                        <option value="">Use default field</option>
                        {activeDashboardFieldOptionsByTableId[selectedDashboardWidgetReport?.sourceTableId || ""]?.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  )) : <div className="empty-hint">No runtime filters are configured yet.</div>}
            </div>

            <div className="card">
                  <div className="card-head">
                    <strong>Layout controls</strong>
                    <span className="micro">Grid snapping stays enforced</span>
                  </div>
                  <div className="widget-layout-presets">
                    {WIDGET_LAYOUT_PRESETS.map((preset) => (
                      <button key={preset.id} type="button" onClick={() => applyDashboardWidgetPreset(activeDashboardTab.id, selectedDashboardWidget.id, preset)}>{preset.label}</button>
                    ))}
                  </div>
                  <div className="widget-edit-actions">
                    <button type="button" onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "left")}>Move left</button>
                    <button type="button" onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "right")}>Move right</button>
                    <button type="button" onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "up")}>Move up</button>
                    <button type="button" onClick={() => moveDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "down")}>Move down</button>
                    <button type="button" onClick={() => alignDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "left")}>Align left</button>
                    <button type="button" onClick={() => alignDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "right")}>Align right</button>
                    <button type="button" onClick={() => alignDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "top")}>Align top</button>
                    <button type="button" onClick={() => alignDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id, "bottom")}>Align bottom</button>
                    <button type="button" onClick={() => setDashboardWidgetZIndex(activeDashboardTab.id, selectedDashboardWidget.id, "forward")}>Bring forward</button>
                    <button type="button" onClick={() => setDashboardWidgetZIndex(activeDashboardTab.id, selectedDashboardWidget.id, "backward")}>Send backward</button>
                    <button type="button" onClick={() => duplicateDashboardWidget(activeDashboardTab.id, selectedDashboardWidget.id)}>Duplicate widget</button>
                    <button type="button" onClick={() => resetDashboardWidgetSize(activeDashboardTab.id, selectedDashboardWidget.id)}>Reset size</button>
                    <button type="button" onClick={() => resetDashboardWidgetPosition(activeDashboardTab.id, selectedDashboardWidget.id)}>Reset position</button>
                    <button type="button" onClick={() => toggleDashboardWidgetFullWidth(activeDashboardTab.id, selectedDashboardWidget.id)}>{clampDashboardWidgetWidth(selectedDashboardWidget.layout.w) >= 12 ? "Restore width" : "Full width"}</button>
                  </div>
            </div>
          </aside>
          ) : null}
          </section>
        ) : null}
        {objectActionDock}
      </div>
      </section>

      <div className="toast-stack">
        {toasts.map((toast) => <div key={toast.id} className={`toast toast-${toast.tone}`}>{toast.message}</div>)}
      </div>
      {renderStudioOverlays()}
    </>
  );
}
