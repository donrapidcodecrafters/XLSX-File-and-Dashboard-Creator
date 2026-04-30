export type StudioObjectType = "report" | "dashboard";
export type StudioObjectScope = "global" | "personal" | "selected";
export type FieldType = "text" | "number" | "currency" | "date" | "datetime" | "user" | "multiselect";
export type FilterOperator =
  | "equals"
  | "not-equals"
  | "contains"
  | "not-contains"
  | "blank"
  | "not-blank"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "on"
  | "on-or-after"
  | "on-or-before";
export type FilterJoinOperator = "and" | "or";
export type SortDirection = "asc" | "desc";
export type WidgetMode = "linked" | "copied";
export type ReportViewMode = "table" | "summary" | "chart" | "timeline" | "calendar" | "kanban";
export type ChartType =
  | "bar"
  | "column"
  | "line"
  | "area"
  | "donut"
  | "pie"
  | "stacked-bar"
  | "stacked-column"
  | "funnel"
  | "heatmap"
  | "radar"
  | "gauge"
  | "waterfall"
  | "horizontal-bar"
  | "horizontal-stacked-bar"
  | "line-bar"
  | "spline"
  | "area-spline"
  | "streamgraph"
  | "scatter"
  | "bubble"
  | "radial-bar"
  | "variwide-bar"
  | "progress-bar"
  | "bullet"
  | "3d-bar"
  | "3d-stacked-bar"
  | "3d-area"
  | "3d-pie"
  | "3d-donut"
  | "3d-funnel"
  | "3d-scatter"
  | "solid-gauge"
  | "kpi-card"
  | "big-number-card"
  | "treemap"
  | "sunburst"
  | "box-plot"
  | "candlestick"
  | "histogram"
  | "pareto"
  | "map"
  | "sankey"
  | "network-graph";
export type ChartAggregation = "count" | "sum" | "avg" | "average" | "min" | "max" | "percent";
export type ChartSortMode = "value-desc" | "value-asc" | "label-asc" | "label-desc";
export type ChartOrientation = "vertical" | "horizontal";
export type ChartAxisAssignment = "primary" | "secondary";
export type ChartSeriesType = "line" | "area" | "bar" | "column";
export type ChartPercentMode =
  | "percent_of_total"
  | "percent_of_group"
  | "percent_of_stack"
  | "percent_of_previous"
  | "range_progress"
  | "target_ratio"
  | "category_max_ratio"
  | "width_percent"
  | "value_percent"
  | "cumulative_percent_of_total";
export type RuntimeFilterMode = "global" | "selected";
export type DashboardRuntimeFilterUi =
  | "single-select"
  | "multi-select"
  | "searchable-dropdown"
  | "date-range"
  | "number-range"
  | "user-picker"
  | "boolean-toggle";
export type DashboardRuntimeFilterScope = "dashboard" | "tab" | "widgets";
export type DashboardWidgetFilterBehavior = "use-dashboard-filters" | "ignore-dashboard-filters" | "custom-mappings";
export type RefreshCadence = "daily" | "weekly" | "monthly";
export type FilterValueSource = "literal" | "field";

export type DataValue = string | number | boolean | null | string[];
export type DataRow = Record<string, DataValue>;

export interface FieldDefinition {
  id: string;
  label: string;
  type: FieldType;
  options?: string[];
}

export interface TableDefinition {
  id: string;
  name: string;
  description: string;
  quickbaseProfileId?: string;
  quickbaseTableId?: string;
  quickbaseAppId?: string;
  fields: FieldDefinition[];
}

export interface FilterDefinition {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: string;
  valueSource?: FilterValueSource;
  compareFieldId?: string;
}

export interface FilterGroupDefinition {
  id: string;
  type: "group";
  join: FilterJoinOperator;
  conditions: FilterNodeDefinition[];
}

export type FilterNodeDefinition = FilterDefinition | FilterGroupDefinition;

export interface SortDefinition {
  id: string;
  fieldId: string;
  direction: SortDirection;
}

export interface GroupDefinition {
  id: string;
  fieldId: string;
}

export interface SummaryMetric {
  id: string;
  fieldId: string;
  op: "count" | "sum" | "avg" | "min" | "max";
  label: string;
}

export interface ReportViewDefinition {
  mode: ReportViewMode;
  showChartInTable: boolean;
  showSummary: boolean;
  showDetails: boolean;
  chartTitle: string;
  decimalPlaces: number;
  chartType: ChartType;
  chartOrientation: ChartOrientation;
  chartFieldId: string;
  chartSeriesFieldId: string;
  chartValueFieldId: string;
  chartAggregation: ChartAggregation;
  chartPercentMode?: ChartPercentMode;
  chartSecondaryValueFieldId: string;
  chartSecondaryAggregation: ChartAggregation;
  chartUseSecondaryAxis: boolean;
  chartSecondarySeriesType: ChartSeriesType;
  chartTopN: number;
  chartSort: ChartSortMode;
  chartColors: string[];
  chartValueColors: Record<string, string>;
  chartShowLegend: boolean;
  chartShowValues: boolean;
  chartXAxisLabel: string;
  chartYAxisLabel: string;
  chartSecondaryYAxisLabel: string;
  timelineDateField: string;
  timelineEndField: string;
  calendarDateField: string;
  kanbanField: string;
  titleFieldId: string;
}

export interface ReportDisplayLabels {
  fields: Record<string, string>;
  chartValues: Record<string, string>;
}

export interface BaseStudioObject {
  id: string;
  type: StudioObjectType;
  schemaVersion: number;
  name: string;
  description: string;
  folder: string;
  category: string;
  tags: string[];
  scope: StudioObjectScope;
  createdByUserId?: string;
  ownerUserId: string;
  sharedUserIds: string[];
  updatedAt: string;
}

export interface ReportDefinition extends BaseStudioObject {
  type: "report";
  sourceTableId: string;
  sourceReportOverrides?: Record<string, string>;
  selectedFieldIds: string[];
  filters: FilterDefinition[];
  filterTree?: FilterGroupDefinition;
  groups: GroupDefinition[];
  sorts: SortDefinition[];
  summaryMetrics: SummaryMetric[];
  view: ReportViewDefinition;
  displayLabels: ReportDisplayLabels;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  hideTitle?: boolean;
  layout: {
    w: number;
    h: number;
    x?: number;
    y?: number;
  };
  zIndex?: number;
  mode: WidgetMode;
  displayMode: "inherit" | "table" | "summary" | "chart";
  showDetails: boolean;
  showSummary: boolean;
  reportId: string;
  filterBehavior?: DashboardWidgetFilterBehavior;
  runtimeFilterMappings?: Record<string, string>;
  snapshot?: ReportDefinition;
}

export interface DashboardTabDefinition {
  id: string;
  name: string;
  color?: string;
  widgets: WidgetDefinition[];
}

export interface RuntimeFilterDefinition {
  id: string;
  label: string;
  fieldId: string;
  sourceTableId?: string;
  uiType?: DashboardRuntimeFilterUi;
  mode: RuntimeFilterMode;
  targetReportIds: string[];
  scope?: DashboardRuntimeFilterScope;
  targetTabIds?: string[];
  targetWidgetIds?: string[];
  operator: FilterOperator;
  defaultValue: string;
  displayOrder?: number;
  collapsedByDefault?: boolean;
  allowBlank?: boolean;
  valueSource?: FilterValueSource;
  compareFieldId?: string;
}

export interface DashboardDefinition extends BaseStudioObject {
  type: "dashboard";
  tabs: DashboardTabDefinition[];
  defaultTabId?: string;
  runtimeFilters: RuntimeFilterDefinition[];
  sourceReportOverrides?: Record<string, string>;
}

export interface DashboardPersonalOverride {
  runtimeFilters: Record<string, string>;
  activeTabId: string;
  focusedWidgetId: string;
  savedViews: Array<{
    id: string;
    name: string;
    runtimeFilters: Record<string, string>;
    activeTabId: string;
    focusedWidgetId: string;
    updatedAt: string;
  }>;
  updatedAt: string;
}

export type ReportFocusMode = "default" | "summary" | "chart" | "details";

export interface ReportPersonalOverride {
  currentPage: number;
  focusMode: ReportFocusMode;
  focusedSection: "" | "chart" | "details";
  savedViews: Array<{
    id: string;
    name: string;
    currentPage: number;
    focusMode: ReportFocusMode;
    focusedSection: "" | "chart" | "details";
    updatedAt: string;
  }>;
  updatedAt: string;
}

export interface PersonalOverrideStore {
  dashboards: Record<string, DashboardPersonalOverride>;
  reports: Record<string, ReportPersonalOverride>;
}

export type StudioObject = ReportDefinition | DashboardDefinition;

export interface SummaryDatum {
  label: string;
  value: string;
  numericValue: number;
}

export interface ChartDatum {
  label: string;
  rawLabel?: string;
  value: number;
  series?: string;
  rawSeries?: string;
  axis?: ChartAxisAssignment;
}

export interface DataFreshnessInfo {
  source: "quickbase-live" | "scheduled-cache" | "local-fallback";
  fetchedAt: string;
}

export interface RefreshScheduleConfig {
  enabled: boolean;
  cadence: RefreshCadence;
  timeOfDay: string;
  dayOfWeek: number;
  dayOfMonth: number;
  timeZone: string;
}

export interface RefreshStatus {
  running: boolean;
  activeJobId: string;
  cancelRequested: boolean;
  progress: number;
  message: string;
  estimatedSecondsRemaining?: number;
  lastStartedAt: string;
  lastCompletedAt: string;
  lastCancelledAt: string;
  lastSuccessAt: string;
  lastError: string;
  nextRunAt: string;
  cachedTableIds: string[];
  cachedRowCount: number;
}

export interface QuickbaseConnectionConfig {
  realmHostname: string;
  userToken: string;
  appToken: string;
  appId: string;
  apiBaseUrl: string;
  helpdeskAppDbid: string;
  helpdeskTicketsTableDbid: string;
  helpdeskParentTableDbid: string;
  helpdeskParentAppIdFid: string;
  objectTableId: string;
  objectKeyFieldId: string;
  objectTypeFieldId: string;
  objectNameFieldId: string;
  objectConfigFieldId: string;
  objectOwnerFieldId: string;
  objectPersonalOwnerFieldId: string;
  objectUpdatedAtFieldId: string;
  objectUpdatedByFieldId: string;
  rosterTableId: string;
  rosterUserIdFieldId: string;
  rosterEmployeeNameFieldId: string;
  rosterEmployeeEmailFieldId: string;
  rosterEmployeeRecordIdFieldId: string;
  settingsTableId: string;
  settingsUserFieldId: string;
  settingsObjectFieldId: string;
  settingsObjectKeyFieldId: string;
  settingsJsonFieldId: string;
  settingsUpdatedByFieldId: string;
  versionTableId: string;
  versionObjectFieldId: string;
  versionObjectKeyFieldId: string;
  versionSnapshotFieldId: string;
  versionChangedAtFieldId: string;
  versionChangedByFieldId: string;
  versionUpdatedByFieldId: string;
}

export interface QuickbaseBootstrapStatus {
  ready: boolean;
  checkedAt: string;
  autoProvisioned: boolean;
  missing: string[];
  warnings: string[];
  message: string;
  error?: string;
}

export interface QuickbaseAppProfile {
  id: string;
  label: string;
  liveMode: boolean;
  quickbase: QuickbaseConnectionConfig;
  bootstrap: QuickbaseBootstrapStatus;
  refreshSource: {
    tableIds: string[];
    reportIds: Record<string, string>;
  };
  refreshSchedule: RefreshScheduleConfig;
  refreshStatus: RefreshStatus;
}

export interface RefreshJobStatus {
  id: string;
  status: "queued" | "running" | "complete" | "failed" | "cancelled";
  progress: number;
  message: string;
  error?: string;
  reason: "manual" | "scheduled";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  estimatedSecondsRemaining?: number;
  tableCount?: number;
  rowCount?: number;
}

export interface ReportRunResult {
  reportId: string;
  tableId: string;
  totalRows: number;
  rows: DataRow[];
  summary: SummaryDatum[];
  chartData: ChartDatum[];
  warnings: string[];
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  freshness?: DataFreshnessInfo;
  refreshJob?: RefreshJobStatus | null;
}

export interface DashboardWidgetResult {
  widgetId: string;
  widget: WidgetDefinition;
  report: ReportDefinition;
  result: ReportRunResult;
  status: "complete" | "failed";
  message: string;
  error?: string;
}

export interface DashboardRunResult {
  dashboard: DashboardDefinition;
  tabs: Array<{
    id: string;
    name: string;
    widgets: DashboardWidgetResult[];
  }>;
  freshness?: DataFreshnessInfo;
  refreshJob?: RefreshJobStatus | null;
}

export interface CatalogSummaryItem {
  id: string;
  type: StudioObjectType;
  schemaVersion: number;
  name: string;
  description: string;
  folder: string;
  category: string;
  tags: string[];
  scope: StudioObjectScope;
  createdByUserId?: string;
  ownerUserId: string;
  sharedUserIds: string[];
  updatedAt: string;
}

export interface SeedBundle {
  app: {
    id: string;
    name: string;
  };
  tables: TableDefinition[];
  data: Record<string, DataRow[]>;
  objects: Record<string, StudioObject>;
  order: string[];
}

export type StudioTemplateType = "layout" | "yaml" | "upload";

export interface StudioTemplateRecord {
  id: string;
  type: StudioTemplateType;
  name: string;
  tableId?: string;
  columnMap?: Record<string, string>;
  object?: StudioObject | null;
}

export interface StudioVersionRecord {
  id: string;
  label: string;
  savedAt: string;
  object: StudioObject;
}

export interface StudioExportJob {
  id: string;
  objectId: string;
  objectType: "report" | "dashboard" | "studio";
  format: "xlsx" | "json";
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  message: string;
  filename?: string;
  error?: string;
  updatedAt: string;
  sourceJobId?: string;
  runtimeFilters?: Record<string, string>;
  createdAt: string;
}

export interface ExportJobStatus {
  id: string;
  objectId: string;
  objectType: "report" | "dashboard";
  format: "xlsx";
  status: "queued" | "running" | "complete" | "failed";
  progress: number;
  message: string;
  filename?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StudioDocument {
  schemaVersion: number;
  bundle: SeedBundle;
  favorites: string[];
  recent: string[];
  personalOverrides: PersonalOverrideStore;
  session: {
    currentUserId: string;
    launchSource: "quickbase-button" | "local-dev";
    launchRealmHostname: string;
    launchAppId: string;
    inactivityTimeoutHours: number;
    inactivityGraceMinutes: number;
    requiresLaunch: boolean;
    launchedAt: string;
    lastActivityAt: string;
    expiresAt: string;
    lastValidatedAt: string;
  };
  branding: {
    platformName: string;
    navigationLabel: string;
    homeLabel: string;
    openLinksInNewTab: boolean;
  };
  quickbase: QuickbaseConnectionConfig;
  quickbaseProfiles: QuickbaseAppProfile[];
  activeQuickbaseProfileId: string;
  templates: {
    layouts: StudioTemplateRecord[];
    yaml: StudioTemplateRecord[];
    upload: StudioTemplateRecord[];
  };
  versions: Record<string, StudioVersionRecord[]>;
  exportJobs: StudioExportJob[];
  sync: {
    providerMode: "local" | "api";
    lastSavedAt: string;
    lastLoadedAt: string;
    refreshSchedule: RefreshScheduleConfig;
    refreshStatus: RefreshStatus;
  };
}
