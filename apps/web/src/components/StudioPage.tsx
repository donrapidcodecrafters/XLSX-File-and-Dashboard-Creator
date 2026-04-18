import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  buildDashboardFilters,
  buildDashboardResult,
  buildSeedBundle,
  runReport,
  type ChartType,
  type DashboardDefinition,
  type DashboardRunResult,
  type DataRow,
  type FilterDefinition,
  type ReportDefinition,
  type ReportRunResult,
  type ReportViewMode,
  type SeedBundle,
  type StudioObject,
  type SummaryMetric,
  type TableDefinition
} from "@studio/shared";

const STORAGE_KEY = "hosted-reporting-studio-v1";
const REPORT_VIEW_OPTIONS: ReportViewMode[] = ["table", "summary", "chart", "timeline", "calendar", "kanban"];
const CHART_OPTIONS: ChartType[] = ["bar", "column", "line", "area", "donut", "pie", "stacked-bar", "stacked-column", "funnel", "heatmap"];

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadStudio(): SeedBundle {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return buildSeedBundle();
    return JSON.parse(raw) as SeedBundle;
  } catch {
    return buildSeedBundle();
  }
}

function saveStudio(bundle: SeedBundle) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(bundle));
}

function createReportDraft(table: TableDefinition): ReportDefinition {
  return {
    id: uid("report"),
    type: "report",
    name: "New Report",
    description: "Hosted report definition.",
    folder: "Custom",
    category: "Reporting",
    tags: [],
    updatedAt: new Date().toISOString(),
    sourceTableId: table.id,
    selectedFieldIds: table.fields.slice(0, 6).map((field) => field.id),
    filters: [],
    groups: [],
    sorts: [],
    summaryMetrics: [{ id: uid("metric"), fieldId: table.fields[0]?.id || "recordId", op: "count", label: "Rows" }],
    view: {
      mode: "table",
      chartType: "bar",
      chartFieldId: table.fields[0]?.id || "",
      timelineDateField: "",
      timelineEndField: "",
      calendarDateField: "",
      kanbanField: "",
      titleFieldId: table.fields[1]?.id || table.fields[0]?.id || ""
    }
  };
}

function createDashboardDraft(): DashboardDefinition {
  return {
    id: uid("dashboard"),
    type: "dashboard",
    name: "New Dashboard",
    description: "Hosted dashboard definition.",
    folder: "Custom",
    category: "Dashboard",
    tags: [],
    updatedAt: new Date().toISOString(),
    runtimeFilters: [],
    tabs: [{ id: uid("tab"), name: "Overview", widgets: [] }]
  };
}

function metricLabel(metric: SummaryMetric) {
  return `${metric.label} · ${metric.op}`;
}

function formatCell(value: unknown) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value ?? "");
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
                {report.selectedFieldIds.map((fieldId) => <th key={fieldId}>{table.fields.find((field) => field.id === fieldId)?.label || fieldId}</th>)}
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
      <div className="studio-preview-stack">
        <div className="chart-bars">
          {result.chartData.map((datum) => (
            <div className="chart-row" key={datum.label}>
              <div className="chart-label">{datum.label}</div>
              <div className="chart-track">
                <div className="chart-fill" style={{ width: `${Math.max(10, datum.value * 24)}px` }} />
              </div>
              <div className="chart-value">{datum.value}</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (report.view.mode === "timeline" || report.view.mode === "calendar") {
    const dateFieldId = report.view.mode === "timeline" ? report.view.timelineDateField : report.view.calendarDateField;
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    return (
      <div className="studio-preview-stack">
        <div className="studio-card-grid">
          {result.rows.map((row, index) => (
            <article className="studio-mini-card" key={index}>
              <strong>{formatCell(row[titleFieldId])}</strong>
              <span>{table.fields.find((field) => field.id === dateFieldId)?.label || "Date"}: {formatCell(row[dateFieldId])}</span>
            </article>
          ))}
        </div>
      </div>
    );
  }

  if (report.view.mode === "kanban") {
    const fieldId = report.view.kanbanField || report.groups[0]?.fieldId || report.selectedFieldIds[0];
    const titleFieldId = report.view.titleFieldId || report.selectedFieldIds[0];
    const columns = new Map<string, DataRow[]>();
    result.rows.forEach((row) => {
      const key = formatCell(row[fieldId]) || "Unassigned";
      const list = columns.get(key) || [];
      list.push(row);
      columns.set(key, list);
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
                  {report.selectedFieldIds.slice(1, 4).map((fieldId) => (
                    <span key={fieldId}>{table.fields.find((field) => field.id === fieldId)?.label || fieldId}: {formatCell(row[fieldId])}</span>
                  ))}
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
            {report.selectedFieldIds.map((fieldId) => <th key={fieldId}>{table.fields.find((field) => field.id === fieldId)?.label || fieldId}</th>)}
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
  runtimeValues,
  setRuntimeValues,
  result,
  onOpenReport
}: {
  dashboard: DashboardDefinition;
  runtimeValues: Record<string, string>;
  setRuntimeValues: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  result: DashboardRunResult;
  onOpenReport: (reportId: string) => void;
}) {
  return (
    <div className="studio-preview-stack">
      {dashboard.runtimeFilters.length ? (
        <section className="card">
          <div className="card-head">
            <strong>Runtime Filters</strong>
            <span className="micro">Per-dashboard controls</span>
          </div>
          <div className="filter-grid">
            {dashboard.runtimeFilters.map((filter) => (
              <label className="field" key={filter.id}>
                <span>{filter.label}</span>
                <input
                  value={runtimeValues[filter.id] || ""}
                  onChange={(event) => setRuntimeValues((current) => ({ ...current, [filter.id]: event.target.value }))}
                />
              </label>
            ))}
          </div>
        </section>
      ) : null}

      {result.tabs.map((tab) => (
        <section className="card" key={tab.id}>
          <div className="card-head">
            <strong>{tab.name}</strong>
            <span className="micro">{tab.widgets.length} widgets</span>
          </div>
          <div className="widget-grid">
            {tab.widgets.map((widget) => (
              <article className="widget-card" key={widget.widgetId}>
                <div className="widget-head">
                  <strong>{widget.report.name}</strong>
                  <button className="link-like" onClick={() => onOpenReport(widget.report.id)}>Edit report</button>
                </div>
                <div className="widget-metrics">
                  {widget.result.summary.map((item) => (
                    <div className="mini-stat" key={item.label}>
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
                <div className="mini-chart">
                  {widget.result.chartData.slice(0, 5).map((datum) => (
                    <div className="mini-bar" key={datum.label}>
                      <span>{datum.label}</span>
                      <div className="mini-bar-fill" style={{ width: `${Math.max(12, datum.value * 22)}px` }} />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function StudioPage() {
  const navigate = useNavigate();
  const params = useParams();
  const [bundle, setBundle] = useState<SeedBundle>(() => loadStudio());
  const [libraryQuery, setLibraryQuery] = useState("");
  const [reportInspectorTab, setReportInspectorTab] = useState<"fields" | "filters" | "view" | "summary">("fields");
  const [dashboardInspectorTab, setDashboardInspectorTab] = useState<"design" | "filters">("design");
  const [activeTabId, setActiveTabId] = useState("");
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});

  useEffect(() => {
    saveStudio(bundle);
  }, [bundle]);

  const objects = useMemo(() => bundle.order.map((id) => bundle.objects[id]).filter(Boolean), [bundle]);
  const filteredObjects = useMemo(() => {
    const query = libraryQuery.trim().toLowerCase();
    if (!query) return objects;
    return objects.filter((object) => {
      return [object.name, object.description, object.folder, object.category, object.tags.join(" ")].join(" ").toLowerCase().includes(query);
    });
  }, [libraryQuery, objects]);

  const activeObjectId = params.objectId && bundle.objects[params.objectId] ? params.objectId : bundle.order[0];
  const activeObject = activeObjectId ? bundle.objects[activeObjectId] : null;
  const activeReport = activeObject?.type === "report" ? activeObject : null;
  const activeDashboard = activeObject?.type === "dashboard" ? activeObject : null;
  const activeTable = activeReport ? bundle.tables.find((table) => table.id === activeReport.sourceTableId) || bundle.tables[0] : null;

  useEffect(() => {
    if (!activeObjectId && bundle.order[0]) {
      navigate(`/studio/${bundle.order[0]}`, { replace: true });
    }
  }, [activeObjectId, bundle.order, navigate]);

  useEffect(() => {
    if (activeDashboard) {
      const nextTabId = activeDashboard.tabs[0]?.id || "";
      setActiveTabId((current) => (activeDashboard.tabs.some((tab) => tab.id === current) ? current : nextTabId));
      setRuntimeValues(Object.fromEntries(activeDashboard.runtimeFilters.map((filter) => [filter.id, filter.defaultValue || ""])));
    }
  }, [activeDashboard?.id]);

  const reportResult = useMemo(() => {
    if (!activeReport || !activeTable) return null;
    const rows = bundle.data[activeReport.sourceTableId] || [];
    return runReport(activeReport, activeTable, rows);
  }, [activeReport, activeTable, bundle.data]);

  const dashboardResult = useMemo(() => {
    if (!activeDashboard) return null;
    const widgets = activeDashboard.tabs.flatMap((tab) =>
      tab.widgets.map((widget) => {
        const report = widget.mode === "copied" && widget.snapshot ? widget.snapshot : (bundle.objects[widget.reportId] as ReportDefinition | undefined);
        if (!report) return null;
        const table = bundle.tables.find((item) => item.id === report.sourceTableId);
        if (!table) return null;
        const result = runReport(
          report,
          table,
          bundle.data[report.sourceTableId] || [],
          buildDashboardFilters(activeDashboard, report.id, runtimeValues)
        );
        return {
          widgetId: widget.id,
          report,
          result
        };
      }).filter((item): item is { widgetId: string; report: ReportDefinition; result: ReportRunResult } => Boolean(item))
    );
    return buildDashboardResult(activeDashboard, widgets);
  }, [activeDashboard, bundle, runtimeValues]);

  function updateObject(nextObject: StudioObject) {
    setBundle((current) => ({
      ...current,
      objects: {
        ...current.objects,
        [nextObject.id]: {
          ...nextObject,
          updatedAt: new Date().toISOString()
        }
      }
    }));
  }

  function cloneObject(object: StudioObject) {
    const copy = clone(object) as StudioObject;
    copy.id = uid(object.type);
    copy.name = `${object.name} Copy`;
    copy.updatedAt = new Date().toISOString();
    setBundle((current) => ({
      ...current,
      objects: { ...current.objects, [copy.id]: copy },
      order: [copy.id, ...current.order]
    }));
    navigate(`/studio/${copy.id}`);
  }

  function createReport() {
    const draft = createReportDraft(bundle.tables[0]);
    setBundle((current) => ({
      ...current,
      objects: { ...current.objects, [draft.id]: draft },
      order: [draft.id, ...current.order]
    }));
    navigate(`/studio/${draft.id}`);
  }

  function createDashboard() {
    const draft = createDashboardDraft();
    setBundle((current) => ({
      ...current,
      objects: { ...current.objects, [draft.id]: draft },
      order: [draft.id, ...current.order]
    }));
    navigate(`/studio/${draft.id}`);
  }

  function exportActiveObject() {
    if (!activeObject) return;
    downloadFile(`${activeObject.id}.json`, JSON.stringify(activeObject, null, 2));
  }

  function resetStudio() {
    const seed = buildSeedBundle();
    setBundle(seed);
    navigate(`/studio/${seed.order[0]}`);
  }

  if (!activeObject) {
    return <div className="empty-page">No studio objects available.</div>;
  }

  return (
    <section className="studio-page">
      <aside className="studio-library">
        <div className="studio-section-head">
          <div>
            <div className="eyebrow">Library</div>
            <h2>Objects</h2>
          </div>
          <div className="studio-actions">
            <button onClick={createReport}>New report</button>
            <button onClick={createDashboard}>New dashboard</button>
          </div>
        </div>
        <label className="field">
          <span>Search</span>
          <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Reports, dashboards, tags" />
        </label>
        <div className="nav-list">
          {filteredObjects.map((object) => (
            <Link key={object.id} className={`nav-card ${object.id === activeObject.id ? "active-card" : ""}`} to={`/studio/${object.id}`}>
              <span className="badge">{object.type}</span>
              <strong>{object.name}</strong>
              <span className="micro">{object.folder} · {object.category}</span>
            </Link>
          ))}
        </div>
        <div className="card">
          <div className="card-head">
            <strong>Templates</strong>
            <span className="micro">Clone from working objects</span>
          </div>
          <div className="template-list">
            {objects.slice(0, 4).map((object) => (
              <button className="template-card-button" key={object.id} onClick={() => cloneObject(object)}>
                <strong>{object.name}</strong>
                <span>{object.type} template</span>
              </button>
            ))}
          </div>
        </div>
      </aside>

      <div className="studio-canvas">
        <div className="hero studio-hero">
          <div>
            <span className="badge brand">{activeObject.type}</span>
            <h1>{activeObject.name}</h1>
            <p>{activeObject.description || "Hosted studio definition with local persistence and live previews."}</p>
          </div>
          <div className="link-toolbar">
            <button onClick={() => cloneObject(activeObject)}>Clone</button>
            <button onClick={exportActiveObject}>Export JSON</button>
            <button onClick={resetStudio}>Reset seed</button>
          </div>
        </div>

        {activeReport && activeTable && reportResult ? (
          <section className="surface stack">
            <div className="card-head">
              <strong>Preview</strong>
              <span className="micro">{reportResult.totalRows} rows · {activeTable.name}</span>
            </div>
            <div className="summary-grid">
              {reportResult.summary.map((item) => (
                <div className="summary-card" key={item.label}>
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
            <ReportPreview report={activeReport} table={activeTable} result={reportResult} />
          </section>
        ) : null}

        {activeDashboard && dashboardResult ? (
          <section className="surface stack">
            <div className="card-head">
              <strong>Dashboard Preview</strong>
              <span className="micro">{activeDashboard.tabs.length} tabs</span>
            </div>
            <div className="studio-tab-strip">
              {activeDashboard.tabs.map((tab) => (
                <button key={tab.id} className={tab.id === activeTabId ? "active-tab" : ""} onClick={() => setActiveTabId(tab.id)}>{tab.name}</button>
              ))}
            </div>
            <DashboardPreview
              dashboard={{ ...activeDashboard, tabs: activeDashboard.tabs.filter((tab) => !activeTabId || tab.id === activeTabId) }}
              runtimeValues={runtimeValues}
              setRuntimeValues={setRuntimeValues}
              result={{
                ...dashboardResult,
                tabs: dashboardResult.tabs.filter((tab) => !activeTabId || tab.id === activeTabId)
              }}
              onOpenReport={(reportId) => navigate(`/studio/${reportId}`)}
            />
          </section>
        ) : null}
      </div>

      <aside className="studio-inspector">
        {activeReport && activeTable ? (
          <div className="surface stack">
            <div className="studio-section-head">
              <div>
                <div className="eyebrow">Inspector</div>
                <h2>Report Builder</h2>
              </div>
            </div>
            <div className="studio-tab-strip">
              {["fields", "filters", "view", "summary"].map((tab) => (
                <button key={tab} className={reportInspectorTab === tab ? "active-tab" : ""} onClick={() => setReportInspectorTab(tab as typeof reportInspectorTab)}>
                  {tab}
                </button>
              ))}
            </div>

            {reportInspectorTab === "fields" ? (
              <>
                <label className="field">
                  <span>Table</span>
                  <select
                    value={activeReport.sourceTableId}
                    onChange={(event) => {
                      const table = bundle.tables.find((item) => item.id === event.target.value) || bundle.tables[0];
                      updateObject({
                        ...activeReport,
                        sourceTableId: table.id,
                        selectedFieldIds: table.fields.slice(0, 6).map((field) => field.id),
                        view: {
                          ...activeReport.view,
                          chartFieldId: table.fields[0]?.id || "",
                          titleFieldId: table.fields[1]?.id || table.fields[0]?.id || ""
                        }
                      });
                    }}
                  >
                    {bundle.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
                  </select>
                </label>
                <div className="picker-list">
                  {activeTable.fields.map((field) => (
                    <label className="picker-row" key={field.id}>
                      <input
                        type="checkbox"
                        checked={activeReport.selectedFieldIds.includes(field.id)}
                        onChange={(event) => {
                          const selectedFieldIds = event.target.checked
                            ? [...activeReport.selectedFieldIds, field.id]
                            : activeReport.selectedFieldIds.filter((item) => item !== field.id);
                          updateObject({ ...activeReport, selectedFieldIds });
                        }}
                      />
                      <span>{field.label}</span>
                      <em>{field.type}</em>
                    </label>
                  ))}
                </div>
              </>
            ) : null}

            {reportInspectorTab === "filters" ? (
              <>
                <div className="stack-compact">
                  {activeReport.filters.map((filter) => (
                    <div className="inline-edit-row" key={filter.id}>
                      <select value={filter.fieldId} onChange={(event) => updateObject({ ...activeReport, filters: activeReport.filters.map((item) => item.id === filter.id ? { ...item, fieldId: event.target.value } : item) })}>
                        {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                      </select>
                      <select value={filter.operator} onChange={(event) => updateObject({ ...activeReport, filters: activeReport.filters.map((item) => item.id === filter.id ? { ...item, operator: event.target.value as FilterDefinition["operator"] } : item) })}>
                        {["equals", "contains", "gt", "gte", "lt", "lte"].map((operator) => <option key={operator} value={operator}>{operator}</option>)}
                      </select>
                      <input value={filter.value} onChange={(event) => updateObject({ ...activeReport, filters: activeReport.filters.map((item) => item.id === filter.id ? { ...item, value: event.target.value } : item) })} />
                      <button onClick={() => updateObject({ ...activeReport, filters: activeReport.filters.filter((item) => item.id !== filter.id) })}>Remove</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeReport, filters: [...activeReport.filters, { id: uid("filter"), fieldId: activeTable.fields[0]?.id || "", operator: "equals", value: "" }] })}>
                  Add filter
                </button>
              </>
            ) : null}

            {reportInspectorTab === "view" ? (
              <>
                <label className="field">
                  <span>Mode</span>
                  <select value={activeReport.view.mode} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, mode: event.target.value as ReportViewMode } })}>
                    {REPORT_VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Chart type</span>
                  <select value={activeReport.view.chartType} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, chartType: event.target.value as ChartType } })}>
                    {CHART_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Chart field</span>
                  <select value={activeReport.view.chartFieldId} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, chartFieldId: event.target.value } })}>
                    {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                  </select>
                </label>
                <label className="field">
                  <span>Title field</span>
                  <select value={activeReport.view.titleFieldId} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, titleFieldId: event.target.value } })}>
                    {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                  </select>
                </label>
                {activeReport.view.mode === "kanban" ? (
                  <label className="field">
                    <span>Kanban field</span>
                    <select value={activeReport.view.kanbanField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, kanbanField: event.target.value } })}>
                      <option value="">Select a field</option>
                      {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                  </label>
                ) : null}
                {activeReport.view.mode === "timeline" ? (
                  <>
                    <label className="field">
                      <span>Timeline start</span>
                      <select value={activeReport.view.timelineDateField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, timelineDateField: event.target.value } })}>
                        <option value="">Select a field</option>
                        {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                      </select>
                    </label>
                    <label className="field">
                      <span>Timeline end</span>
                      <select value={activeReport.view.timelineEndField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, timelineEndField: event.target.value } })}>
                        <option value="">Select a field</option>
                        {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                      </select>
                    </label>
                  </>
                ) : null}
                {activeReport.view.mode === "calendar" ? (
                  <label className="field">
                    <span>Calendar date</span>
                    <select value={activeReport.view.calendarDateField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, calendarDateField: event.target.value } })}>
                      <option value="">Select a field</option>
                      {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                    </select>
                  </label>
                ) : null}
              </>
            ) : null}

            {reportInspectorTab === "summary" ? (
              <>
                <div className="stack-compact">
                  {activeReport.summaryMetrics.map((metric) => (
                    <div className="inline-edit-row" key={metric.id}>
                      <select value={metric.fieldId} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, fieldId: event.target.value } : item) })}>
                        {activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}
                      </select>
                      <select value={metric.op} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, op: event.target.value as SummaryMetric["op"] } : item) })}>
                        {["count", "sum", "avg", "min", "max"].map((op) => <option key={op} value={op}>{op}</option>)}
                      </select>
                      <input value={metric.label} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, label: event.target.value } : item) })} />
                      <button onClick={() => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.filter((item) => item.id !== metric.id) })}>Remove</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeReport, summaryMetrics: [...activeReport.summaryMetrics, { id: uid("metric"), fieldId: activeTable.fields[0]?.id || "", op: "count", label: "New metric" }] })}>
                  Add metric
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {activeDashboard ? (
          <div className="surface stack">
            <div className="studio-section-head">
              <div>
                <div className="eyebrow">Inspector</div>
                <h2>Dashboard Builder</h2>
              </div>
            </div>
            <div className="studio-tab-strip">
              {["design", "filters"].map((tab) => (
                <button key={tab} className={dashboardInspectorTab === tab ? "active-tab" : ""} onClick={() => setDashboardInspectorTab(tab as typeof dashboardInspectorTab)}>
                  {tab}
                </button>
              ))}
            </div>
            {dashboardInspectorTab === "design" ? (
              <>
                <div className="stack-compact">
                  {activeDashboard.tabs.map((tab) => (
                    <div className="card" key={tab.id}>
                      <div className="card-head">
                        <strong>{tab.name}</strong>
                        <button onClick={() => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.filter((item) => item.id !== tab.id) })}>Remove tab</button>
                      </div>
                      <label className="field">
                        <span>Tab name</span>
                        <input value={tab.name} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, name: event.target.value } : item) })} />
                      </label>
                      <div className="stack-compact">
                        {tab.widgets.map((widget) => (
                          <div className="inline-edit-row" key={widget.id}>
                            <input value={widget.title} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, title: event.target.value } : candidate) } : item) })} />
                            <select value={widget.reportId} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, reportId: event.target.value, snapshot: undefined, mode: "linked" } : candidate) } : item) })}>
                              {objects.filter((object): object is ReportDefinition => object.type === "report").map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}
                            </select>
                            <select value={widget.mode} onChange={(event) => {
                              const report = bundle.objects[widget.reportId] as ReportDefinition | undefined;
                              updateObject({
                                ...activeDashboard,
                                tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? {
                                  ...item,
                                  widgets: item.widgets.map((candidate) => candidate.id === widget.id ? {
                                    ...candidate,
                                    mode: event.target.value as "linked" | "copied",
                                    snapshot: event.target.value === "copied" && report ? clone(report) : undefined
                                  } : candidate)
                                } : item)
                              });
                            }}>
                              <option value="linked">linked</option>
                              <option value="copied">copied</option>
                            </select>
                            <button onClick={() => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.filter((candidate) => candidate.id !== widget.id) } : item) })}>Remove</button>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => {
                        const report = objects.find((object): object is ReportDefinition => object.type === "report");
                        if (!report) return;
                        updateObject({
                          ...activeDashboard,
                          tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? {
                            ...item,
                            widgets: [...item.widgets, { id: uid("widget"), title: report.name, mode: "linked", reportId: report.id, layout: { w: 6, h: 4 } }]
                          } : item)
                        });
                      }}>
                        Add widget
                      </button>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeDashboard, tabs: [...activeDashboard.tabs, { id: uid("tab"), name: `Tab ${activeDashboard.tabs.length + 1}`, widgets: [] }] })}>
                  Add tab
                </button>
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
                      <label className="field">
                        <span>Label</span>
                        <input value={filter.label} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, label: event.target.value } : item) })} />
                      </label>
                      <label className="field">
                        <span>Field</span>
                        <select value={filter.fieldId} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, fieldId: event.target.value } : item) })}>
                          {bundle.tables.flatMap((table) => table.fields.map((field) => <option key={`${table.id}-${field.id}`} value={field.id}>{table.name} · {field.label}</option>))}
                        </select>
                      </label>
                      <label className="field">
                        <span>Mode</span>
                        <select value={filter.mode} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, mode: event.target.value as "global" | "selected" } : item) })}>
                          <option value="global">global</option>
                          <option value="selected">selected</option>
                        </select>
                      </label>
                      <label className="field">
                        <span>Default value</span>
                        <input value={filter.defaultValue} onChange={(event) => updateObject({ ...activeDashboard, runtimeFilters: activeDashboard.runtimeFilters.map((item) => item.id === filter.id ? { ...item, defaultValue: event.target.value } : item) })} />
                      </label>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeDashboard, runtimeFilters: [...activeDashboard.runtimeFilters, { id: uid("runtime"), label: "New filter", fieldId: bundle.tables[0]?.fields[0]?.id || "", mode: "global", targetReportIds: [], defaultValue: "" }] })}>
                  Add runtime filter
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        <div className="surface stack">
          <div className="card-head">
            <strong>Direct Links</strong>
            <span className="micro">Hosted reader routes remain available.</span>
          </div>
          <div className="nav-list">
            {objects.map((object) => (
              <Link key={object.id} className="nav-card" to={`/${object.type}/${object.id}`}>
                <span className="badge">{object.type}</span>
                <strong>{object.name}</strong>
                <span className="micro">Open hosted reader</span>
              </Link>
            ))}
          </div>
        </div>
      </aside>
    </section>
  );
}
