import { useEffect, useMemo, useRef, useState, type ChangeEvent, type Dispatch, type SetStateAction } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  buildDashboardFilters,
  buildDashboardResult,
  buildStudioDocument,
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
  fetchStudioDocument,
  fetchStudioVersions,
  restoreStudioVersion,
  saveStudioDocument
} from "../lib/studioApi";

const STORAGE_KEY = "hosted-reporting-studio-v2";
const REPORT_VIEW_OPTIONS: ReportViewMode[] = ["table", "summary", "chart", "timeline", "calendar", "kanban"];
const CHART_OPTIONS: ChartType[] = ["bar", "column", "line", "area", "donut", "pie", "stacked-bar", "stacked-column", "funnel", "heatmap"];

type DrawerKind = null | "sync" | "share" | "templates" | "export" | "versions";
type LibraryFilter = "all" | "report" | "dashboard";
type ToastTone = "ok" | "warn" | "danger";

interface ToastItem {
  id: string;
  tone: ToastTone;
  message: string;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function uid(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function loadLocalDocument() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StudioDocument) : buildStudioDocument();
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
    if (object.view.mode === "timeline" && !object.view.timelineDateField) messages.push("Choose a timeline start field.");
    if (object.view.mode === "calendar" && !object.view.calendarDateField) messages.push("Choose a calendar date field.");
    if (object.view.mode === "kanban" && !object.view.kanbanField) messages.push("Choose a kanban column field.");
    if (table && table.id !== object.sourceTableId) messages.push("Report source table is invalid.");
  } else {
    if (!object.tabs.length) messages.push("Add at least one dashboard tab.");
    if (!object.tabs.some((tab) => tab.widgets.length)) messages.push("Add at least one widget.");
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
      <div className="chart-bars">
        {result.chartData.map((datum) => (
          <div className="chart-row" key={datum.label}>
            <div className="chart-label">{datum.label}</div>
            <div className="chart-track">
              <div className="chart-fill" style={{ width: `${Math.max(12, datum.value * 24)}px` }} />
            </div>
            <div className="chart-value">{datum.value}</div>
          </div>
        ))}
      </div>
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
  result,
  runtimeValues,
  setRuntimeValues,
  widgetSearch,
  onOpenReport
}: {
  dashboard: DashboardDefinition;
  result: DashboardRunResult;
  runtimeValues: Record<string, string>;
  setRuntimeValues: Dispatch<SetStateAction<Record<string, string>>>;
  widgetSearch: string;
  onOpenReport: (reportId: string) => void;
}) {
  const normalizedQuery = widgetSearch.trim().toLowerCase();
  return (
    <div className="studio-preview-stack">
      {dashboard.runtimeFilters.length ? (
        <section className="card">
          <div className="card-head">
            <strong>Runtime Filters</strong>
            <span className="micro">Viewer-safe dashboard controls</span>
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
              <span className="micro">{widgets.length} widgets</span>
            </div>
            <div className="widget-grid">
              {widgets.map((widget) => (
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
        );
      })}
    </div>
  );
}

export function StudioPage() {
  const navigate = useNavigate();
  const params = useParams();
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [documentState, setDocumentState] = useState<StudioDocument>(() => loadLocalDocument());
  const [loadingRemote, setLoadingRemote] = useState(true);
  const [savingRemote, setSavingRemote] = useState(false);
  const [history, setHistory] = useState<StudioDocument[]>([]);
  const [future, setFuture] = useState<StudioDocument[]>([]);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryFilter, setLibraryFilter] = useState<LibraryFilter>("all");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [recentOnly, setRecentOnly] = useState(false);
  const [reportInspectorTab, setReportInspectorTab] = useState<"fields" | "filters" | "view" | "summary">("fields");
  const [dashboardInspectorTab, setDashboardInspectorTab] = useState<"design" | "filters">("design");
  const [activeTabId, setActiveTabId] = useState("");
  const [widgetSearch, setWidgetSearch] = useState("");
  const [runtimeValues, setRuntimeValues] = useState<Record<string, string>>({});
  const [drawer, setDrawer] = useState<DrawerKind>(null);
  const [versionList, setVersionList] = useState<StudioVersionRecord[]>([]);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const bundle = documentState.bundle;
  const objects = useMemo(() => bundle.order.map((id) => bundle.objects[id]).filter(Boolean), [bundle]);
  const activeObjectId = params.objectId && bundle.objects[params.objectId] ? params.objectId : bundle.order[0];
  const activeObject = activeObjectId ? bundle.objects[activeObjectId] : null;
  const activeReport = activeObject?.type === "report" ? activeObject : null;
  const activeDashboard = activeObject?.type === "dashboard" ? activeObject : null;
  const activeTable = activeReport ? bundle.tables.find((table) => table.id === activeReport.sourceTableId) || null : null;
  const validation = activeObject ? validationMessages(activeObject, activeTable) : [];

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
        const next = response.document;
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

  const reportResult = useMemo(() => {
    if (!activeReport || !activeTable) return null;
    return runReport(activeReport, activeTable, bundle.data[activeReport.sourceTableId] || []);
  }, [activeReport, activeTable, bundle.data]);

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
          report,
          result: runReport(report, table, bundle.data[report.sourceTableId] || [], buildDashboardFilters(activeDashboard, report.id, runtimeValues))
        };
      }).filter((item): item is { widgetId: string; report: ReportDefinition; result: ReportRunResult } => Boolean(item))
    );
    return buildDashboardResult(activeDashboard, widgets);
  }, [activeDashboard, bundle, runtimeValues]);

  function updateObject(nextObject: StudioObject) {
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[nextObject.id] = { ...nextObject, updatedAt: new Date().toISOString() };
      if (!draft.bundle.order.includes(nextObject.id)) {
        draft.bundle.order.unshift(nextObject.id);
      }
    });
  }

  function createReport() {
    const table = bundle.tables[0];
    if (!table) return;
    const report: ReportDefinition = {
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
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[report.id] = report;
      draft.bundle.order.unshift(report.id);
    });
    navigate(`/studio/${report.id}`);
    pushToast("Report created.");
  }

  function createDashboard() {
    const dashboard: DashboardDefinition = {
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
    applyDocumentUpdate((draft) => {
      draft.bundle.objects[dashboard.id] = dashboard;
      draft.bundle.order.unshift(dashboard.id);
    });
    navigate(`/studio/${dashboard.id}`);
    pushToast("Dashboard created.");
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

  function deleteObject(objectId: string) {
    applyDocumentUpdate((draft) => {
      delete draft.bundle.objects[objectId];
      draft.bundle.order = draft.bundle.order.filter((item) => item !== objectId);
      draft.favorites = draft.favorites.filter((item) => item !== objectId);
      draft.recent = draft.recent.filter((item) => item !== objectId);
    });
    navigate(`/studio/${bundle.order.find((item) => item !== objectId) || ""}`);
    pushToast("Object removed.", "warn");
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

  async function saveRemote() {
    setSavingRemote(true);
    try {
      const response = await saveStudioDocument(documentState);
      setDocumentState(response.document);
      pushToast("Hosted studio saved.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Save failed.", "danger");
    } finally {
      setSavingRemote(false);
    }
  }

  async function reloadRemote() {
    try {
      const response = await fetchStudioDocument();
      setDocumentState(response.document);
      setHistory([]);
      setFuture([]);
      pushToast("Reloaded hosted studio.");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : "Reload failed.", "danger");
    }
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
        setDocumentState(parsed as StudioDocument);
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

  function exportWorkbook() {
    const workbook = XLSX.utils.book_new();
    if (activeReport && activeTable && reportResult) {
      const rows = reportResult.rows.map((row) => Object.fromEntries(activeReport.selectedFieldIds.map((fieldId) => [activeTable.fields.find((field) => field.id === fieldId)?.label || fieldId, formatCell(row[fieldId])])));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), activeReport.name.slice(0, 31));
    } else if (activeDashboard && dashboardResult) {
      dashboardResult.tabs.forEach((tab) => {
        tab.widgets.forEach((widget) => {
          const rows = widget.result.rows.map((row) => Object.fromEntries(widget.report.selectedFieldIds.map((fieldId) => [fieldId, formatCell(row[fieldId])])));
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), `${tab.name}-${widget.report.name}`.slice(0, 31));
        });
      });
    } else {
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(bundle.order.map((id) => ({ id, name: bundle.objects[id]?.name || "", type: bundle.objects[id]?.type || "" }))), "Catalog");
    }
    XLSX.writeFile(workbook, `${activeObject?.id || "studio"}.xlsx`);
    applyDocumentUpdate((draft) => {
      draft.exportJobs.unshift({
        id: uid("job"),
        objectId: activeObject?.id || "studio",
        format: "xlsx",
        status: "complete",
        createdAt: new Date().toISOString()
      });
    }, { skipHistory: true });
    pushToast("Workbook exported.");
  }

  if (!activeObject) {
    return <div className="empty-page">No studio objects available.</div>;
  }

  const defaultUrl = `${window.location.origin}${import.meta.env.BASE_URL}#/${activeObject.type}/${activeObject.id}`;
  const viewerUrl = `${window.location.origin}${import.meta.env.BASE_URL}?mode=viewer#/${activeObject.type}/${activeObject.id}`;
  const embedUrl = `${window.location.origin}${import.meta.env.BASE_URL}?embed=1&mode=viewer#/${activeObject.type}/${activeObject.id}`;

  return (
    <section className="studio-page">
      <aside className="studio-library">
        <div className="surface stack">
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
            <input value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} placeholder="Reports, dashboards, fields, tags" />
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
                <span className="badge">{object.type}</span>
                <strong>{object.name}</strong>
                <span className="micro">{object.folder} · {object.category}</span>
              </Link>
            ))}
          </div>
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
            <span className="badge brand">{activeObject.type}</span>
            <h1>{activeObject.name}</h1>
            <p>{activeObject.description || "Hosted studio definition with local persistence, sync, templates, versions, and export."}</p>
            <div className="micro-row">
              <span>{loadingRemote ? "Loading remote studio…" : "Remote studio loaded"}</span>
              <span>{documentState.sync.lastSavedAt ? `Last saved ${new Date(documentState.sync.lastSavedAt).toLocaleString()}` : "Not saved yet"}</span>
            </div>
          </div>
          <div className="link-toolbar">
            <button onClick={() => toggleFavorite(activeObject.id)}>{documentState.favorites.includes(activeObject.id) ? "Unfavorite" : "Favorite"}</button>
            <button onClick={() => cloneObject(activeObject)}>Clone</button>
            <button onClick={undo} disabled={!history.length}>Undo</button>
            <button onClick={redo} disabled={!future.length}>Redo</button>
            <button onClick={() => setDrawer("share")}>Share</button>
            <button onClick={() => setDrawer("sync")}>Sync</button>
            <button onClick={() => setDrawer("export")}>Export</button>
            <button onClick={openVersions}>Versions</button>
          </div>
        </div>

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

        {activeReport && activeTable && reportResult ? (
          <section className="surface stack">
            <div className="card-head">
              <strong>Report Preview</strong>
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
            <div className="filter-grid compact-grid">
              <label className="field">
                <span>Widget search</span>
                <input value={widgetSearch} onChange={(event) => setWidgetSearch(event.target.value)} placeholder="Find widgets or reports" />
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
              runtimeValues={runtimeValues}
              setRuntimeValues={setRuntimeValues}
              widgetSearch={widgetSearch}
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
              <button onClick={() => deleteObject(activeReport.id)}>Delete</button>
            </div>
            <div className="studio-tab-strip">
              {["fields", "filters", "view", "summary"].map((tab) => (
                <button key={tab} className={reportInspectorTab === tab ? "active-tab" : ""} onClick={() => setReportInspectorTab(tab as typeof reportInspectorTab)}>{tab}</button>
              ))}
            </div>

            {reportInspectorTab === "fields" ? (
              <>
                <label className="field"><span>Name</span><input value={activeReport.name} onChange={(event) => updateObject({ ...activeReport, name: event.target.value })} /></label>
                <label className="field"><span>Description</span><input value={activeReport.description} onChange={(event) => updateObject({ ...activeReport, description: event.target.value })} /></label>
                <label className="field">
                  <span>Table</span>
                  <select value={activeReport.sourceTableId} onChange={(event) => {
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
                  }}>
                    {bundle.tables.map((table) => <option key={table.id} value={table.id}>{table.name}</option>)}
                  </select>
                </label>
                <div className="picker-list">
                  {activeTable.fields.map((field) => (
                    <label className="picker-row" key={field.id}>
                      <input
                        type="checkbox"
                        checked={activeReport.selectedFieldIds.includes(field.id)}
                        onChange={(event) => updateObject({
                          ...activeReport,
                          selectedFieldIds: event.target.checked
                            ? [...activeReport.selectedFieldIds, field.id]
                            : activeReport.selectedFieldIds.filter((item) => item !== field.id)
                        })}
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
                <button onClick={() => updateObject({ ...activeReport, filters: [...activeReport.filters, { id: uid("filter"), fieldId: activeTable.fields[0]?.id || "", operator: "equals", value: "" }] })}>Add filter</button>
              </>
            ) : null}

            {reportInspectorTab === "view" ? (
              <>
                <label className="field"><span>Mode</span><select value={activeReport.view.mode} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, mode: event.target.value as ReportViewMode } })}>{REPORT_VIEW_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="field"><span>Chart type</span><select value={activeReport.view.chartType} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, chartType: event.target.value as ChartType } })}>{CHART_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
                <label className="field"><span>Chart field</span><select value={activeReport.view.chartFieldId} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, chartFieldId: event.target.value } })}>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                <label className="field"><span>Title field</span><select value={activeReport.view.titleFieldId} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, titleFieldId: event.target.value } })}>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                {activeReport.view.mode === "kanban" ? <label className="field"><span>Kanban field</span><select value={activeReport.view.kanbanField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, kanbanField: event.target.value } })}><option value="">Select a field</option>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label> : null}
                {activeReport.view.mode === "timeline" ? (
                  <>
                    <label className="field"><span>Timeline start</span><select value={activeReport.view.timelineDateField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, timelineDateField: event.target.value } })}><option value="">Select a field</option>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                    <label className="field"><span>Timeline end</span><select value={activeReport.view.timelineEndField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, timelineEndField: event.target.value } })}><option value="">Select a field</option>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
                  </>
                ) : null}
                {activeReport.view.mode === "calendar" ? <label className="field"><span>Calendar date</span><select value={activeReport.view.calendarDateField} onChange={(event) => updateObject({ ...activeReport, view: { ...activeReport.view, calendarDateField: event.target.value } })}><option value="">Select a field</option>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label> : null}
              </>
            ) : null}

            {reportInspectorTab === "summary" ? (
              <>
                <div className="stack-compact">
                  {activeReport.summaryMetrics.map((metric) => (
                    <div className="inline-edit-row" key={metric.id}>
                      <select value={metric.fieldId} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, fieldId: event.target.value } : item) })}>{activeTable.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select>
                      <select value={metric.op} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, op: event.target.value as SummaryMetric["op"] } : item) })}>{["count", "sum", "avg", "min", "max"].map((op) => <option key={op} value={op}>{op}</option>)}</select>
                      <input value={metric.label} onChange={(event) => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.map((item) => item.id === metric.id ? { ...item, label: event.target.value } : item) })} />
                      <button onClick={() => updateObject({ ...activeReport, summaryMetrics: activeReport.summaryMetrics.filter((item) => item.id !== metric.id) })}>Remove</button>
                    </div>
                  ))}
                </div>
                <button onClick={() => updateObject({ ...activeReport, summaryMetrics: [...activeReport.summaryMetrics, { id: uid("metric"), fieldId: activeTable.fields[0]?.id || "", op: "count", label: "New metric" }] })}>Add metric</button>
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
                            <label className="field"><span>Title</span><input value={widget.title} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, title: event.target.value } : candidate) } : item) })} /></label>
                            <div className="inline-edit-row widget-layout-row">
                              <select value={widget.reportId} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, reportId: event.target.value, snapshot: undefined, mode: "linked" } : candidate) } : item) })}>{objects.filter((object): object is ReportDefinition => object.type === "report").map((report) => <option key={report.id} value={report.id}>{report.name}</option>)}</select>
                              <select value={widget.mode} onChange={(event) => {
                                const report = bundle.objects[widget.reportId] as ReportDefinition | undefined;
                                updateObject({
                                  ...activeDashboard,
                                  tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? {
                                    ...item,
                                    widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, mode: event.target.value as "linked" | "copied", snapshot: event.target.value === "copied" && report ? clone(report) : undefined } : candidate)
                                  } : item)
                                });
                              }}>
                                <option value="linked">linked</option>
                                <option value="copied">copied</option>
                              </select>
                              <label className="field-inline"><span>W</span><input type="number" value={widget.layout.w} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, layout: { ...candidate.layout, w: Number(event.target.value) || 1 } } : candidate) } : item) })} /></label>
                              <label className="field-inline"><span>H</span><input type="number" value={widget.layout.h} onChange={(event) => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.map((candidate) => candidate.id === widget.id ? { ...candidate, layout: { ...candidate.layout, h: Number(event.target.value) || 1 } } : candidate) } : item) })} /></label>
                              <button onClick={() => updateObject({ ...activeDashboard, tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: item.widgets.filter((candidate) => candidate.id !== widget.id) } : item) })}>Remove</button>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={() => {
                        const report = objects.find((object): object is ReportDefinition => object.type === "report");
                        if (!report) return;
                        updateObject({
                          ...activeDashboard,
                          tabs: activeDashboard.tabs.map((item) => item.id === tab.id ? { ...item, widgets: [...item.widgets, { id: uid("widget"), title: report.name, mode: "linked", reportId: report.id, layout: { w: 6, h: 4 } }] } : item)
                        });
                      }}>Add widget</button>
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
        ) : null}

        <div className="surface stack">
          <div className="card-head">
            <strong>Quick Actions</strong>
            <span className="micro">Reader links and backend controls</span>
          </div>
          <div className="nav-list">
            <Link className="nav-card" to={`/${activeObject.type}/${activeObject.id}`}>
              <span className="badge">reader</span>
              <strong>Open hosted reader</strong>
              <span className="micro">{defaultUrl}</span>
            </Link>
          </div>
          <div className="studio-actions">
            <button onClick={() => addTemplate(activeObject.type === "dashboard" ? "layout" : "yaml")}>Save as template</button>
            <button onClick={snapshotCurrentObject}>Snapshot</button>
            <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save remote"}</button>
          </div>
        </div>
      </aside>

      {drawer ? (
        <div className="studio-drawer-backdrop" onClick={() => setDrawer(null)}>
          <section className="studio-drawer" onClick={(event) => event.stopPropagation()}>
            <div className="card-head">
              <strong>{drawer === "sync" ? "Sync" : drawer === "share" ? "Share" : drawer === "templates" ? "Templates" : drawer === "export" ? "Export" : "Versions"}</strong>
              <button onClick={() => setDrawer(null)}>Close</button>
            </div>

            {drawer === "sync" ? (
              <div className="stack">
                <div className="summary-grid">
                  <div className="summary-card"><strong>{documentState.sync.providerMode}</strong><span>Provider</span></div>
                  <div className="summary-card"><strong>{documentState.sync.lastLoadedAt ? new Date(documentState.sync.lastLoadedAt).toLocaleTimeString() : "n/a"}</strong><span>Last load</span></div>
                  <div className="summary-card"><strong>{documentState.sync.lastSavedAt ? new Date(documentState.sync.lastSavedAt).toLocaleTimeString() : "n/a"}</strong><span>Last save</span></div>
                </div>
                <div className="studio-actions">
                  <button onClick={reloadRemote}>Load remote</button>
                  <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save remote"}</button>
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
                  <button onClick={exportWorkbook}>Export workbook</button>
                  <button onClick={exportJson}>Export JSON</button>
                </div>
                <div className="stack-compact">
                  {documentState.exportJobs.map((job) => (
                    <div className="card" key={job.id}>
                      <div className="card-head">
                        <strong>{job.objectId}</strong>
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
                  <button onClick={snapshotCurrentObject}>Create snapshot</button>
                </div>
                {versionList.length ? versionList.map((version) => (
                  <div className="card" key={version.id}>
                    <div className="card-head">
                      <strong>{version.label}</strong>
                      <span className="micro">{new Date(version.savedAt).toLocaleString()}</span>
                    </div>
                    <button onClick={() => restoreVersion(version.id)}>Restore</button>
                  </div>
                )) : <div className="empty">No versions yet.</div>}
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
