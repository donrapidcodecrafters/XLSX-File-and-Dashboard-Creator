import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { normalizeStudioDocument, type CatalogSummaryItem, type ReportDefinition, type StudioDocument, type StudioObject, type TableDefinition } from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { fetchCatalog, fetchObject, fetchTables, runReport } from "./lib/api";
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

  useEffect(() => {
    if (!params.objectId) return;
    let active = true;
    setLoading(true);
    fetchObject(params.objectId)
      .then((response) => {
        if (!active) return;
        setObject(response.object);
        if (response.object.type === "report") {
          return runReport(response.object.id).then((reportResult) => {
            if (active) setResult(reportResult);
          });
        }
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

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading report or dashboard…</div>;
  if (!object) return <div className="empty-page">That report or dashboard could not be found.</div>;

  if (object.type === "report") {
    const table = tables.find((item) => item.id === object.sourceTableId);
    return <ReportView report={object as ReportDefinition} table={table} result={result} loading={loading} />;
  }

  return <DashboardView dashboard={object} />;
}

export function App() {
  const { objects, tables, studioDocument } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const studioRoute = location.pathname.startsWith("/studio");
  const readerRoute = /^\/(report|dashboard)\//.test(location.pathname);
  const platformName = studioDocument?.branding.platformName || "Reporting Portal";
  const navLabel = studioDocument?.branding.navigationLabel || "Reports and Dashboards";
  const readerFullScreen = readerRoute || hosted.mode === "viewer" || hosted.embed;

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""} ${readerFullScreen ? "reader-shell" : ""}`}>
      {hosted.embed || readerRoute ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">{studioRoute ? "Workspace" : "Viewer"}</div>
            <h1>{platformName}</h1>
          </div>
          <div className="topbar-meta">
            <Link className="badge brand" to="/studio">Workspace</Link>
            <span className="badge">{hosted.mode === "viewer" ? "Full-screen view" : navLabel}</span>
            <span className="badge brand">{objects.length} saved views</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute || readerRoute ? "embed-layout" : ""} ${readerRoute ? "reader-layout" : ""}`}>
        {hosted.embed || studioRoute || readerRoute ? null : (
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
            <Route path="/" element={<Navigate to="/studio" replace />} />
            <Route path="/studio" element={<StudioPage />} />
            <Route path="/studio/:objectId" element={<StudioPage />} />
            <Route path="/:type/:objectId" element={<ObjectPage tables={tables} />} />
            <Route path="*" element={<Navigate to="/studio" replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
