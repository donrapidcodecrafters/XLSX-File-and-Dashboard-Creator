export type StudioObjectType = "report" | "dashboard";
export type FieldType = "text" | "number" | "currency" | "date" | "datetime" | "user" | "multiselect";
export type FilterOperator = "equals" | "contains" | "gt" | "gte" | "lt" | "lte";
export type SortDirection = "asc" | "desc";
export type WidgetMode = "linked" | "copied";
export type ReportViewMode = "table" | "summary" | "chart" | "timeline" | "calendar" | "kanban";
export type ChartType = "bar" | "column" | "line" | "area" | "donut" | "pie" | "stacked-bar" | "stacked-column" | "funnel" | "heatmap";
export type RuntimeFilterMode = "global" | "selected";

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
  fields: FieldDefinition[];
}

export interface FilterDefinition {
  id: string;
  fieldId: string;
  operator: FilterOperator;
  value: string;
}

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
  chartType: ChartType;
  chartFieldId: string;
  timelineDateField: string;
  timelineEndField: string;
  calendarDateField: string;
  kanbanField: string;
  titleFieldId: string;
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
  selectedFieldIds: string[];
  filters: FilterDefinition[];
  groups: GroupDefinition[];
  sorts: SortDefinition[];
  summaryMetrics: SummaryMetric[];
  view: ReportViewDefinition;
}

export interface WidgetDefinition {
  id: string;
  title: string;
  layout: {
    w: number;
    h: number;
  };
  mode: WidgetMode;
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

export interface ReportRunResult {
  reportId: string;
  tableId: string;
  totalRows: number;
  rows: DataRow[];
  summary: SummaryDatum[];
  chartData: ChartDatum[];
  warnings: string[];
}

export interface DashboardWidgetResult {
  widgetId: string;
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
  status: "queued" | "complete";
  createdAt: string;
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
  quickbase: {
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
  };
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
  };
}
