import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import type { CatalogSummaryItem, ReportDefinition, StudioObject, TableDefinition } from "@studio/shared";
import { DashboardView } from "./components/DashboardView";
import { ReportView } from "./components/ReportView";
import { StudioPage } from "./components/StudioPage";
import { fetchCatalog, fetchObject, fetchTables, runReport } from "./lib/api";
import { getHostedContext } from "./lib/embed";

function useCatalog() {
  const [objects, setObjects] = useState<CatalogSummaryItem[]>([]);
  const [tables, setTables] = useState<TableDefinition[]>([]);

  useEffect(() => {
    fetchCatalog().then((response) => setObjects(response.objects));
    fetchTables().then((response) => setTables(response.tables));
  }, []);

  return { objects, tables };
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
      document.title = object.name + " · Hosted Reporting Platform";
    }
  }, [object]);

  if (!params.objectId) return null;
  if (!object && loading) return <div className="empty-page">Loading object…</div>;
  if (!object) return <div className="empty-page">Object not found.</div>;

  if (object.type === "report") {
    const table = tables.find((item) => item.id === object.sourceTableId);
    return <ReportView report={object as ReportDefinition} table={table} result={result} loading={loading} />;
  }

  return <DashboardView dashboard={object} />;
}

export function App() {
  const { objects, tables } = useCatalog();
  const location = useLocation();
  const hosted = useMemo(() => getHostedContext(), [location.key]);
  const initial = objects[0];
  const studioRoute = location.pathname.startsWith("/studio");

  return (
    <div className={`app-shell ${hosted.embed ? "embed-shell" : ""}`}>
      {hosted.embed ? null : (
        <header className="topbar">
          <div>
            <div className="eyebrow">Hosted Reporting Platform</div>
            <h1>Studio Builder + Hosted Views</h1>
          </div>
          <div className="topbar-meta">
            <Link className="badge brand" to="/studio">Studio</Link>
            <span className="badge">{hosted.mode === "viewer" ? "Viewer" : "Builder shell"}</span>
            <span className="badge brand">{objects.length} objects</span>
          </div>
        </header>
      )}

      <div className={`main-layout ${hosted.embed || studioRoute ? "embed-layout" : ""}`}>
        {hosted.embed || studioRoute ? null : (
          <aside className="sidebar">
            <div className="sidebar-head">
              <strong>Objects</strong>
              <span className="micro">Every report and dashboard has its own link.</span>
            </div>
            <nav className="nav-list">
              {objects.map((object) => (
                <Link key={object.id} className="nav-card" to={`/${object.type}/${object.id}`}>
                  <span className="badge">{object.type}</span>
                  <strong>{object.name}</strong>
                  <span className="micro">{object.folder} · {object.category}</span>
                </Link>
              ))}
            </nav>
          </aside>
        )}

        <main className="content">
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
