import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { normalizeStudioDocument, type CatalogSummaryItem, type ReportDefinition, type StudioDocument, type StudioObject, type TableDefinition } from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { fetchCatalog, fetchObject, fetchTables, runReport, runReportPage } from "./lib/api";
import { getHostedContext } from "./lib/embed";
import type { QuickbaseTableLinkContext } from "./lib/quickbaseLinks";
import { fetchStudioDocument, fetchStudioRefreshJob, startStudioObjectRefresh, startStudioRefresh } from "./lib/studioApi";

function typeLabel(type: "report" | "dashboard") {
  return type === "report" ? "Report" : "Dashboard";
}

function reportResultNeedsAutoRefresh(result: any) {
  if (!result) return false;
  const fallback = result.freshness?.source === "local-fallback";
  const noRows = Number(result.totalRows || 0) === 0;
  const noSummary = !Array.isArray(result.summary) || result.summary.length === 0;
  const noChart = !Array.isArray(result.chartData) || result.chartData.length === 0;
  return fallback && noRows && noSummary && noChart;
}

function dashboardResultNeedsAutoRefresh(result: any) {
  if (!result) return false;
  if (result.freshness?.source !== "local-fallback") return false;
  const widgets = Array.isArray(result.tabs)
    ? result.tabs.flatMap((tab: any) => Array.isArray(tab.widgets) ? tab.widgets : [])
    : [];
  if (!widgets.length) return true;
  return widgets.every((widget: any) => {
    const widgetResult = widget?.result;
    if (!widgetResult) return true;
    const noRows = Number(widgetResult.totalRows || 0) === 0;
    const noSummary = !Array.isArray(widgetResult.summary) || widgetResult.summary.length === 0;
    const noChart = !Array.isArray(widgetResult.chartData) || widgetResult.chartData.length === 0;
    return noRows && noSummary && noChart;
  });
}

function resolveTableDefinition(tables: TableDefinition[], tableId: string) {
  return tables.find((item) => item.id === tableId || item.quickbaseTableId === tableId);
}

function getQuickbaseLinkContextForTable(table: TableDefinition | undefined, studioDocument: StudioDocument | null): QuickbaseTableLinkContext | null {
  if (!table || !studioDocument) return null;
  const profile = studioDocument.quickbaseProfiles.find((item) => item.id === table.quickbaseProfileId);
  const quickbase = profile?.quickbase || studioDocument.quickbase;
  const realmHostname = String(quickbase.realmHostname || "").trim();
  const tableId = String(table.quickbaseTableId || table.id || "").trim();
  if (!realmHostname || !tableId) return null;
  return {
    realmHostname,
    tableId
  };
}

function getProfileIdsForObject(object: StudioObject | null, tables: TableDefinition[], studioDocument: StudioDocument | null) {
  if (!object || !studioDocument) return [] as string[];
  const ids = new Set<string>();
  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    if (table?.quickbaseProfileId) ids.add(table.quickbaseProfileId);
    return Array.from(ids);
  }
  object.tabs.forEach((tab) => {
    tab.widgets.forEach((widget) => {
      const report = widget.mode === "copied" && widget.snapshot
        ? widget.snapshot
        : studioDocument.bundle.objects[widget.reportId];
      if (report?.type !== "report") return;
      const table = resolveTableDefinition(tables, report.sourceTableId);
      if (table?.quickbaseProfileId) ids.add(table.quickbaseProfileId);
    });
  });
  return Array.from(ids);
}

function useCatalog() {
  const [objects, setObjects] = useState<CatalogSummaryItem[]>([]);
  const [tables, setTables] = useState<TableDefinition[]>([]);
  const [studioDocument, setStudioDocument] = useState<StudioDocument | null>(null);

  const reloadCatalog = useCallback(async () => {
    fetchCatalog().then((response) => setObjects(response.objects));
    fetchTables().then((response) => setTables(response.tables));
    fetchStudioDocument().then((response) => setStudioDocument(normalizeStudioDocument(response.document))).catch(() => undefined);
  }, []);

  function markObjectAsRecent(objectId: string) {
    setStudioDocument((current) => {
      if (!current || !objectId) return current;
      return {
        ...current,
        recent: [objectId, ...(current.recent || []).filter((item) => item !== objectId)].slice(0, 10)
      };
    });
  }

  useEffect(() => {
    void reloadCatalog();
  }, []);

  return { objects, tables, studioDocument, reloadCatalog, markObjectAsRecent };
}

function formatTimestamp(value?: string) {
  if (!value) return "Not available yet";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function buildCatalogItemLookup(objects: CatalogSummaryItem[], studioDocument: StudioDocument | null) {
  const map = new Map<string, CatalogSummaryItem>();
  objects.forEach((object) => map.set(object.id, object));
  if (studioDocument) {
    Object.values(studioDocument.bundle.objects).forEach((object) => {
      if (!map.has(object.id)) {
        map.set(object.id, {
          id: object.id,
          type: object.type,
          name: object.name,
          description: object.description,
          folder: object.folder,
          category: object.category,
          tags: object.tags,
          updatedAt: object.updatedAt
        });
      }
    });
  }
  return map;
}

function HomePage({
  objects,
  studioDocument,
  openLinksInNewTab = false
}: {
  objects: CatalogSummaryItem[];
  studioDocument: StudioDocument | null;
  openLinksInNewTab?: boolean;
}) {
  const catalogLookup = useMemo(() => buildCatalogItemLookup(objects, studioDocument), [objects, studioDocument]);
  const rankedObjects = [...objects].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  const reports = rankedObjects.filter((object) => object.type === "report");
  const dashboards = rankedObjects.filter((object) => object.type === "dashboard");
  const recentObjects = (studioDocument?.recent || [])
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem => Boolean(item))
    .slice(0, 6) || [];
  const favoriteObjects = (studioDocument?.favorites || [])
    .map((id) => catalogLookup.get(id))
    .filter((item): item is CatalogSummaryItem => Boolean(item))
    .slice(0, 6) || [];
  const recentOrLatest = recentObjects.length ? recentObjects : rankedObjects.slice(0, 6);
  const favoritesOrFeatured = favoriteObjects.length ? favoriteObjects : [...dashboards, ...reports].slice(0, 6);
  const appProfiles = studioDocument?.quickbaseProfiles || [];
  const totalCachedRows = appProfiles.reduce((sum, profile) => sum + (profile.refreshStatus.cachedRowCount || 0), 0);
  const healthTone = totalCachedRows > 0 ? "Up to date" : "Needs refresh";

  return (
    <section className="surface home-page">
      <div className="home-shell">
        <section className="home-hero-panel">
          <div className="home-hero-copy">
            <span className="badge brand">Home</span>
            <h1>{studioDocument?.branding.homeLabel || "Reporting platform home"}</h1>
            <p>Everything important in one place: refresh health, connected apps, recent activity, favorites, and fast access to the reports and dashboards people use every day.</p>
          </div>
          <div className="home-hero-actions">
            <Link className="ghost-button" to="/viewer">Browse reports and dashboards</Link>
            <Link className="ghost-button" to="/studio">Open building area</Link>
          </div>
          <div className="home-highlight-grid">
            <div className="home-highlight-card home-highlight-card-primary">
              <span className="micro">Platform health</span>
              <strong>{healthTone}</strong>
              <span>Last refresh {formatTimestamp(studioDocument?.sync.refreshStatus.lastSuccessAt)}</span>
            </div>
            <div className="home-highlight-card">
              <span className="micro">Saved content</span>
              <strong>{objects.length}</strong>
              <span>{reports.length} reports · {dashboards.length} dashboards</span>
            </div>
            <div className="home-highlight-card">
              <span className="micro">Rows saved for faster loading</span>
              <strong>{totalCachedRows.toLocaleString()}</strong>
              <span>Across {appProfiles.length} connected app{appProfiles.length === 1 ? "" : "s"}</span>
            </div>
          </div>
        </section>

        <section className="home-main-grid">
          <div className="home-column home-column-wide">
            <div className="card home-section-card">
              <div className="card-head">
                <strong>{recentObjects.length ? "Recently Opened" : "Latest Activity"}</strong>
                <span className="micro">{recentObjects.length ? "Quickly reopen active work" : "Start here if nothing has been opened yet"}</span>
              </div>
              <div className="viewer-grid home-object-grid">
                {recentOrLatest.length ? recentOrLatest.map((object) => (
                  <Link key={object.id} className="home-object-card" to={`/${object.type}/${object.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
                    <span className="badge">{typeLabel(object.type)}</span>
                    <strong>{object.name}</strong>
                    <span>{object.description || "No description yet."}</span>
                    <span className="micro">{object.folder} · {object.category}</span>
                  </Link>
                )) : (
                  <div className="empty-page">No reports or dashboards are available yet.</div>
                )}
              </div>
            </div>

            <div className="card home-section-card">
              <div className="card-head">
                <strong>{favoriteObjects.length ? "Favorites" : "Featured Dashboards and Reports"}</strong>
                <span className="micro">{favoriteObjects.length ? "Pinned items for quick access" : "Helpful starting points until favorites are set"}</span>
              </div>
              <div className="viewer-grid home-object-grid">
                {favoritesOrFeatured.length ? favoritesOrFeatured.map((object) => (
                  <Link key={object.id} className="home-object-card" to={`/${object.type}/${object.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
                    <span className="badge">{typeLabel(object.type)}</span>
                    <strong>{object.name}</strong>
                    <span>{object.description || "No description yet."}</span>
                    <span className="micro">{object.folder} · {object.category}</span>
                  </Link>
                )) : (
                  <div className="empty-page">No favorites or featured content are available yet.</div>
                )}
              </div>
            </div>
          </div>

          <div className="home-column">
            <div className="card home-section-card">
              <div className="card-head">
                <strong>Platform Status</strong>
                <span className="micro">What is happening right now</span>
              </div>
              <div className="home-status-list">
                <div className="home-status-item">
                  <strong>Last full refresh</strong>
                  <span>{formatTimestamp(studioDocument?.sync.refreshStatus.lastSuccessAt)}</span>
                </div>
                <div className="home-status-item">
                  <strong>Next scheduled refresh</strong>
                  <span>{formatTimestamp(studioDocument?.sync.refreshStatus.nextRunAt)}</span>
                </div>
                <div className="home-status-item">
                  <strong>Current refresh message</strong>
                  <span>{studioDocument?.sync.refreshStatus.message || "No refresh has run yet."}</span>
                </div>
                <div className="home-status-item">
                  <strong>Favorites saved</strong>
                  <span>{(studioDocument?.favorites || []).length}</span>
                </div>
              </div>
            </div>

            <div className="card home-section-card">
              <div className="card-head">
                <strong>Connected Apps</strong>
                <span className="micro">Refresh and cache status by app</span>
              </div>
              <div className="home-app-list">
                {appProfiles.length ? appProfiles.map((profile) => (
                  <div className="home-app-item" key={profile.id}>
                    <div className="home-app-head">
                      <strong>{profile.label || "Quickbase app"}</strong>
                      <span className="badge">{profile.liveMode ? "Live mode" : "Cached mode"}</span>
                    </div>
                    <span>Last refresh: {formatTimestamp(profile.refreshStatus.lastSuccessAt)}</span>
                    <span>Next refresh: {formatTimestamp(profile.refreshStatus.nextRunAt)}</span>
                    <span>Rows saved: {(profile.refreshStatus.cachedRowCount || 0).toLocaleString()}</span>
                  </div>
                )) : (
                  <div className="empty">No Quickbase apps are configured yet.</div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

function ObjectPage({
  tables,
  platformName,
  studioDocument,
  openLinksInNewTab = false,
  onObjectViewed
}: {
  tables: TableDefinition[];
  platformName: string;
  studioDocument: StudioDocument | null;
  openLinksInNewTab?: boolean;
  onObjectViewed: (objectId: string) => void;
}) {
  const params = useParams();
  const [object, setObject] = useState<StudioObject | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const [autoRefreshForId, setAutoRefreshForId] = useState("");
  const [fallbackRefreshAttemptForId, setFallbackRefreshAttemptForId] = useState("");
  const pageSize = 100;
  const liveModeProfileIds = useMemo(() => getProfileIdsForObject(object, tables, studioDocument), [object, studioDocument, tables]);
  const liveModeEnabled = useMemo(
    () => liveModeProfileIds.some((profileId) => studioDocument?.quickbaseProfiles.find((profile) => profile.id === profileId)?.liveMode === true),
    [liveModeProfileIds, studioDocument]
  );

  async function reloadObject(targetObjectId = params.objectId) {
    if (!targetObjectId) return;
    setLoading(true);
    try {
      const response = await fetchObject(targetObjectId);
      setObject(response.object);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    setPage(1);
    setRefreshNonce(0);
    setRefreshJob(null);
    setAutoRefreshForId("");
    setFallbackRefreshAttemptForId("");
    fetchObject(params.objectId)
      .then((response) => {
        if (!active) return;
        setObject(response.object);
        setResult(null);
        onObjectViewed(response.object.id);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [onObjectViewed, params.objectId]);

  useEffect(() => {
    if (object) {
      document.title = object.name + " · " + platformName;
    }
  }, [object, platformName]);

  useEffect(() => {
    if (!object || object.type !== "report") return;
    let active = true;
    setLoading(true);
    const fetcher = page === 1
      ? runReport(object.id)
      : runReportPage(object.id, page, pageSize);
    fetcher
      .then((reportResult) => {
        if (!active) return;
        setResult((current: any) => page === 1 || !current
          ? reportResult
          : {
              ...current,
              rows: reportResult.rows,
              totalRows: reportResult.totalRows,
              page: reportResult.page,
              pageSize: reportResult.pageSize,
              totalPages: reportResult.totalPages,
              hasNextPage: reportResult.hasNextPage
            });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [object?.id, object?.type, page, refreshNonce]);

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete") {
            setRefreshNonce((current) => current + 1);
            void reloadObject();
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  async function startObjectRefresh() {
    if (!object) return;
    const response = await startStudioObjectRefresh(object.id);
    setRefreshJob(response.job);
  }

  useEffect(() => {
    if (!object || !liveModeEnabled || autoRefreshForId === object.id || refreshJob?.status === "queued" || refreshJob?.status === "running") {
      return;
    }
    setAutoRefreshForId(object.id);
    void startObjectRefresh();
  }, [autoRefreshForId, liveModeEnabled, object, refreshJob?.status]);

  useEffect(() => {
    if (!object || !result || loading) return;
    if (refreshJob?.status === "queued" || refreshJob?.status === "running") return;
    if (fallbackRefreshAttemptForId === `${object.id}:${refreshNonce}`) return;
    const shouldRefresh = object.type === "report"
      ? reportResultNeedsAutoRefresh(result)
      : dashboardResultNeedsAutoRefresh(result);
    if (!shouldRefresh) return;
    setFallbackRefreshAttemptForId(`${object.id}:${refreshNonce}`);
    void startObjectRefresh();
  }, [fallbackRefreshAttemptForId, loading, object, refreshJob?.status, refreshNonce, result]);

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;

  if (object.type === "report") {
    const table = resolveTableDefinition(tables, object.sourceTableId);
    const quickbaseLinkContext = getQuickbaseLinkContextForTable(table, studioDocument);
    return (
      <>
        {liveModeEnabled ? (
          <div className="sync-status sync-status-warn">
            <strong>Live mode enabled</strong>
            <span>Opening this report triggers a live object refresh first, so loading can take significantly longer.</span>
          </div>
        ) : null}
        {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" ? (
          <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
            <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
              <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>Refreshing this report</strong>
              <div style={{ marginBottom: "10px", color: "#41554a" }}>{refreshJob.message}</div>
              <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
                <div style={{ height: "100%", width: `${refreshJob.progress || 0}%`, background: "#0d7c66" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
                <span>{refreshJob.progress || 0}% complete</span>
                <span>{typeof refreshJob.estimatedSecondsRemaining === "number" ? `~${refreshJob.estimatedSecondsRemaining}s remaining` : "Estimating time…"}</span>
              </div>
            </div>
          </div>
        ) : null}
        <ReportView
          report={object as ReportDefinition}
          table={table}
          quickbaseLinkContext={quickbaseLinkContext}
          result={result}
          loading={loading}
          currentPage={page}
          onPageChange={setPage}
          onRefresh={() => { void startObjectRefresh(); }}
          openLinksInNewTab={openLinksInNewTab}
        />
      </>
    );
  }

  return (
    <>
      {liveModeEnabled ? (
        <div className="sync-status sync-status-warn">
          <strong>Live mode enabled</strong>
          <span>Opening this dashboard triggers a live object refresh first, so loading can take significantly longer.</span>
        </div>
      ) : null}
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
          <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
            <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>Refreshing this dashboard</strong>
            <div style={{ marginBottom: "10px", color: "#41554a" }}>{refreshJob.message}</div>
            <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ height: "100%", width: `${refreshJob.progress || 0}%`, background: "#0d7c66" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
              <span>{refreshJob.progress || 0}% complete</span>
              <span>{typeof refreshJob.estimatedSecondsRemaining === "number" ? `~${refreshJob.estimatedSecondsRemaining}s remaining` : "Estimating time…"}</span>
            </div>
          </div>
        </div>
      ) : null}
      <DashboardView
        dashboard={object}
        tables={tables}
        getQuickbaseLinkContext={(tableId) => getQuickbaseLinkContextForTable(resolveTableDefinition(tables, tableId), studioDocument)}
        refreshNonce={refreshNonce}
        onRefresh={() => { void startObjectRefresh(); }}
        openLinksInNewTab={openLinksInNewTab}
      />
    </>
  );
}

function ViewerPage({ objects, refreshAllSignal = 0, openLinksInNewTab = false }: { objects: CatalogSummaryItem[]; refreshAllSignal?: number; openLinksInNewTab?: boolean }) {
  const [query, setQuery] = useState("");
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return objects;
    return objects.filter((object) =>
      [object.name, object.description, object.folder, object.category, object.tags.join(" ")].join(" ").toLowerCase().includes(text)
    );
  }, [objects, query]);

  useEffect(() => {
    if (!refreshJob || refreshJob.status === "complete" || refreshJob.status === "failed") return;
    const handle = window.setInterval(() => {
      fetchStudioRefreshJob(refreshJob.id)
        .then((response) => {
          setRefreshJob(response.job);
          if (response.job.status === "complete" || response.job.status === "failed") {
            window.location.reload();
          }
        })
        .catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(handle);
  }, [refreshJob]);

  useEffect(() => {
    if (!refreshAllSignal) return;
    void startFullRefresh();
  }, [refreshAllSignal]);

  async function startFullRefresh() {
    const response = await startStudioRefresh();
    setRefreshJob(response.job);
  }

  return (
    <section className="surface stack viewer-page">
      {refreshJob && refreshJob.status !== "complete" && refreshJob.status !== "failed" ? (
        <div style={{ position: "fixed", inset: 0, background: "rgba(12,22,18,0.58)", zIndex: 9999, display: "grid", placeItems: "center", padding: "24px" }}>
          <div style={{ width: "min(560px, 100%)", background: "#fff", borderRadius: "20px", padding: "24px", boxShadow: "0 24px 64px rgba(0,0,0,0.24)" }}>
            <strong style={{ display: "block", fontSize: "1.1rem", marginBottom: "8px" }}>Refreshing all reports and dashboards</strong>
            <div style={{ marginBottom: "10px", color: "#41554a" }}>{refreshJob.message}</div>
            <div style={{ height: "12px", background: "#e5ece8", borderRadius: "999px", overflow: "hidden", marginBottom: "10px" }}>
              <div style={{ height: "100%", width: `${refreshJob.progress || 0}%`, background: "#0d7c66" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.95rem", color: "#41554a" }}>
              <span>{refreshJob.progress || 0}% complete</span>
              <span>{typeof refreshJob.estimatedSecondsRemaining === "number" ? `~${refreshJob.estimatedSecondsRemaining}s remaining` : "Estimating time…"}</span>
            </div>
          </div>
        </div>
      ) : null}
      <div className="hero viewer-hero">
        <div>
          <span className="badge brand">Viewing</span>
          <h1>Open Reports and Dashboards</h1>
          <p>Choose any saved report or dashboard to open it full screen with its live filters and navigation controls.</p>
        </div>
        <div className="link-toolbar viewer-actions">
          <Link className="ghost-button" to="/studio">Open building area</Link>
        </div>
      </div>

      <label className="field viewer-search-field">
        <span>Search</span>
        <input
          id="viewer-search"
          name="viewerSearch"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search reports and dashboards"
        />
      </label>

      <div className="viewer-grid">
        {filtered.map((object) => (
          <Link key={object.id} className="viewer-card" to={`/${object.type}/${object.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
            <span className="badge">{typeLabel(object.type)}</span>
            <strong>{object.name}</strong>
            <span>{object.description || "No description yet."}</span>
            <span className="micro">{object.folder} · {object.category}</span>
          </Link>
        ))}
        {!filtered.length ? <div className="empty-page">No reports or dashboards match this search.</div> : null}
      </div>
    </section>
  );
}

export function App() {
  const { objects, tables, studioDocument, reloadCatalog, markObjectAsRecent } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const [studioSettingsSignal, setStudioSettingsSignal] = useState(0);
  const [studioRefreshSignal, setStudioRefreshSignal] = useState(0);
  const [viewerRefreshSignal, setViewerRefreshSignal] = useState(0);
  const homeRoute = location.pathname === "/";
  const studioRoute = location.pathname.startsWith("/studio");
  const viewerRoute = location.pathname === "/viewer";
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const openLinksInNewTab = studioDocument?.branding.openLinksInNewTab === true;
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;
  const hideSidebar = hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute;

  useEffect(() => {
    void reloadCatalog();
  }, [location.pathname, reloadCatalog]);

  useEffect(() => {
    if (readerRoute) return;
    if (homeRoute) {
      document.title = `${platformName} · Home`;
      return;
    }
    if (studioRoute) {
      document.title = `${platformName} · Building`;
      return;
    }
    if (viewerRoute || location.pathname === "/") {
      document.title = `${platformName} · Viewing`;
      return;
    }
    document.title = platformName;
  }, [homeRoute, location.pathname, platformName, readerRoute, studioRoute, viewerRoute]);

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""} ${readerFullScreen ? "reader-shell" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">{homeRoute ? "Home" : studioRoute ? "Building" : viewerRoute ? "Viewing" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <div className="topbar-nav">
              <NavLink end className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/">Home</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/studio">Building</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/viewer">Viewing</NavLink>
            </div>
            {studioRoute ? (
              <>
                <button className="ghost-button topbar-action" onClick={() => setStudioRefreshSignal((value) => value + 1)}>Refresh all</button>
                <button className="ghost-button topbar-action" onClick={() => setStudioSettingsSignal((value) => value + 1)}>Settings</button>
              </>
            ) : null}
            {viewerRoute ? (
              <button className="ghost-button topbar-action" onClick={() => setViewerRefreshSignal((value) => value + 1)}>Refresh all</button>
            ) : null}
            <span className="badge">{hosted.mode === "viewer" ? "Full-screen view" : navLabel}</span>
            <span className="badge brand">{objects.length} saved views</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute || viewerRoute || homeRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>
        {hideSidebar ? null : (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>{navLabel}</strong>
              <span className="micro">Open a report or dashboard directly.</span>
            </div>
            <nav className="nav-list">
              {objects.map((object) => (
                <Link key={object.id} className="nav-card" to={`/${object.type}/${object.id}`} target={openLinksInNewTab ? "_blank" : undefined} rel={openLinksInNewTab ? "noreferrer" : undefined}>
                  <span className="badge">{typeLabel(object.type)}</span>
                  <strong>{object.name}</strong>
                  <span className="micro">{object.folder} · {object.category}</span>
                </Link>
              ))}
            </nav>
          </aside>
        )}

        <main className={`content ${readerRoute ? "reader-content" : ""}`}>
          <Routes>
            <Route path="/" element={<HomePage objects={objects} studioDocument={studioDocument} openLinksInNewTab={openLinksInNewTab} />} />
            <Route path="/viewer" element={<ViewerPage objects={objects} refreshAllSignal={viewerRefreshSignal} openLinksInNewTab={openLinksInNewTab} />} />
            <Route path="/studio" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} />} />
            <Route path="/studio/:objectId" element={<StudioPage openSettingsSignal={studioSettingsSignal} refreshAllSignal={studioRefreshSignal} />} />
            <Route path="/:type/:objectId" element={<ObjectPage tables={tables} platformName={platformName} studioDocument={studioDocument} openLinksInNewTab={openLinksInNewTab} onObjectViewed={markObjectAsRecent} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
