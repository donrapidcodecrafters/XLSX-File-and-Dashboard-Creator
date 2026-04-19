export type StudioObjectType = "report" | "dashboard";
export type FieldType = "text" | "number" | "currency" | "date" | "datetime" | "user" | "multiselect";
export type FilterOperator = "equals" | "not-equals" | "contains" | "not-contains" | "blank" | "not-blank" | "gt" | "gte" | "lt" | "lte";
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
  | "3d-scatter";
export type ChartAggregation = "count" | "sum" | "avg" | "min" | "max";
export type ChartSortMode = "value-desc" | "value-asc" | "label-asc" | "label-desc";
export type ChartOrientation = "vertical" | "horizontal";
export type RuntimeFilterMode = "global" | "selected";
export type RefreshCadence = "daily" | "weekly" | "monthly";

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
  chartValueFieldId: string;
  chartAggregation: ChartAggregation;
  chartTopN: number;
  chartSort: ChartSortMode;
  chartShowLegend: boolean;
  chartShowValues: boolean;
  chartXAxisLabel: string;
  chartYAxisLabel: string;
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
  name: string;
  description: string;
  folder: string;
  category: string;
  tags: string[];
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
  layout: {
    w: number;
    h: number;
  };
  mode: WidgetMode;
  displayMode: "inherit" | "table" | "summary" | "chart";
  showDetails: boolean;
  showSummary: boolean;
  reportId: string;
  snapshot?: ReportDefinition;
}

export interface DashboardTabDefinition {
  id: string;
  name: string;
  widgets: WidgetDefinition[];
}

export interface RuntimeFilterDefinition {
  id: string;
  label: string;
  fieldId: string;
  mode: RuntimeFilterMode;
  targetReportIds: string[];
  defaultValue: string;
}

export interface DashboardDefinition extends BaseStudioObject {
  type: "dashboard";
  tabs: DashboardTabDefinition[];
  runtimeFilters: RuntimeFilterDefinition[];
  sourceReportOverrides?: Record<string, string>;
}

export type StudioObject = ReportDefinition | DashboardDefinition;

export interface SummaryDatum {
  label: string;
  value: string;
  numericValue: number;
}

export interface ChartDatum {
  label: string;
  value: number;
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
  progress: number;
  message: string;
  estimatedSecondsRemaining?: number;
  lastStartedAt: string;
  lastCompletedAt: string;
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
  objectTableId: string;
  objectKeyFieldId: string;
  objectTypeFieldId: string;
  objectNameFieldId: string;
  objectConfigFieldId: string;
  objectOwnerFieldId: string;
  objectUpdatedAtFieldId: string;
  objectUpdatedByFieldId: string;
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

export interface QuickbaseAppProfile {
  id: string;
  label: string;
  liveMode: boolean;
  quickbase: QuickbaseConnectionConfig;
  refreshSource: {
    tableIds: string[];
    reportIds: Record<string, string>;
  };
  refreshSchedule: RefreshScheduleConfig;
  refreshStatus: RefreshStatus;
}

export interface RefreshJobStatus {
  id: string;
  status: "queued" | "running" | "complete" | "failed";
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
}

export interface DashboardWidgetResult {
  widgetId: string;
  widget: WidgetDefinition;
  report: ReportDefinition;
  result: ReportRunResult;
}

export interface DashboardRunResult {
  dashboard: DashboardDefinition;
  tabs: Array<{
    id: string;
    name: string;
    widgets: DashboardWidgetResult[];
  }>;
  freshness?: DataFreshnessInfo;
}

export interface CatalogSummaryItem {
  id: string;
  type: StudioObjectType;
  name: string;
  description: string;
  folder: string;
  category: string;
  tags: string[];
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
  format: "xlsx" | "json";
  status: "queued" | "running" | "complete" | "failed";
  progress?: number;
  message?: string;
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
  bundle: SeedBundle;
  favorites: string[];
  recent: string[];
  branding: {
    platformName: string;
    navigationLabel: string;
    homeLabel: string;
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
