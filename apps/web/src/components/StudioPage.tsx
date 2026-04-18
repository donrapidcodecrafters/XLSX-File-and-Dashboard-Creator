import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  buildDashboardFilters,
  buildDashboardResult,
  buildStudioDocument,
  getReportFieldLabel,
  normalizeStudioDocument,
  runReport,
  type ChartAggregation,
  type ChartSortMode,
  type ChartType,
  type DashboardDefinition,
  type DashboardRunResult,
  type DataRow,
  type ExportJobStatus,
  type FieldType,
  type FilterDefinition,
  type FilterOperator,
  type ReportDefinition,
  type ReportRunResult,
  type ReportViewMode,
  type SeedBundle,
  type StudioDocument,
  type StudioObject,
  type StudioTemplateRecord,
  type StudioTemplateType,
  type StudioVersionRecord,
  type SummaryMetric,
  type TableDefinition
} from "@studio/shared";
import {
  createStudioSnapshot,
  fetchQuickbaseReportPreview,
  fetchQuickbaseSchema,
  fetchStudioDocument,
  type QuickbaseAppSchema,
  type QuickbaseSyncResult,
  fetchStudioVersions,
  restoreStudioVersion,
  saveStudioDocument
} from "../lib/studioApi";
import { downloadExportJob, fetchExportJobStatus, startDashboardExportJob, startReportExportJob } from "../lib/api";
import { ChartPreview } from "./ChartPreview";

const STORAGE_KEY = "hosted-reporting-studio-v2";
const REPORT_VIEW_OPTIONS: ReportViewMode[] = ["table", "summary", "chart", "timeline", "calendar", "kanban"];
const CHART_OPTIONS: ChartType[] = ["bar", "column", "line", "area", "donut", "pie", "stacked-bar", "stacked-column", "funnel", "heatmap", "radar", "gauge", "waterfall"];
const CHART_AGGREGATION_OPTIONS: ChartAggregation[] = ["count", "sum", "avg", "min", "max"];
const CHART_SORT_OPTIONS: Array<{ value: ChartSortMode; label: string }> = [
  { value: "value-desc", label: "Value high to low" },
  { value: "value-asc", label: "Value low to high" },
  { value: "label-asc", label: "Label A to Z" },
  { value: "label-desc", label: "Label Z to A" }
];
const FILTER_OPERATOR_OPTIONS: Array<{ value: FilterOperator; label: string }> = [
  { value: "equals", label: "Equals" },
  { value: "contains", label: "Contains" },
  { value: "gt", label: "Greater than" },
  { value: "gte", label: "Greater than or equal" },
  { value: "lt", label: "Less than" },
  { value: "lte", label: "Less than or equal" }
];

type DrawerKind = null | "settings" | "share" | "templates" | "export" | "versions";
type LibraryFilter = "all" | "report" | "dashboard";
type ToastTone = "ok" | "warn" | "danger";
type CreateModalType = "report" | "dashboard";

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

interface CreateObjectDraft {
  type: CreateModalType;
  name: string;
  description: string;
  tableId: string;
  selectedFieldIds: string[];
  filters: FilterDefinition[];
  sorts: ReportDefinition["sorts"];
  summaryMetrics: SummaryMetric[];
  view: ReportDefinition["view"];
  displayLabels: ReportDefinition["displayLabels"];
}

function buildDraftFromReport(report: ReportDefinition, table?: TableDefinition | null): CreateObjectDraft {
  const sourceTableId = table?.id || report.sourceTableId || "";
  return {
    type: "report",
    name: report.name,
    description: report.description,
    tableId: sourceTableId,
    selectedFieldIds: clone(report.selectedFieldIds || []),
    filters: clone(report.filters || []),
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

function typeLabel(type: StudioObject["type"]) {
  return type === "report" ? "Report" : "Dashboard";
}

function loadLocalDocument() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalizeStudioDocument(JSON.parse(raw) as StudioDocument) : buildStudioDocument();
  } catch {
    return buildStudioDocument();
  }
}

function saveLocalDocument(document: StudioDocument) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
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

function convertQuickbaseSchemaToTables(schema: QuickbaseAppSchema): TableDefinition[] {
  return schema.tables.map((table) => ({
    id: table.id,
    name: table.name,
    description: table.description || "Quickbase table",
    fields: table.fields.map((field) => ({
      id: field.fid,
      label: field.label,
      type: mapQuickbaseFieldType(field.fieldType, field.baseType)
    }))
  }));
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

function buildCreateDraft(table?: TableDefinition | null, type: CreateModalType = "report"): CreateObjectDraft {
  const firstFieldId = table?.fields[0]?.id || "";
  const secondFieldId = table?.fields[1]?.id || firstFieldId;
  return {
    type,
    name: type === "report" ? "New Report" : "New Dashboard",
    description: "",
    tableId: table?.id || "",
    selectedFieldIds: table?.fields.slice(0, 6).map((field) => field.id) || [],
    filters: [],
    sorts: [],
    summaryMetrics: firstFieldId ? [{ id: uid("metric"), fieldId: firstFieldId, op: "count", label: "Rows" }] : [],
    view: {
      mode: "table",
      chartType: "bar",
      chartFieldId: firstFieldId,
      chartValueFieldId: "",
      chartAggregation: "count",
      chartTopN: 12,
      chartSort: "value-desc",
      chartShowLegend: true,
      chartShowValues: true,
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: secondFieldId
    },
    displayLabels: {
      fields: {},
      chartValues: {}
    }
  };
}

function collectReportFieldIds(report: ReportDefinition) {
  return Array.from(new Set(
    [
      ...(report.selectedFieldIds || []),
      ...(report.filters || []).map((item) => item.fieldId),
      ...(report.groups || []).map((item) => item.fieldId),
      ...(report.sorts || []).map((item) => item.fieldId),
      ...((report.summaryMetrics || []).map((item) => item.fieldId)),
      report.view.chartFieldId,
      report.view.chartValueFieldId,
      report.view.timelineDateField,
      report.view.timelineEndField,
      report.view.calendarDateField,
      report.view.kanbanField,
      report.view.titleFieldId
    ].filter(Boolean).map(String)
  ));
}

function getFieldLabel(report: ReportDefinition, table: TableDefinition | null | undefined, fieldId: string) {
  return table ? getReportFieldLabel(report, table, fieldId) : fieldId;
}

function clampWidgetWidth(value: number) {
  return Math.max(1, Math.min(12, Math.round(value || 1)));
}

function clampWidgetHeight(value: number) {
  return Math.max(2, Math.min(10, Math.round(value || 2)));
}

function getWidgetLayoutStyle(layout: { w: number; h: number }) {
  return {
    gridColumn: `span ${clampWidgetWidth(layout.w)}`,
    minHeight: `${clampWidgetHeight(layout.h) * 96}px`
  };
}

function looksLikeQuickbaseTableId(value: string) {
  return /^[a-z0-9]{8,}$/i.test(String(value || "").trim());
}

function looksLikeQuickbaseFieldId(value: string) {
  return /^\d+$/.test(String(value || "").trim());
}

function shouldAutoLoadQuickbaseSchema(document: StudioDocument) {
  const quickbase = document.quickbase;
  if (!quickbase.realmHostname || !quickbase.userToken || !quickbase.appId) return false;
  const tables = document.bundle.tables || [];
  if (!tables.length) return true;
  return tables.some((table) =>
    !looksLikeQuickbaseTableId(table.id) ||
    (table.fields || []).some((field) => !looksLikeQuickbaseFieldId(field.id))
  );
}

function canUseLiveQuickbasePreview(report: ReportDefinition | null, table: TableDefinition | null) {
  if (!report || !table) return false;
  if (!looksLikeQuickbaseTableId(table.id)) return false;
  const fieldIds = collectReportFieldIds(report);
  return fieldIds.every((fieldId) => looksLikeQuickbaseFieldId(fieldId));
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
    if (!object.selectedFieldIds.length) messages.push("Select at least one field.");
    if (object.view.mode === "chart" && !object.view.chartFieldId) messages.push("Choose a chart grouping field.");
    if (object.view.mode === "chart" && object.view.chartAggregation !== "count" && !object.view.chartValueFieldId) messages.push("Choose a numeric value field for the chart.");
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

function ReportPreview({ report, table, result }: { report: ReportDefinition; table: TableDefinition; result: ReportRunResult }) {
  if (report.view.mode === "summary") {
    return (
      <div className="studio-preview-stack">
        <div className="summary-grid">
          {result.summary.map((item) => (
            <div className="summary-card" key={item.label}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </div>
          ))}
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                {report.selectedFieldIds.map((fieldId) => <th key={fieldId}>{getReportFieldLabel(report, table, fieldId)}</th>)}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {report.selectedFieldIds.map((fieldId) => <td key={fieldId}>{formatCell(row[fieldId])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (report.view.mode === "chart") {
    return (
      <ChartPreview
        chartType={report.view.chartType}
        data={result.chartData}
        showLegend={report.view.chartShowLegend}
        showValues={report.view.chartShowValues}
      />
    );
  }

  if (report.view.mode === "timeline" || report.view.mode === "calendar") {
    const dateFieldId = report.view.mode === "timeline" ? report.view.timelineDateField : report.view.calendarDateField;
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    return (
      <div className="studio-card-grid">
        {result.rows.map((row, index) => (
          <article className="studio-mini-card" key={index}>
            <strong>{formatCell(row[titleFieldId])}</strong>
            <span>{table.fields.find((field) => field.id === dateFieldId)?.label || "Date"}: {formatCell(row[dateFieldId])}</span>
            {report.view.mode === "timeline" && report.view.timelineEndField ? <span>Ends: {formatCell(row[report.view.timelineEndField])}</span> : null}
          </article>
        ))}
      </div>
    );
  }

  if (report.view.mode === "kanban") {
    const fieldId = report.view.kanbanField || report.selectedFieldIds[0];
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    const columns = new Map<string, DataRow[]>();
    result.rows.forEach((row) => {
      const key = formatCell(row[fieldId]) || "Unassigned";
      columns.set(key, [...(columns.get(key) || []), row]);
    });
    return (
      <div className="kanban-board">
        {Array.from(columns.entries()).map(([key, rows]) => (
          <section className="kanban-column" key={key}>
            <div className="kanban-head">
              <strong>{key}</strong>
              <span>{rows.length}</span>
            </div>
            <div className="kanban-stack">
              {rows.map((row, index) => (
                <article className="studio-mini-card" key={index}>
                  <strong>{formatCell(row[titleFieldId])}</strong>
                  {report.selectedFieldIds.slice(1, 4).map((fieldId) => <span key={fieldId}>{formatCell(row[fieldId])}</span>)}
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>
            {report.selectedFieldIds.map((fieldId) => <th key={fieldId}>{getReportFieldLabel(report, table, fieldId)}</th>)}
          </tr>
        </thead>
        <tbody>
          {result.rows.map((row, index) => (
            <tr key={index}>
              {report.selectedFieldIds.map((fieldId) => <td key={fieldId}>{formatCell(row[fieldId])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DashboardPreview({
  dashboard,
  result,
  tables,
  runtimeValues,
  setRuntimeValues,
  widgetSearch,
  draggingWidget,
  onOpenReport,
  onStartWidgetDrag,
  onEndWidgetDrag,
  onDropWidget,
  onToggleFullWidth,
  onBeginResizeWidget,
  onMoveWidget
}: {
  dashboard: DashboardDefinition;
  result: DashboardRunResult;
  tables: TableDefinition[];
  runtimeValues: Record<string, string>;
  setRuntimeValues: Dispatch<SetStateAction<Record<string, string>>>;
  widgetSearch: string;
  draggingWidget: { tabId: string; widgetId: string } | null;
  onOpenReport: (reportId: string) => void;
  onStartWidgetDrag: (tabId: string, widgetId: string) => void;
  onEndWidgetDrag: () => void;
  onDropWidget: (tabId: string, widgetId: string) => void;
  onToggleFullWidth: (tabId: string, widgetId: string) => void;
  onBeginResizeWidget: (event: ReactPointerEvent<HTMLButtonElement>, tabId: string, widgetId: string, layout: { w: number; h: number }) => void;
  onMoveWidget: (tabId: string, widgetId: string, direction: -1 | 1) => void;
}) {
  const normalizedQuery = widgetSearch.trim().toLowerCase();
  const resolveWidgetDisplayMode = (widget: DashboardRunResult["tabs"][number]["widgets"][number]["widget"], reportMode: string) => {
    if (widget.displayMode !== "inherit") return widget.displayMode;
    if (reportMode === "summary") return "summary";
    if (reportMode === "chart") return "chart";
    return "table";
  };
  return (
    <div className="studio-preview-stack">
      {dashboard.runtimeFilters.length ? (
        <section className="card">
          <div className="card-head">
            <strong>Filters</strong>
            <span className="micro">Live dashboard controls</span>
          </div>
          <div className="filter-grid">
            {dashboard.runtimeFilters.map((filter) => (
              <label className="field" key={filter.id}>
                <span>{filter.label}</span>
                <input value={runtimeValues[filter.id] || ""} onChange={(event) => setRuntimeValues((current) => ({ ...current, [filter.id]: event.target.value }))} />
              </label>
            ))}
          </div>
        </section>
      ) : null}
      {result.tabs.map((tab) => {
        const widgets = tab.widgets.filter((widget) => {
          if (!normalizedQuery) return true;
          return `${widget.report.name} ${widget.result.summary.map((item) => item.label).join(" ")}`.toLowerCase().includes(normalizedQuery);
        });
        return (
          <section className="card" key={tab.id}>
            <div className="card-head">
              <strong>{tab.name}</strong>
              <span className="micro">{widgets.length} cards</span>
            </div>
            <div className="widget-grid dashboard-layout-grid">
              {widgets.map((widget) => {
                const widgetTable = tables.find((table) => table.id === widget.report.sourceTableId) || null;
                const isDragging = draggingWidget?.tabId === tab.id && draggingWidget?.widgetId === widget.widgetId;
                return (
                <article
                  className={`widget-card dashboard-layout-item${isDragging ? " is-dragging" : ""}`}
                  key={widget.widgetId}
                  style={getWidgetLayoutStyle(widget.widget.layout)}
                  draggable
                  onDragStart={() => onStartWidgetDrag(tab.id, widget.widgetId)}
                  onDragEnd={onEndWidgetDrag}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => onDropWidget(tab.id, widget.widgetId)}
                >
                  <div className="widget-head">
                    <strong>{widget.widget.title || widget.report.name}</strong>
                    <div className="widget-preview-controls">
                      <button className="link-like" onClick={() => onMoveWidget(tab.id, widget.widgetId, -1)}>Move up</button>
                      <button className="link-like" onClick={() => onMoveWidget(tab.id, widget.widgetId, 1)}>Move down</button>
                      <button className="link-like" onClick={() => onToggleFullWidth(tab.id, widget.widgetId)}>
                        {clampWidgetWidth(widget.widget.layout.w) >= 12 ? "Restore width" : "Full width"}
                      </button>
                      <button className="link-like" onClick={() => onOpenReport(widget.report.id)}>Edit report</button>
                    </div>
                  </div>
                  {widget.widget.showSummary ? (
                    <div className="widget-metrics">
                      {widget.result.summary.map((item) => (
                        <div className="mini-stat" key={item.label}>
                          <strong>{item.value}</strong>
                          <span>{item.label}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {resolveWidgetDisplayMode(widget.widget, widget.report.view.mode) === "chart" ? (
                    <div className="mini-chart">
                      <ChartPreview
                        chartType={widget.report.view.chartType}
                        data={widget.result.chartData}
                        compact
                        showLegend={widget.report.view.chartShowLegend}
                        showValues={widget.report.view.chartShowValues}
                      />
                    </div>
                  ) : null}
                  {resolveWidgetDisplayMode(widget.widget, widget.report.view.mode) === "table" || widget.widget.showDetails ? (
                    <div className="table-shell compact-table-shell">
                      <table>
                        <thead>
                          <tr>
                            {widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => <th key={fieldId}>{getFieldLabel(widget.report, widgetTable, fieldId)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {widget.result.rows.slice(0, 8).map((row, index) => (
                            <tr key={index}>
                              {widget.report.selectedFieldIds.slice(0, 6).map((fieldId) => <td key={fieldId}>{formatCell(row[fieldId])}</td>)}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    className="widget-resize-handle"
                    aria-label="Resize card"
                    title="Drag to resize"
                    onPointerDown={(event) => onBeginResizeWidget(event, tab.id, widget.widgetId, widget.widget.layout)}
                  />
                </article>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ReportFiltersAndSortsEditor({
  table,
  filters,
  sorts,
  onChangeFilters,
  onChangeSorts
}: {
  table: TableDefinition;
  filters: FilterDefinition[];
  sorts: ReportDefinition["sorts"];
  onChangeFilters: (filters: FilterDefinition[]) => void;
  onChangeSorts: (sorts: ReportDefinition["sorts"]) => void;
}) {
  return (
    <div className="stack">
      <div className="card">
        <div className="card-head">
          <strong>Filters</strong>
          <button onClick={() => onChangeFilters([...filters, { id: uid("filter"), fieldId: table.fields[0]?.id || "", operator: "equals", value: "" }])}>Add filter</button>
        </div>
        <div className="stack-compact">
          {filters.length ? filters.map((filter) => (
            <div className="inline-edit-row" key={filter.id}>
              <select value={filter.fieldId} onChange={(event) => onChangeFilters(filters.map((item) => item.id === filter.id ? { ...item, fieldId: event.target.value } : item))}>
                {table.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
              </select>
              <select value={filter.operator} onChange={(event) => onChangeFilters(filters.map((item) => item.id === filter.id ? { ...item, operator: event.target.value as FilterOperator } : item))}>
                {FILTER_OPERATOR_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
              <input value={filter.value} onChange={(event) => onChangeFilters(filters.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item))} placeholder="Filter value" />
              <button onClick={() => onChangeFilters(filters.filter((item) => item.id !== filter.id))}>Remove</button>
            </div>
          )) : <div className="empty-hint">No filters yet. Add rules before you create the report so large tables stay manageable.</div>}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <strong>Sorting</strong>
          <button onClick={() => onChangeSorts([...sorts, { id: uid("sort"), fieldId: table.fields[0]?.id || "", direction: "asc" }])}>Add sort</button>
        </div>
        <div className="stack-compact">
          {sorts.length ? sorts.map((sort) => (
            <div className="inline-edit-row" key={sort.id}>
              <select value={sort.fieldId} onChange={(event) => onChangeSorts(sorts.map((item) => item.id === sort.id ? { ...item, fieldId: event.target.value } : item))}>
                {table.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
              </select>
              <select value={sort.direction} onChange={(event) => onChangeSorts(sorts.map((item) => item.id === sort.id ? { ...item, direction: event.target.value as "asc" | "desc" } : item))}>
                <option value="asc">Ascending</option>
                <option value="desc">Descending</option>
              </select>
              <div />
              <button onClick={() => onChangeSorts(sorts.filter((item) => item.id !== sort.id))}>Remove</button>
            </div>
          )) : <div className="empty-hint">No sorting yet.</div>}
        </div>
      </div>
    </div>
  );
}

export function StudioPage() {
  const navigate = useNavigate();
  const params = useParams();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const schemaAutoloadedRef = useRef(false);
  const [documentState, setDocumentState] = useState<StudioDocument>(() => loadLocalDocument());
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [savingRemote, setSavingRemote] = useState(false);
  const [history, setHistory] = useState<StudioDocument[]>([]);
  const [future, setFuture] = useState<StudioDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [dashboardInspectorTab, setDashboardInspectorTab] = useState<"design" | "filters">("design");
  const [activeTabId, setActiveTabId] = useState("");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [versionList, setVersionList] = useState<StudioVersionRecord[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [quickbaseSchema, setQuickbaseSchema] = useState<QuickbaseAppSchema | null>(null);
  const [quickbaseSchemaLoading, setQuickbaseSchemaLoading] = useState(false);
  const [lastQuickbaseSync, setLastQuickbaseSync] = useState<QuickbaseSyncResult | null>(null);
  const [liveReportResult, setLiveReportResult] = useState<ReportRunResult | null>(null);
  const [liveReportLoading, setLiveReportLoading] = useState(false);
  const [exportJob, setExportJob] = useState<ExportJobStatus | null>(null);
  const [downloadedJobId, setDownloadedJobId] = useState("");
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingReportId, setEditingReportId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState<CreateObjectDraft>(() => buildCreateDraft(loadLocalDocument().bundle.tables[0], "report"));
  const [createFieldQuery, setCreateFieldQuery] = useState("");
  const [draggingWidget, setDraggingWidget] = useState<{ tabId: string; widgetId: string } | null>(null);
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
  const objects = useMemo(() => bundle.order.map((id) => bundle.objects[id]).filter(Boolean), [bundle]);
  const activeObjectId = params.objectId && bundle.objects[params.objectId] ? params.objectId : bundle.order[0];
  const activeObject = activeObjectId ? bundle.objects[activeObjectId] : null;
  const activeReport = activeObject?.type === "report" ? activeObject : null;
  const activeDashboard = activeObject?.type === "dashboard" ? activeObject : null;
  const activeTable = activeReport ? bundle.tables.find((table) => table.id === activeReport.sourceTableId) || null : null;
  const createDraftTable = bundle.tables.find((table) => table.id === createDraft.tableId) || bundle.tables[0] || null;
  const validation = activeObject ? validationMessages(activeObject, activeTable) : [];
  const visibleCreateFields = useMemo(() => {
    if (!createDraftTable) return [];
    const query = createFieldQuery.trim().toLowerCase();
    if (!query) return createDraftTable.fields;
    return createDraftTable.fields.filter((field) => `${field.label} ${field.id} ${field.type}`.toLowerCase().includes(query));
  }, [createDraftTable, createFieldQuery]);
  const createDraftPreview = useMemo(() => {
    if (createDraft.type !== "report" || !createDraftTable || !createDraft.selectedFieldIds.length) return null;
    const previewReport: ReportDefinition = {
      id: editingReportId || "draft-report-preview",
      type: "report",
      name: createDraft.name || "Draft report",
      description: createDraft.description,
      folder: "Custom",
      category: "Reporting",
      tags: [],
      updatedAt: new Date().toISOString(),
      sourceTableId: createDraft.tableId,
      selectedFieldIds: createDraft.selectedFieldIds,
      filters: createDraft.filters,
      groups: [],
      sorts: createDraft.sorts,
      summaryMetrics: createDraft.summaryMetrics,
      view: createDraft.view,
      displayLabels: createDraft.displayLabels
    };
    return runReport(previewReport, createDraftTable, bundle.data[createDraftTable.id] || []);
  }, [bundle.data, createDraft, createDraftTable, editingReportId]);
  const chartValueLabelOptions = useMemo(() => {
    const previewLabels = createDraftPreview?.chartData.map((item) => item.label) || [];
    const existingLabels = Object.keys(createDraft.displayLabels.chartValues || {});
    return Array.from(new Set([...previewLabels, ...existingLabels]));
  }, [createDraft.displayLabels.chartValues, createDraftPreview?.chartData]);

  function pushToast(message: string, tone: ToastTone = "ok") {
    const id = uid("toast");
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 3500);
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
    let active = true;
    setLoadingRemote(true);
    fetchStudioDocument()
      .then((response) => {
        if (!active) return;
        const next = normalizeStudioDocument(response.document);
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
    documentState.quickbase.appId,
    documentState.quickbase.realmHostname,
    documentState.quickbase.userToken,
    documentState.bundle.tables
  ]);

  useEffect(() => {
    if (!activeObjectId && bundle.order[0]) {
      navigate(`/studio/${bundle.order[0]}`, { replace: true });
    }
  }, [activeObjectId, bundle.order, navigate]);

  useEffect(() => {
    if (!activeObjectId) return;
    applyDocumentUpdate((draft) => {
      draft.recent = [activeObjectId, ...draft.recent.filter((item) => item !== activeObjectId)].slice(0, 10);
    }, { skipHistory: true });
  }, [activeObjectId]);

  useEffect(() => {
    if (activeDashboard) {
      setActiveTabId((current) => activeDashboard.tabs.some((tab) => tab.id === current) ? current : (activeDashboard.tabs[0]?.id || ""));
      setRuntimeValues(Object.fromEntries(activeDashboard.runtimeFilters.map((filter) => [filter.id, filter.defaultValue || ""])));
    }
  }, [activeDashboard?.id]);

  useEffect(() => {
    let active = true;
    if (!activeReport || !activeTable) {
      setLiveReportResult(null);
      setLiveReportLoading(false);
      return;
    }
    if (!documentState.quickbase.realmHostname || !documentState.quickbase.userToken || !documentState.quickbase.appId) {
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
    fetchQuickbaseReportPreview(documentState.quickbase, activeReport, activeTable)
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
    documentState.quickbase.appId,
    documentState.quickbase.realmHostname,
    documentState.quickbase.userToken
  ]);

  useEffect(() => {
    if (!exportJob || exportJob.status === "complete" || exportJob.status === "failed") return;
    const handle = window.setInterval(() => {
      fetchExportJobStatus(exportJob.id)
        .then((response) => setExportJob(response.job))
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [exportJob?.id, exportJob?.status]);

  useEffect(() => {
    if (!exportJob || exportJob.status !== "complete" || downloadedJobId === exportJob.id) return;
    downloadExportJob(exportJob.id);
    setDownloadedJobId(exportJob.id);
    pushToast("Download is ready.");
  }, [downloadedJobId, exportJob]);

  useEffect(() => {
    if (!resizeSession) return;
    const session = resizeSession;

    function handlePointerMove(event: PointerEvent) {
      const nextW = clampWidgetWidth(session.startW + Math.round((event.clientX - session.startX) / 96));
      const nextH = clampWidgetHeight(session.startH + Math.round((event.clientY - session.startY) / 88));
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
    const query = libraryQuery.trim().toLowerCase();
    return objects.filter((object) => {
      if (libraryFilter !== "all" && object.type !== libraryFilter) return false;
      if (favoritesOnly && !documentState.favorites.includes(object.id)) return false;
      if (recentOnly && !documentState.recent.includes(object.id)) return false;
      if (!query) return true;
      return [object.name, object.description, object.folder, object.category, object.tags.join(" ")].join(" ").toLowerCase().includes(query);
    });
  }, [objects, libraryQuery, libraryFilter, favoritesOnly, recentOnly, documentState.favorites, documentState.recent]);

  const localReportResult = useMemo(() => {
    if (!activeReport || !activeTable) return null;
    return runReport(activeReport, activeTable, bundle.data[activeReport.sourceTableId] || []);
  }, [activeReport, activeTable, bundle.data]);
  const reportResult = liveReportResult || localReportResult;

  const dashboardResult = useMemo(() => {
    if (!activeDashboard) return null;
    const widgets = activeDashboard.tabs.flatMap((tab) =>
      tab.widgets.map((widget) => {
        const report = widget.mode === "copied" && widget.snapshot ? widget.snapshot : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
        if (!report) return null;
        const table = bundle.tables.find((item) => item.id === report.sourceTableId);
        if (!table) return null;
        return {
          widgetId: widget.id,
          widget,
          report,
          result: runReport(report, table, bundle.data[report.sourceTableId] || [], buildDashboardFilters(activeDashboard, report.id, runtimeValues))
        };
      }).filter((item): item is { widgetId: string; widget: typeof tab.widgets[number]; report: ReportDefinition; result: ReportRunResult } => Boolean(item))
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

  function moveDashboardWidget(tabId: string, widgetId: string, direction: -1 | 1) {
    if (!activeDashboard) return;
    const nextDashboard = clone(activeDashboard);
    const tab = nextDashboard.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const currentIndex = tab.widgets.findIndex((item) => item.id === widgetId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= tab.widgets.length) return;
    const [widget] = tab.widgets.splice(currentIndex, 1);
    tab.widgets.splice(nextIndex, 0, widget);
    writeObject(nextDashboard);
  }

  function reorderDashboardWidget(tabId: string, sourceWidgetId: string, targetWidgetId: string) {
    if (!activeDashboard || sourceWidgetId === targetWidgetId) return;
    const nextDashboard = clone(activeDashboard);
    const tab = nextDashboard.tabs.find((item) => item.id === tabId);
    if (!tab) return;
    const fromIndex = tab.widgets.findIndex((item) => item.id === sourceWidgetId);
    const toIndex = tab.widgets.findIndex((item) => item.id === targetWidgetId);
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return;
    const [widget] = tab.widgets.splice(fromIndex, 1);
    tab.widgets.splice(toIndex, 0, widget);
    writeObject(nextDashboard);
  }

  function toggleDashboardWidgetFullWidth(tabId: string, widgetId: string) {
    updateActiveDashboardWidget(tabId, widgetId, (widget) => ({
      ...widget,
      layout: {
        ...widget.layout,
        w: clampWidgetWidth(widget.layout.w) >= 12 ? 6 : 12
      }
    }));
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
      startW: clampWidgetWidth(layout.w),
      startH: clampWidgetHeight(layout.h),
      nextW: clampWidgetWidth(layout.w),
      nextH: clampWidgetHeight(layout.h)
    });
  }

  async function openCreateModal(type: CreateModalType) {
    let nextTable: TableDefinition | null = bundle.tables[0] || null;
    if (type === "report" && shouldAutoLoadQuickbaseSchema(documentState)) {
      const schema = await loadQuickbaseMetadata(true);
      if (schema) {
        nextTable = convertQuickbaseSchemaToTables(schema)[0] || nextTable;
      }
    }
    setCreateDraft(buildCreateDraft(nextTable, type));
    setEditingReportId(null);
    setCreateFieldQuery("");
    setCreateModalOpen(true);
  }

  function openEditReportModal(report: ReportDefinition) {
    const table = bundle.tables.find((item) => item.id === report.sourceTableId) || null;
    setCreateDraft(buildDraftFromReport(report, table));
    setEditingReportId(report.id);
    setCreateFieldQuery("");
    setCreateModalOpen(true);
  }

  function updateCreateDraftTable(tableId: string) {
    const table = bundle.tables.find((item) => item.id === tableId) || bundle.tables[0] || null;
    if (!table) return;
    setCreateDraft((current) => ({
      ...current,
      tableId: table.id,
      selectedFieldIds: table.fields.slice(0, 6).map((field) => field.id),
      filters: [],
      sorts: [],
      summaryMetrics: table.fields[0] ? [{ id: uid("metric"), fieldId: table.fields[0].id, op: "count", label: "Rows" }] : [],
      view: {
        ...current.view,
        chartFieldId: table.fields[0]?.id || "",
        chartValueFieldId: "",
        chartAggregation: "count",
        chartTopN: current.view.chartTopN || 12,
        chartSort: current.view.chartSort || "value-desc",
        chartShowLegend: current.view.chartShowLegend ?? true,
        chartShowValues: current.view.chartShowValues ?? true,
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
      const dashboard: DashboardDefinition = {
        id: uid("dashboard"),
        type: "dashboard",
        name: createDraft.name.trim() || "New Dashboard",
        description: createDraft.description.trim(),
        folder: "Custom",
        category: "Dashboard",
        tags: [],
        updatedAt: new Date().toISOString(),
        runtimeFilters: [],
        tabs: [{ id: uid("tab"), name: "Overview", widgets: [] }]
      };
      applyDocumentUpdate((draft) => {
        draft.bundle.objects[dashboard.id] = dashboard;
        draft.bundle.order.unshift(dashboard.id);
      });
      setCreateModalOpen(false);
      navigate(`/studio/${dashboard.id}`);
      pushToast("Dashboard created.");
      return;
    }

    const table = bundle.tables.find((item) => item.id === createDraft.tableId) || bundle.tables[0];
    if (!table) {
      pushToast("Load or configure a source table first.", "warn");
      return;
    }
    if (!createDraft.selectedFieldIds.length) {
      pushToast("Pick at least one field for the new report.", "warn");
      return;
    }
    const existingReport = editingReportId ? (bundle.objects[editingReportId] as ReportDefinition | undefined) : undefined;
    const report: ReportDefinition = {
      id: existingReport?.id || uid("report"),
      type: "report",
      name: createDraft.name.trim() || "New Report",
      description: createDraft.description.trim(),
      folder: existingReport?.folder || "Custom",
      category: existingReport?.category || "Reporting",
      tags: existingReport?.tags || [],
      updatedAt: new Date().toISOString(),
      sourceTableId: table.id,
      selectedFieldIds: createDraft.selectedFieldIds,
      filters: clone(createDraft.filters),
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
    navigate(`/studio/${report.id}`);
    pushToast(existingReport ? "Report updated." : "Report created.");
  }

  function cloneObject(object: StudioObject) {
    const copy = clone(object);
    copy.id = uid(object.type);
    copy.name = `${object.name} Copy`;
    copy.updatedAt = new Date().toISOString();
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[copy.id] = copy;
      draft.bundle.order.unshift(copy.id);
    });
    navigate(`/studio/${copy.id}`);
    pushToast("Object cloned.");
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
    navigate(`/studio/${nextDocument.bundle.order[0] || ""}`);
    pushToast("Object removed.", "warn");
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
      setDocumentState(normalizeStudioDocument(response.document));
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
    await persistRemote(documentState);
  }

  async function reloadRemote() {
    try {
      const response = await fetchStudioDocument();
      setDocumentState(normalizeStudioDocument(response.document));
      setHistory([]);
      setFuture([]);
      pushToast("Reloaded hosted studio.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Reload failed.", "danger");
    }
  }

  async function loadQuickbaseMetadata(silent = false) {
    setQuickbaseSchemaLoading(true);
    try {
      const response = await fetchQuickbaseSchema(documentState.quickbase);
      setQuickbaseSchema(response.schema);
      const nextTables = convertQuickbaseSchemaToTables(response.schema);
      const detected = detectQuickbaseStorageConfig(response.schema);
      applyDocumentUpdate((draft) => {
        draft.bundle.app.id = response.schema.id || draft.bundle.app.id;
        draft.bundle.app.name = response.schema.name || draft.bundle.app.name;
        draft.bundle.tables = nextTables;
        draft.bundle.data = {
          ...draft.bundle.data,
          ...Object.fromEntries(nextTables.map((table) => [table.id, draft.bundle.data[table.id] || []]))
        };
        Object.entries(detected).forEach(([key, value]) => {
          if (!value) return;
          const typedKey = key as keyof StudioDocument["quickbase"];
          if (!draft.quickbase[typedKey]) {
            draft.quickbase[typedKey] = value as never;
          }
        });
      });
      if (!silent) {
        pushToast(`Loaded ${response.schema.tables.length} Quickbase tables and updated the report builder.`);
      }
      return response.schema;
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Quickbase schema lookup failed.", "danger");
      return null;
    } finally {
      setQuickbaseSchemaLoading(false);
    }
  }

  function updateQuickbaseField(field: keyof StudioDocument["quickbase"], value: string) {
    applyDocumentUpdate((draft) => {
      draft.quickbase[field] = value as never;
    });
  }

  function autoDetectQuickbaseMappings() {
    if (!quickbaseSchema) return;
    const detected = detectQuickbaseStorageConfig(quickbaseSchema);
    applyDocumentUpdate((draft) => {
      Object.entries(detected).forEach(([key, value]) => {
        const typedKey = key as keyof StudioDocument["quickbase"];
        draft.quickbase[typedKey] = String(value || "");
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
    navigate(`/studio/${object.id}`);
    pushToast("Template applied.");
  }

  function handleImportJson(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    file.text().then((text) => {
      const parsed = JSON.parse(text);
      if (parsed?.bundle && parsed?.templates) {
        setDocumentState(normalizeStudioDocument(parsed as StudioDocument));
        pushToast("Studio document imported.");
      } else if (parsed?.type === "report" || parsed?.type === "dashboard") {
        const object = parsed as StudioObject;
        object.id = uid(object.type);
        object.updatedAt = new Date().toISOString();
        applyDocumentUpdate((draft) => {
          draft.bundle.objects[object.id] = object;
          draft.bundle.order.unshift(object.id);
        });
        navigate(`/studio/${object.id}`);
        pushToast("Object imported.");
      } else {
        pushToast("Unsupported JSON import payload.", "danger");
      }
      if (event.target) event.target.value = "";
    }).catch((error) => {
      pushToast(error instanceof Error ? error.message : "Import failed.", "danger");
    });
  }

  function exportJson() {
    downloadFile("studio-document.json", JSON.stringify(documentState, null, 2));
    applyDocumentUpdate((draft) => {
      draft.exportJobs.unshift({
        id: uid("job"),
        objectId: activeObject?.id || "studio",
        format: "json",
        status: "complete",
        createdAt: new Date().toISOString()
      });
    }, { skipHistory: true });
    pushToast("Studio JSON exported.");
  }

  async function exportWorkbook() {
    if (activeReport && activeTable && reportResult) {
      const response = await startReportExportJob({
        reportId: activeReport.id,
        report: activeReport,
        table: activeTable
      });
      setExportJob(response.job);
      setDownloadedJobId("");
    } else if (activeDashboard && dashboardResult) {
      const response = await startDashboardExportJob({
        dashboardId: activeDashboard.id,
        runtimeFilters: runtimeValues
      });
      setExportJob(response.job);
      setDownloadedJobId("");
    } else {
      pushToast("Open a report or dashboard before exporting.", "warn");
      return;
    }
    applyDocumentUpdate((draft) => {
      draft.exportJobs.unshift({
        id: uid("job"),
        objectId: activeObject?.id || "studio",
        format: "xlsx",
        status: "complete",
        createdAt: new Date().toISOString()
      });
    }, { skipHistory: true });
    pushToast("Workbook export started.");
  }

  if (!activeObject) {
    return <div className="empty-page">No saved reports or dashboards are available yet.</div>;
  }

  const defaultUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/${activeObject.type}/${activeObject.id}`;
  const viewerUrl = `${window.location.origin}${import.meta.env.BASE_URL}?mode=viewer#/${activeObject.type}/${activeObject.id}`;
  const embedUrl = `${window.location.origin}${import.meta.env.BASE_URL}?embed=1&mode=viewer#/${activeObject.type}/${activeObject.id}`;

  return (
    <section className={`studio-page ${activeDashboard ? "studio-page-dashboard" : "studio-page-report"}`}>
      <aside className="studio-library">
        <div className="surface stack">
          <div className="studio-section-head">
            <div>
              <div className="eyebrow">{documentState.branding.homeLabel}</div>
              <h2>{documentState.branding.navigationLabel}</h2>
            </div>
            <div className="studio-actions">
              <button onClick={() => openCreateModal("report")}>New report</button>
              <button onClick={() => openCreateModal("dashboard")}>New dashboard</button>
            </div>
          </div>
          <label className="field">
            <span>Search</span>
            <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Search reports, dashboards, fields, tags" />
          </label>
          <div className="filter-grid compact-grid">
            <label className="field">
              <span>Type</span>
              <select value={libraryFilter} onChange={(event) => setLibraryFilter(event.target.value as LibraryFilter)}>
                <option value="all">All</option>
                <option value="report">Reports</option>
                <option value="dashboard">Dashboards</option>
              </select>
            </label>
            <label className="toggle-row"><input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} /> Favorites</label>
            <label className="toggle-row"><input type="checkbox" checked={recentOnly} onChange={(event) => setRecentOnly(event.target.checked)} /> Recent</label>
          </div>
          <div className="nav-list">
            {filteredObjects.map((object) => (
              <Link key={object.id} className={`nav-card ${object.id === activeObject.id ? "active-card" : ""}`} to={`/studio/${object.id}`}>
                <span className="badge">{typeLabel(object.type)}</span>
                <strong>{object.name}</strong>
                <span className="micro">{object.folder} · {object.category}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="surface stack">
          <div className="card-head">
            <strong>Platform Settings</strong>
            <button onClick={() => setDrawer("settings")}>Open</button>
          </div>
          <div className="micro">
            Set your platform name, Quickbase realm, app ID, table IDs, and field IDs here.
          </div>
          <div className="summary-grid">
            <div className="summary-card">
              <strong>{documentState.quickbase.realmHostname || "Not set"}</strong>
              <span>Realm</span>
            </div>
            <div className="summary-card">
              <strong>{documentState.quickbase.appId || "Not set"}</strong>
              <span>App ID</span>
            </div>
          </div>
          <div className="studio-actions">
              <button onClick={() => { void loadQuickbaseMetadata(); }} disabled={quickbaseSchemaLoading}>
              {quickbaseSchemaLoading ? "Loading Quickbase schema…" : "Load table and field IDs"}
            </button>
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to server"}</button>
          </div>
          {quickbaseSchema ? (
            <div className="card">
              <div className="card-head">
                <strong>{quickbaseSchema.name}</strong>
                <span className="micro">{quickbaseSchema.tables.length} tables</span>
              </div>
              <div className="micro">{quickbaseSchema.description || "Quickbase schema loaded."}</div>
            </div>
          ) : null}
        </div>

        <div className="surface stack">
          <div className="card-head">
            <strong>Templates</strong>
            <button onClick={() => setDrawer("templates")}>Manage</button>
          </div>
          <div className="template-list">
            {[...documentState.templates.layouts, ...documentState.templates.yaml].slice(0, 4).map((template) => (
              <button className="template-card-button" key={template.id} onClick={() => applyTemplate(template)}>
                <strong>{template.name}</strong>
                <span>{template.type}</span>
              </button>
            ))}
          </div>
          <button onClick={() => importInputRef.current?.click()}>Import JSON</button>
          <input ref={importInputRef} hidden type="file" accept="application/json" onChange={handleImportJson} />
        </div>
      </aside>

      <div className="studio-canvas">
        <div className="hero studio-hero">
          <div>
            <span className="badge brand">{typeLabel(activeObject.type)}</span>
            <h1>{activeObject.name}</h1>
            <p>{activeObject.description || "Build, save, share, and export reports and dashboards from one workspace."}</p>
            <div className="micro-row">
              <span>{loadingRemote ? "Loading saved workspace…" : "Saved workspace loaded"}</span>
              <span>{documentState.sync.lastSavedAt ? `Last saved ${new Date(documentState.sync.lastSavedAt).toLocaleString()}` : "Not saved yet"}</span>
            </div>
          </div>
          <div className="link-toolbar">
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
            {activeReport ? <button onClick={() => openEditReportModal(activeReport)}>Edit report</button> : null}
            {activeReport ? <button onClick={() => deleteObject(activeReport.id)}>Delete report</button> : null}
            <button onClick={() => toggleFavorite(activeObject.id)}>{documentState.favorites.includes(activeObject.id) ? "Unfavorite" : "Favorite"}</button>
            <button onClick={() => cloneObject(activeObject)}>Clone</button>
            <button onClick={undo} disabled={!history.length}>Undo</button>
            <button onClick={redo} disabled={!future.length}>Redo</button>
            <button onClick={() => setDrawer("share")}>Share</button>
            <button onClick={() => setDrawer("settings")}>Settings</button>
            <button onClick={() => setDrawer("export")}>Export</button>
            <button onClick={openVersions}>History</button>
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

        {activeReport && activeTable && (reportResult || liveReportLoading) ? (
          <section className="surface stack">
            <div className="card-head">
              <strong>Report Preview</strong>
              <span className="micro">
                {liveReportLoading && !reportResult ? "Loading live Quickbase data…" : `${reportResult?.totalRows || 0} rows · ${activeTable.name}`}
              </span>
            </div>
            {reportResult ? (
              <>
                <div className="summary-grid">
                  {reportResult.summary.map((item) => (
                    <div className="summary-card" key={item.label}>
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <ReportPreview report={activeReport} table={activeTable} result={reportResult} />
              </>
            ) : (
              <div className="empty-hint">Loading live Quickbase rows for this report.</div>
            )}
          </section>
        ) : null}

        {activeDashboard && dashboardResult ? (
          <section className="surface stack">
                <div className="card-head">
                  <strong>Dashboard Preview</strong>
                  <span className="micro">{activeDashboard.tabs.length} tabs</span>
                </div>
                <div className="filter-grid compact-grid">
                  <label className="field">
                    <span>Card search</span>
                    <input value={widgetSearch} onChange={(event) => setWidgetSearch(event.target.value)} placeholder="Find cards or reports" />
                  </label>
                </div>
            <div className="studio-tab-strip">
              {activeDashboard.tabs.map((tab) => (
                <button key={tab.id} className={tab.id === activeTabId ? "active-tab" : ""} onClick={() => setActiveTabId(tab.id)}>{tab.name}</button>
              ))}
            </div>
            <DashboardPreview
              dashboard={{ ...activeDashboard, tabs: activeDashboard.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
              result={{ ...dashboardResult, tabs: dashboardResult.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
              tables={bundle.tables}
              runtimeValues={runtimeValues}
              setRuntimeValues={setRuntimeValues}
              widgetSearch={widgetSearch}
              draggingWidget={draggingWidget}
              onOpenReport={(reportId) => navigate(`/studio/${reportId}`)}
              onStartWidgetDrag={(tabId, widgetId) => setDraggingWidget({ tabId, widgetId })}
              onEndWidgetDrag={() => setDraggingWidget(null)}
              onDropWidget={(tabId, widgetId) => {
                if (draggingWidget?.tabId === tabId) {
                  reorderDashboardWidget(tabId, draggingWidget.widgetId, widgetId);
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
                <div className="stack-compact">
                  {activeDashboard.tabs.map((tab, tabIndex) => (
                    <div className="card" key={tab.id}>
                      <div className="card-head">
                        <strong>{tab.name}</strong>
                        <div className="studio-actions">
                          <button onClick={() => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.filter((item) => item.id !== tab.id) })}>Remove</button>
                          <button
                            disabled={tabIndex === 0}
                            onClick={() => {
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
                      <label className="field"><span>Tab name</span><input value={tab.name} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, name: event.target.value } : item) })} /></label>
                      <div className="stack-compact">
                        {tab.widgets.filter((widget) => !widgetSearch || `${widget.title} ${widget.reportId}`.toLowerCase().includes(widgetSearch.toLowerCase())).map((widget) => (
                          <div className="widget-edit-card" key={widget.id}>
                            <label className="field"><span>Title</span><input value={widget.title} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, title: event.target.value }))} /></label>
                            <div className="widget-editor-grid">
                              <label className="field">
                                <span>Report</span>
                                <select value={widget.reportId} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, reportId: event.target.value, snapshot: undefined, mode: "linked" }))}>{objects.filter((object): object is ReportDefinition => object.type === "report").map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}</select>
                              </label>
                              <label className="field">
                                <span>Connection</span>
                                <select value={widget.mode} onChange={(event) => {
                                  const report = bundle.objects[widget.reportId] as ReportDefinition | undefined;
                                  updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({
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
                                <select value={widget.displayMode} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, displayMode: event.target.value as "inherit" | "table" | "summary" | "chart" }))}>
                                  <option value="inherit">Inherit report view</option>
                                  <option value="table">Table only</option>
                                  <option value="summary">Summary only</option>
                                  <option value="chart">Chart/graph</option>
                                </select>
                              </label>
                              <label className="toggle-row"><input type="checkbox" checked={widget.showSummary} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, showSummary: event.target.checked }))} /> Show summary</label>
                              <label className="toggle-row"><input type="checkbox" checked={widget.showDetails} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, showDetails: event.target.checked }))} /> Show details</label>
                              <label className="toggle-row"><input type="checkbox" checked={clampWidgetWidth(widget.layout.w) >= 12} onChange={() => toggleDashboardWidgetFullWidth(tab.id, widget.id)} /> Full width</label>
                              <label className="field-inline"><span>Width</span><input type="number" min="1" max="12" value={widget.layout.w} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, layout: { ...candidate.layout, w: clampWidgetWidth(Number(event.target.value)) } }))} /></label>
                              <label className="field-inline"><span>Height</span><input type="number" min="2" max="10" value={widget.layout.h} onChange={(event) => updateActiveDashboardWidget(tab.id, widget.id, (candidate) => ({ ...candidate, layout: { ...candidate.layout, h: clampWidgetHeight(Number(event.target.value)) } }))} /></label>
                            </div>
                            <div className="widget-edit-actions">
                              <button onClick={() => moveDashboardWidget(tab.id, widget.id, -1)}>Move up</button>
                              <button onClick={() => moveDashboardWidget(tab.id, widget.id, 1)}>Move down</button>
                              <button onClick={() => toggleDashboardWidgetFullWidth(tab.id, widget.id)}>
                                {clampWidgetWidth(widget.layout.w) >= 12 ? "Restore width" : "Make full width"}
                              </button>
                              <button onClick={() => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.filter((candidate) => candidate.id !== widget.id) } : item) })}>Remove card</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => {
                        const report = objects.find((object): object is ReportDefinition => object.type === "report");
                        if (!report) return;
                        updateObject({
                          ...activeDashboard,
                          tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: [...item.widgets, { id: uid("widget"), title: report.name, mode: "linked", displayMode: "inherit", showDetails: false, showSummary: true, reportId: report.id, layout: { w: 6, h: 4 } }] } : item)
                        });
                      }}>Add card</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeDashboard, tabs: [...activeDashboard.tabs, { id: uid("tab"), name: `Tab ${activeDashboard.tabs.length + 1}`, widgets: [] }] })}>Add tab</button>
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
                      <label className="field"><span>Field</span><select value={filter.fieldId} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, fieldId: event.target.value } : item) })}>{bundle.tables.flatMap((table) => table.fields.map((field) => <option key={`${table.id}-${field.id}`} value={field.id}>{table.name} · {field.label}</option>))}</select></label>
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
            <Link className="nav-card" to={`/${activeObject.type}/${activeObject.id}`}>
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
              <div className="filter-grid compact-grid">
                <label className="field">
                  <span>Type</span>
                  <select value={createDraft.type} onChange={(event) => setCreateDraft(buildCreateDraft(bundle.tables[0] || null, event.target.value as CreateModalType))}>
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

              {createDraft.type === "report" && createDraftTable ? (
                <>
                  <div className="card">
                    <div className="card-head">
                      <strong>Source table</strong>
                      <span className="micro">Pick the Quickbase table first, then choose fields and report behavior.</span>
                    </div>
                    <label className="field">
                      <span>Table</span>
                      <select value={createDraft.tableId} onChange={(event) => updateCreateDraftTable(event.target.value)}>
                        {bundle.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
                      </select>
                    </label>
                  </div>

                  <div className="card">
                    <div className="card-head">
                      <strong>Fields</strong>
                      <span className="micro">{createDraft.selectedFieldIds.length} selected</span>
                    </div>
                    <label className="field">
                      <span>Find fields</span>
                      <input value={createFieldQuery} onChange={(event) => setCreateFieldQuery(event.target.value)} placeholder="Search field name, FID, or type" />
                    </label>
                    <div className="picker-list modal-picker-list">
                      {visibleCreateFields.map((field) => (
                        <label className="picker-row" key={field.id}>
                          <input
                            type="checkbox"
                            checked={createDraft.selectedFieldIds.includes(field.id)}
                            onChange={(event) => setCreateDraft((current) => ({
                              ...current,
                              selectedFieldIds: event.target.checked
                                ? [...current.selectedFieldIds, field.id]
                                : current.selectedFieldIds.filter((item) => item !== field.id)
                            }))}
                          />
                          <span>{field.label}</span>
                          <em>FID {field.id} · {field.type}</em>
                        </label>
                      ))}
                      {!visibleCreateFields.length ? <div className="empty-hint">No matching fields.</div> : null}
                    </div>
                  </div>

                  <div className="card">
                    <div className="card-head">
                      <strong>Display labels</strong>
                      <span className="micro">Override field headers and chart labels for client-facing names.</span>
                    </div>
                    <div className="stack-compact">
                      {createDraft.selectedFieldIds.length ? createDraft.selectedFieldIds.map((fieldId) => {
                        const field = createDraftTable.fields.find((item) => item.id === fieldId);
                        if (!field) return null;
                        return (
                          <label className="field" key={fieldId}>
                            <span>{field.label}</span>
                            <input
                              value={createDraft.displayLabels.fields[fieldId] || ""}
                              onChange={(event) => setCreateDraft((current) => ({
                                ...current,
                                displayLabels: {
                                  ...current.displayLabels,
                                  fields: {
                                    ...current.displayLabels.fields,
                                    [fieldId]: event.target.value
                                  }
                                }
                              }))}
                              placeholder={`Use "${field.label}"`}
                            />
                          </label>
                        );
                      }) : <div className="empty-hint">Select fields first to set custom headers.</div>}
                    </div>
                    {createDraft.view.mode === "chart" ? (
                      <div className="stack-compact">
                        <div className="micro">Chart value labels</div>
                        {chartValueLabelOptions.length ? chartValueLabelOptions.map((label) => (
                          <label className="field" key={label}>
                            <span>{label}</span>
                            <input
                              value={createDraft.displayLabels.chartValues[label] || ""}
                              onChange={(event) => setCreateDraft((current) => ({
                                ...current,
                                displayLabels: {
                                  ...current.displayLabels,
                                  chartValues: {
                                    ...current.displayLabels.chartValues,
                                    [label]: event.target.value
                                  }
                                }
                              }))}
                              placeholder={`Use "${label}"`}
                            />
                          </label>
                        )) : <div className="empty-hint">Chart value overrides will appear once the chart has labels to rename.</div>}
                      </div>
                    ) : null}
                  </div>

                  <ReportFiltersAndSortsEditor
                    table={createDraftTable}
                    filters={createDraft.filters}
                    sorts={createDraft.sorts}
                    onChangeFilters={(filters) => setCreateDraft((current) => ({ ...current, filters }))}
                    onChangeSorts={(sorts) => setCreateDraft((current) => ({ ...current, sorts }))}
                  />

                  <div className="card">
                    <div className="card-head">
                      <strong>View</strong>
                      <span className="micro">Choose how the report should render by default.</span>
                    </div>
                    <div className="filter-grid">
                      <label className="field"><span>Mode</span><select value={createDraft.view.mode} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, mode: event.target.value as ReportViewMode } }))}>{REPORT_VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                      <label className="field"><span>Chart type</span><select value={createDraft.view.chartType} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartType: event.target.value as ChartType } }))}>{CHART_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                      <label className="field"><span>Chart field</span><select value={createDraft.view.chartFieldId} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartFieldId: event.target.value } }))}>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                      <label className="field"><span>Title field</span><select value={createDraft.view.titleFieldId} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, titleFieldId: event.target.value } }))}>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                      {createDraft.view.mode === "chart" ? (
                        <>
                          <label className="field"><span>Value field</span><select value={createDraft.view.chartValueFieldId} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartValueFieldId: event.target.value } }))}><option value="">Count rows</option>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                          <label className="field"><span>Aggregation</span><select value={createDraft.view.chartAggregation} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartAggregation: event.target.value as ChartAggregation, chartValueFieldId: event.target.value === "count" ? "" : current.view.chartValueFieldId } }))}>{CHART_AGGREGATION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                          <label className="field"><span>Chart sort</span><select value={createDraft.view.chartSort} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartSort: event.target.value as ChartSortMode } }))}>{CHART_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                          <label className="field"><span>Top results</span><input type="number" min="0" value={createDraft.view.chartTopN} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartTopN: Math.max(0, Number(event.target.value) || 0) } }))} /></label>
                          <label className="toggle-row"><input type="checkbox" checked={createDraft.view.chartShowLegend} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartShowLegend: event.target.checked } }))} /> Show legend</label>
                          <label className="toggle-row"><input type="checkbox" checked={createDraft.view.chartShowValues} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, chartShowValues: event.target.checked } }))} /> Show values</label>
                        </>
                      ) : null}
                      {createDraft.view.mode === "kanban" ? <label className="field"><span>Kanban field</span><select value={createDraft.view.kanbanField} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, kanbanField: event.target.value } }))}><option value="">Select a field</option>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label> : null}
                      {createDraft.view.mode === "timeline" ? (
                        <>
                          <label className="field"><span>Timeline start</span><select value={createDraft.view.timelineDateField} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, timelineDateField: event.target.value } }))}><option value="">Select a field</option>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                          <label className="field"><span>Timeline end</span><select value={createDraft.view.timelineEndField} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, timelineEndField: event.target.value } }))}><option value="">Select a field</option>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                        </>
                      ) : null}
                      {createDraft.view.mode === "calendar" ? <label className="field"><span>Calendar date</span><select value={createDraft.view.calendarDateField} onChange={(event) => setCreateDraft((current) => ({ ...current, view: { ...current.view, calendarDateField: event.target.value } }))}><option value="">Select a field</option>{createDraftTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label> : null}
                    </div>
                  </div>
                </>
              ) : null}

              <div className="studio-actions modal-actions">
                <button onClick={createFromDraft}>
                  {editingReportId ? "Save report" : createDraft.type === "report" ? "Create report" : "Create dashboard"}
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {drawer ? (
        <div className="studio-drawer-backdrop" onClick={() => setDrawer(null)}>
          <section className="studio-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="card-head">
              <strong>{drawer === "settings" ? "Settings" : drawer === "share" ? "Share" : drawer === "templates" ? "Templates" : drawer === "export" ? "Export" : "History"}</strong>
              <button onClick={() => setDrawer(null)}>Close</button>
            </div>

            {drawer === "settings" ? (
              <div className="stack">
                <div className="summary-grid">
                  <div className="summary-card"><strong>{documentState.sync.providerMode === "api" ? "Connected" : "Local draft"}</strong><span>Connection</span></div>
                  <div className="summary-card"><strong>{documentState.sync.lastLoadedAt ? new Date(documentState.sync.lastLoadedAt).toLocaleTimeString() : "n/a"}</strong><span>Last load</span></div>
                  <div className="summary-card"><strong>{documentState.sync.lastSavedAt ? new Date(documentState.sync.lastSavedAt).toLocaleTimeString() : "n/a"}</strong><span>Last save</span></div>
                </div>
                <label className="field">
                  <span>Platform name</span>
                  <input value={documentState.branding.platformName} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.platformName = event.target.value; })} />
                </label>
                <label className="field">
                  <span>Navigation label</span>
                  <input value={documentState.branding.navigationLabel} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.navigationLabel = event.target.value; })} />
                </label>
                <label className="field">
                  <span>Home label</span>
                  <input value={documentState.branding.homeLabel} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.homeLabel = event.target.value; })} />
                </label>
                <div className="card">
                  <div className="card-head">
                    <strong>Quickbase Connection</strong>
                    <span className="micro">Enter the values needed for your live setup.</span>
                  </div>
                  <label className="field">
                    <span>Realm hostname</span>
                    <input value={documentState.quickbase.realmHostname} onChange={(event) => updateQuickbaseField("realmHostname", event.target.value)} placeholder="yourrealm.quickbase.com" />
                  </label>
                  <label className="field">
                    <span>User token</span>
                    <input value={documentState.quickbase.userToken} onChange={(event) => updateQuickbaseField("userToken", event.target.value)} placeholder="QB-USER-TOKEN ..." />
                  </label>
                  <label className="field">
                    <span>App token</span>
                    <input value={documentState.quickbase.appToken} onChange={(event) => updateQuickbaseField("appToken", event.target.value)} placeholder="Optional app token" />
                  </label>
                  <label className="field">
                    <span>App ID</span>
                    <input value={documentState.quickbase.appId} onChange={(event) => updateQuickbaseField("appId", event.target.value)} placeholder="App DBID" />
                  </label>
                  <label className="field">
                    <span>API base URL</span>
                    <input value={documentState.quickbase.apiBaseUrl} onChange={(event) => updateQuickbaseField("apiBaseUrl", event.target.value)} placeholder="https://api.quickbase.com/v1" />
                  </label>
                </div>
                <div className="studio-actions">
                  <button onClick={() => { void loadQuickbaseMetadata(); }} disabled={quickbaseSchemaLoading}>
                    {quickbaseSchemaLoading ? "Loading Quickbase schema…" : "Load table and field IDs"}
                  </button>
                  {quickbaseSchema ? <button onClick={autoDetectQuickbaseMappings}>Auto-detect storage fields</button> : null}
                  <button onClick={reloadRemote}>Load from server</button>
                  <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to Quickbase and server"}</button>
                </div>
                {lastQuickbaseSync ? (
                  <div className={`sync-status ${lastQuickbaseSync.ok ? "sync-status-ok" : "sync-status-warn"}`}>
                    <strong>{lastQuickbaseSync.ok ? "Quickbase save succeeded" : "Quickbase save needs attention"}</strong>
                    <span>{lastQuickbaseSync.message}</span>
                    <span>
                      {lastQuickbaseSync.savedObjects} saved reports or dashboards · {lastQuickbaseSync.savedSettings} user settings rows · {lastQuickbaseSync.savedVersions} version rows
                    </span>
                  </div>
                ) : null}
                {quickbaseSchema ? (
                  <div className="card">
                    <div className="card-head">
                      <strong>{quickbaseSchema.name}</strong>
                      <span className="micro">{quickbaseSchema.tables.length} tables loaded</span>
                    </div>
                    <div className="micro">The schema is loaded for reference and auto-detection, but the storage setup below uses direct DBID and FID inputs like the original single-page builder.</div>
                  </div>
                ) : null}
                <div className="card">
                  <div className="card-head">
                    <strong>Saved reports and dashboards</strong>
                    <span className="micro">Type the DBID and field FIDs for the table that stores report and dashboard definitions.</span>
                  </div>
                  <label className="field"><span>Table DBID</span><input value={documentState.quickbase.objectTableId} onChange={(event) => updateQuickbaseField("objectTableId", event.target.value)} placeholder="Table DBID for saved reports and dashboards" /></label>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Item key field FID</span><input value={documentState.quickbase.objectKeyFieldId} onChange={(event) => updateQuickbaseField("objectKeyFieldId", event.target.value)} placeholder="FID" /></label>
                    <label className="field"><span>Type field FID</span><input value={documentState.quickbase.objectTypeFieldId} onChange={(event) => updateQuickbaseField("objectTypeFieldId", event.target.value)} placeholder="FID" /></label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Name field FID</span><input value={documentState.quickbase.objectNameFieldId} onChange={(event) => updateQuickbaseField("objectNameFieldId", event.target.value)} placeholder="FID" /></label>
                    <label className="field"><span>JSON field FID</span><input value={documentState.quickbase.objectConfigFieldId} onChange={(event) => updateQuickbaseField("objectConfigFieldId", event.target.value)} placeholder="FID" /></label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Owner field FID</span><input value={documentState.quickbase.objectOwnerFieldId} onChange={(event) => updateQuickbaseField("objectOwnerFieldId", event.target.value)} placeholder="Optional FID" /></label>
                    <label className="field"><span>Updated at field FID</span><input value={documentState.quickbase.objectUpdatedAtFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedAtFieldId", event.target.value)} placeholder="Optional FID" /></label>
                  </div>
                  <label className="field"><span>Updated by field FID</span><input value={documentState.quickbase.objectUpdatedByFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
                </div>
                <div className="card">
                  <div className="card-head">
                    <strong>User settings</strong>
                    <span className="micro">Type the DBID and field FIDs for the table that stores per-user settings and storage configuration.</span>
                  </div>
                  <label className="field"><span>Table DBID</span><input value={documentState.quickbase.settingsTableId} onChange={(event) => updateQuickbaseField("settingsTableId", event.target.value)} placeholder="Table DBID for user settings" /></label>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>User field FID</span><input value={documentState.quickbase.settingsUserFieldId} onChange={(event) => updateQuickbaseField("settingsUserFieldId", event.target.value)} placeholder="FID" /></label>
                    <label className="field"><span>Object record field FID</span><input value={documentState.quickbase.settingsObjectFieldId} onChange={(event) => updateQuickbaseField("settingsObjectFieldId", event.target.value)} placeholder="Optional FID" /></label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Object key field FID</span><input value={documentState.quickbase.settingsObjectKeyFieldId} onChange={(event) => updateQuickbaseField("settingsObjectKeyFieldId", event.target.value)} placeholder="FID" /></label>
                    <label className="field"><span>Updated by field FID</span><input value={documentState.quickbase.settingsUpdatedByFieldId} onChange={(event) => updateQuickbaseField("settingsUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
                  </div>
                  <label className="field"><span>Settings JSON field FID</span><input value={documentState.quickbase.settingsJsonFieldId} onChange={(event) => updateQuickbaseField("settingsJsonFieldId", event.target.value)} placeholder="FID" /></label>
                </div>
                <div className="card">
                  <div className="card-head">
                    <strong>Version history</strong>
                    <span className="micro">Type the DBID and field FIDs for the table that stores version history and snapshots.</span>
                  </div>
                  <label className="field"><span>Table DBID</span><input value={documentState.quickbase.versionTableId} onChange={(event) => updateQuickbaseField("versionTableId", event.target.value)} placeholder="Table DBID for version history" /></label>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Object record field FID</span><input value={documentState.quickbase.versionObjectFieldId} onChange={(event) => updateQuickbaseField("versionObjectFieldId", event.target.value)} placeholder="Optional FID" /></label>
                    <label className="field"><span>Object key field FID</span><input value={documentState.quickbase.versionObjectKeyFieldId} onChange={(event) => updateQuickbaseField("versionObjectKeyFieldId", event.target.value)} placeholder="FID" /></label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Snapshot JSON field FID</span><input value={documentState.quickbase.versionSnapshotFieldId} onChange={(event) => updateQuickbaseField("versionSnapshotFieldId", event.target.value)} placeholder="FID" /></label>
                    <label className="field"><span>Changed at field FID</span><input value={documentState.quickbase.versionChangedAtFieldId} onChange={(event) => updateQuickbaseField("versionChangedAtFieldId", event.target.value)} placeholder="FID" /></label>
                  </div>
                  <div className="filter-grid compact-grid">
                    <label className="field"><span>Changed by field FID</span><input value={documentState.quickbase.versionChangedByFieldId} onChange={(event) => updateQuickbaseField("versionChangedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
                    <label className="field"><span>Updated by field FID</span><input value={documentState.quickbase.versionUpdatedByFieldId} onChange={(event) => updateQuickbaseField("versionUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
                  </div>
                </div>
              </div>
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
                </div>
                <div className="stack-compact">
                  {documentState.exportJobs.map((job) => (
                    <div className="card" key={job.id}>
                      <div className="card-head">
                        <strong>{bundle.objects[job.objectId]?.name || job.objectId}</strong>
                        <span className="micro">{job.format}</span>
                      </div>
                      <div className="micro">{new Date(job.createdAt).toLocaleString()}</div>
                    </div>
                  ))}
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
  );
}
