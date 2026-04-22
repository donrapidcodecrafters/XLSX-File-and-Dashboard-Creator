import { Link } from "react-router-dom";
import { type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { typeLabel } from "../lib/catalog";

type LibraryFilter = "all" | "report" | "dashboard";
type LibraryScopeFilter = "all" | "global" | "personal";

export function StudioWorkspaceHome({
  loadingRemote,
  lastSavedAt,
  savingRemote,
  xlsxImporting,
  libraryQuery,
  onLibraryQueryChange,
  libraryFilter,
  onLibraryFilterChange,
  libraryScopeFilter,
  onLibraryScopeFilterChange,
  favoritesOnly,
  onFavoritesOnlyChange,
  recentOnly,
  onRecentOnlyChange,
  hasPersonalObjects,
  filteredObjects,
  templates,
  openLinksInNewTab = false,
  onSave,
  onCreateReport,
  onCreateDashboard,
  onImportXlsx,
  onUseTemplate,
  onApplyTemplate
}: {
  loadingRemote: boolean;
  lastSavedAt?: string;
  savingRemote: boolean;
  xlsxImporting: boolean;
  libraryQuery: string;
  onLibraryQueryChange: (value: string) => void;
  libraryFilter: LibraryFilter;
  onLibraryFilterChange: (value: LibraryFilter) => void;
  libraryScopeFilter: LibraryScopeFilter;
  onLibraryScopeFilterChange: (value: LibraryScopeFilter) => void;
  favoritesOnly: boolean;
  onFavoritesOnlyChange: (value: boolean) => void;
  recentOnly: boolean;
  onRecentOnlyChange: (value: boolean) => void;
  hasPersonalObjects: boolean;
  filteredObjects: StudioObject[];
  templates: StudioTemplateRecord[];
  openLinksInNewTab?: boolean;
  onSave: () => void;
  onCreateReport: () => void;
  onCreateDashboard: () => void;
  onImportXlsx: () => void;
  onUseTemplate: () => void;
  onApplyTemplate: (template: StudioTemplateRecord) => void;
}) {
  return (
    <div className="studio-canvas studio-workspace-home">
      <div className="hero studio-hero">
        <div>
          <span className="badge brand">Building</span>
          <h1>Reports, charts, graphs, and dashboards</h1>
          <p>Start by choosing an existing item, a template, or a new report or dashboard. Setup only appears after you pick what you want to build.</p>
          <div className="micro-row">
            <span>{loadingRemote ? "Loading saved workspace…" : "Workspace ready"}</span>
            <span>{lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : "Not saved yet"}</span>
          </div>
        </div>
        <div className="link-toolbar">
          <button onClick={onSave} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
          <button onClick={onCreateReport}>Add new report</button>
          <button onClick={onCreateDashboard}>Add new dashboard</button>
          <button onClick={onImportXlsx} disabled={xlsxImporting}>{xlsxImporting ? "Importing xlsx…" : "Import xlsx"}</button>
          <button onClick={onUseTemplate}>Templates</button>
        </div>
      </div>

      <section className="surface stack">
        <div className="card-head">
          <div>
            <strong>Browse workspace items</strong>
            <div className="micro">Pick an existing report or dashboard before entering the builder.</div>
          </div>
          <div className="studio-actions">
            <button type="button" onClick={onCreateReport}>New report</button>
            <button type="button" onClick={onCreateDashboard}>New dashboard</button>
          </div>
        </div>
        <div className="filter-grid compact-grid studio-home-filter-grid">
          <label className="field">
            <span>Search</span>
            <input
              id="studio-home-search"
              name="studioHomeSearch"
              value={libraryQuery}
              onChange={(event) => onLibraryQueryChange(event.target.value)}
              placeholder="Search reports, dashboards, fields, tags"
            />
          </label>
          <label className="field">
            <span>Type</span>
            <select
              id="studio-home-type"
              name="studioHomeType"
              value={libraryFilter}
              onChange={(event) => onLibraryFilterChange(event.target.value as LibraryFilter)}
            >
              <option value="all">All</option>
              <option value="report">Reports</option>
              <option value="dashboard">Dashboards</option>
            </select>
          </label>
          <label className="field">
            <span>Scope</span>
            <select
              id="studio-home-scope"
              name="studioHomeScope"
              value={libraryScopeFilter}
              onChange={(event) => onLibraryScopeFilterChange(event.target.value as LibraryScopeFilter)}
            >
              <option value="global">Shared</option>
              <option value="personal">Personal</option>
              <option value="all">Shared and personal</option>
            </select>
          </label>
          <label className="toggle-row"><input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesOnlyChange(event.target.checked)} /> Favorites</label>
          <label className="toggle-row"><input type="checkbox" checked={recentOnly} onChange={(event) => onRecentOnlyChange(event.target.checked)} /> Recent</label>
        </div>
        {libraryScopeFilter === "global" && hasPersonalObjects ? (
          <div className="sync-status sync-status-ok">
            <strong>Shared builder library</strong>
            <span>Personal items stay out of the default library until you switch the scope filter.</span>
          </div>
        ) : null}
        {filteredObjects.length ? (
          <div className="studio-home-object-grid">
            {filteredObjects.map((object) => (
              <Link
                key={object.id}
                className="nav-card studio-home-object-card"
                to={`/studio/${object.id}`}
                target={openLinksInNewTab ? "_blank" : undefined}
                rel={openLinksInNewTab ? "noreferrer" : undefined}
              >
                <div className="studio-home-card-badges">
                  <span className="badge">{typeLabel(object.type)}</span>
                  <span className="badge">{object.scope === "personal" ? "Personal" : "Shared"}</span>
                </div>
                <strong>{object.name}</strong>
                <span>{object.description || "Open this item to edit its setup, layout, and output."}</span>
                <span className="micro">{object.folder || "Workspace"} · {object.category || (object.type === "report" ? "Reporting" : "Dashboard")}</span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="empty-hint">No reports or dashboards match this filter. Create a new one or widen the search.</div>
        )}
      </section>

      <section className="surface stack">
        <div className="card-head">
          <div>
            <strong>Start from a template</strong>
            <div className="micro">Templates let you begin with a saved structure instead of starting blank.</div>
          </div>
          <button type="button" onClick={onUseTemplate}>Manage templates</button>
        </div>
        {templates.length ? (
          <div className="summary-grid">
            {templates.slice(0, 8).map((template) => (
              <button className="template-card-button" key={template.id} onClick={() => onApplyTemplate(template)}>
                <strong>{template.name}</strong>
                <span>{template.type}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-hint">No templates yet. Save a report or dashboard as a template once you have a layout you want to reuse.</div>
        )}
      </section>

      <section className="surface stack">
        <div className="card-head">
          <strong>Quick start</strong>
          <span className="micro">Choose how you want to begin.</span>
        </div>
        <div className="summary-grid">
          <button className="template-card-button" onClick={onCreateReport}>
            <strong>Create a report</strong>
            <span>Choose a table, fields, filters, and a report or chart view.</span>
          </button>
          <button className="template-card-button" onClick={onCreateDashboard}>
            <strong>Create a dashboard</strong>
            <span>Start a dashboard canvas and add reports, charts, and summary cards.</span>
          </button>
          <button className="template-card-button" onClick={onUseTemplate}>
            <strong>Use a template</strong>
            <span>Apply an existing dashboard or report structure.</span>
          </button>
          <button className="template-card-button" onClick={onImportXlsx} disabled={xlsxImporting}>
            <strong>{xlsxImporting ? "Importing xlsx" : "Import xlsx"}</strong>
            <span>Reconstruct workbook sheets into reports and dashboards.</span>
          </button>
        </div>
      </section>
    </div>
  );
}
