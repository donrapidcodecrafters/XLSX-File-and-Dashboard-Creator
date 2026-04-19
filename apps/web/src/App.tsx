import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { normalizeStudioDocument, type CatalogSummaryItem, type ReportDefinition, type StudioDocument, type StudioObject, type TableDefinition } from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { fetchCatalog, fetchObject, fetchTables, runReport, runReportPage } from "./lib/api";
import { getHostedContext } from "./lib/embed";
import { fetchStudioDocument, fetchStudioRefreshJob, startStudioObjectRefresh, startStudioRefresh } from "./lib/studioApi";

function typeLabel(type: "report" | "dashboard") {
  return type === "report" ? "Report" : "Dashboard";
}

function useCatalog() {
  const [objects, setObjects] = useState<CatalogSummaryItem[]>([]);
  const [tables, setTables] = useState<TableDefinition[]>([]);
  const [studioDocument, setStudioDocument] = useState<StudioDocument | null>(null);

  useEffect(() => {
    fetchCatalog().then((response) => setObjects(response.objects));
    fetchTables().then((response) => setTables(response.tables));
    fetchStudioDocument().then((response) => setStudioDocument(normalizeStudioDocument(response.document))).catch(() => undefined);
  }, []);

  return { objects, tables, studioDocument };
}

function ObjectPage({ tables, platformName }: { tables: TableDefinition[]; platformName: string }) {
  const params = useParams();
  const [object, setObject] = useState<StudioObject | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [refreshJob, setRefreshJob] = useState<any>(null);
  const pageSize = 100;

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    setPage(1);
    setRefreshNonce(0);
    setRefreshJob(null);
    fetchObject(params.objectId)
      .then((response) => {
        if (!active) return;
        setObject(response.object);
        setResult(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params.objectId]);

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

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;

  if (object.type === "report") {
    const table = tables.find((item) => item.id === object.sourceTableId);
    return (
      <>
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
          result={result}
          loading={loading}
          currentPage={page}
          onPageChange={setPage}
          onRefresh={() => { void startObjectRefresh(); }}
        />
      </>
    );
  }

  return (
    <>
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
        refreshNonce={refreshNonce}
        onRefresh={() => { void startObjectRefresh(); }}
      />
    </>
  );
}

function ViewerPage({ objects }: { objects: CatalogSummaryItem[] }) {
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
          <button className="ghost-button" onClick={() => { void startFullRefresh(); }} disabled={refreshJob?.status === "queued" || refreshJob?.status === "running"}>
            {refreshJob?.status === "queued" || refreshJob?.status === "running" ? "Refreshing all…" : "Refresh all cached data"}
          </button>
          <Link className="ghost-button" to="/studio">Open building area</Link>
        </div>
      </div>

      <label className="field viewer-search-field">
        <span>Search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search reports and dashboards" />
      </label>

      <div className="viewer-grid">
        {filtered.map((object) => (
          <Link key={object.id} className="viewer-card" to={`/${object.type}/${object.id}`}>
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
  const { objects, tables, studioDocument } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const studioRoute = location.pathname.startsWith("/studio");
  const viewerRoute = location.pathname === "/viewer";
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;
  const hideSidebar = hosted.embed || studioRoute || readerRoute || viewerRoute;

  useEffect(() => {
    if (readerRoute) return;
    if (studioRoute) {
      document.title = `${platformName} · Building`;
      return;
    }
    if (viewerRoute || location.pathname === "/") {
      document.title = `${platformName} · Viewing`;
      return;
    }
    document.title = platformName;
  }, [location.pathname, platformName, readerRoute, studioRoute, viewerRoute]);

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""} ${readerFullScreen ? "reader-shell" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">{studioRoute ? "Building" : viewerRoute ? "Viewing" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <div className="topbar-nav">
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/studio">Building</NavLink>
              <NavLink className={({ isActive }) => `topbar-tab${isActive ? " active" : ""}`} to="/viewer">Viewing</NavLink>
            </div>
            <span className="badge">{hosted.mode === "viewer" ? "Full-screen view" : navLabel}</span>
            <span className="badge brand">{objects.length} saved views</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute || viewerRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>
        {hideSidebar ? null : (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>{navLabel}</strong>
              <span className="micro">Open a report or dashboard directly.</span>
            </div>
            <nav className="nav-list">
              {objects.map((object) => (
                <Link key={object.id} className="nav-card" to={`/${object.type}/${object.id}`}>
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
            <Route path="/" element={<Navigate to="/viewer" replace />} />
            <Route path="/viewer" element={<ViewerPage objects={objects} />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/:objectId" element={<StudioPage />} />
            <Route path="/:type/:objectId" element={<ObjectPage tables={tables} platformName={platformName} />} />
            <Route path="*" element={<Navigate to="/viewer" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
