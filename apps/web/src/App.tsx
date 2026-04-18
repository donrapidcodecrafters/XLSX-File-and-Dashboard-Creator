import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { normalizeStudioDocument, type CatalogSummaryItem, type ReportDefinition, type StudioDocument, type StudioObject, type TableDefinition } from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { fetchCatalog, fetchObject, fetchTables, runReport, runReportPage } from "./lib/api";
import { getHostedContext } from "./lib/embed";
import { fetchStudioDocument } from "./lib/studioApi";

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

function ObjectPage({ tables }: { tables: TableDefinition[] }) {
  const params = useParams();
  const [object, setObject] = useState<StudioObject | null>(null);
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 100;

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    setPage(1);
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
      document.title = object.name + " · Reporting Portal";
    }
  }, [object]);

  useEffect(() => {
    if (!object || object.type !== "report") return;
    let active = true;
    setLoading(true);
    const fetcher = page === 1 ? runReport(object.id) : runReportPage(object.id, page, pageSize);
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
  }, [object?.id, object?.type, page]);

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;

  if (object.type === "report") {
    const table = tables.find((item) => item.id === object.sourceTableId);
    return <ReportView report={object as ReportDefinition} table={table} result={result} loading={loading} currentPage={page} onPageChange={setPage} />;
  }

  return <DashboardView dashboard={object} tables={tables} />;
}

function ViewerPage({ objects }: { objects: CatalogSummaryItem[] }) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    if (!text) return objects;
    return objects.filter((object) =>
      [object.name, object.description, object.folder, object.category, object.tags.join(" ")].join(" ").toLowerCase().includes(text)
    );
  }, [objects, query]);

  return (
    <section className="surface stack viewer-page">
      <div className="hero">
        <div>
          <span className="badge brand">Viewing</span>
          <h1>Open Reports and Dashboards</h1>
          <p>Choose any saved report or dashboard to open it full screen with its live filters and navigation controls.</p>
        </div>
        <div className="link-toolbar">
          <Link className="ghost-button" to="/studio">Open building area</Link>
        </div>
      </div>

      <label className="field">
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
            <Route path="/:type/:objectId" element={<ObjectPage tables={tables} />} />
            <Route path="*" element={<Navigate to="/viewer" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
