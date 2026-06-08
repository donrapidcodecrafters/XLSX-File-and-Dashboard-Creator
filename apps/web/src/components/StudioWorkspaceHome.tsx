import { Link } from "react-router-dom";
import { type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { ClearableInputField } from "./ClearableInputField";

type LibraryFilter = "all" | "report" | "dashboard";
type LibraryScopeFilter = "all" | "global" | "selected" | "personal";
type LibrarySort = "name-asc" | "name-desc" | "updated-desc" | "updated-asc";

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
  selectedReportIds,
  templates,
  openLinksInNewTab = false,
  onSave,
  onOpenSettings,
  onCreateReport,
  onCreateDashboard,
  onImportXlsx,
  onUseTemplate,
  onApplyTemplate,
  onToggleReportSelection,
  onSelectAllVisibleReports,
  onClearReportSelection,
  onDeleteSelectedReports,
  librarySort,
  onLibrarySortChange,
  canCreate,
  canImport,
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
  selectedReportIds: string[];
  templates: StudioTemplateRecord[];
  openLinksInNewTab?: boolean;
  onSave: () => void;
  onOpenSettings: () => void;
  onCreateReport: () => void;
  onCreateDashboard: () => void;
  onImportXlsx: () => void;
  onUseTemplate: () => void;
  canCreate?: boolean;
  canImport?: boolean;
  onApplyTemplate: (template: StudioTemplateRecord) => void;
  onToggleReportSelection: (reportId: string, selected: boolean) => void;
  onSelectAllVisibleReports: () => void;
  onClearReportSelection: () => void;
  onDeleteSelectedReports: () => void;
  librarySort?: LibrarySort;
  onLibrarySortChange?: (value: LibrarySort) => void;
}) {
  const visibleReports = filteredObjects.filter((object) => object.type === "report");
  const quickStartActions = [
    ...(canCreate !== false ? [{
      id: "new-report",
      title: "Create a new report",
      description: "Pick a data source, choose your fields and filters, and display results as a table or chart.",
      action: onCreateReport,
      semanticClass: ""
    }] : []),
    ...(canCreate !== false ? [{
      id: "new-dashboard",
      title: "Create a new dashboard",
      description: "Build a canvas that combines multiple reports, charts, and summary numbers in one view.",
      action: onCreateDashboard,
      semanticClass: ""
    }] : []),
    ...(canCreate !== false ? [{
      id: "template",
      title: "Start from a template",
      description: "Use a saved report or dashboard layout as your starting point instead of building from scratch.",
      action: onUseTemplate,
      semanticClass: ""
    }] : []),
    ...(canImport !== false ? [{
      id: "import-xlsx",
      title: xlsxImporting ? "Importing Excel file…" : "Import Excel file",
      description: "Upload an Excel workbook and convert its sheets into reports and dashboards automatically.",
      action: onImportXlsx,
      disabled: xlsxImporting,
      semanticClass: ""
    }] : []),
  ];

  return (
    <div className="studio-canvas studio-workspace-home">
      <div className="hero studio-hero" style={{ background: "var(--surface)", border: "1px solid var(--border)", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
        <div>
          <span className="badge brand">Building</span>
          <h1>Your Reporting Workspace</h1>
          <p>Create and edit reports, dashboards, and data connections. Choose an existing item below to edit it, or use the quick-start buttons to create something new.</p>
          <div className="micro-row">
            {lastSavedAt ? <span>Last saved {new Date(lastSavedAt).toLocaleString()}</span> : null}
          </div>
        </div>
        <div className="link-toolbar">
          <button type="button" onClick={onSave} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
          <button type="button" onClick={onOpenSettings}>Settings</button>
        </div>
      </div>

      <section className="surface stack">
        <div className="card-head">
          <strong>What would you like to do?</strong>
          <span className="micro">Choose an option to get started. You can edit or delete anything you create later.</span>
        </div>
        <div className="studio-quickstart-grid">
          {quickStartActions.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`template-card-button studio-quickstart-button${item.semanticClass ? ` ${item.semanticClass}` : ""}`}
              onClick={item.action}
              disabled={item.disabled}
            >
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="surface stack">
        <div className="card-head">
          <div>
            <strong>Your reports and dashboards</strong>
            <div className="micro">Click any item to open and edit it.</div>
          </div>
          {visibleReports.length ? (
            <div className="studio-actions">
              <span className="micro">{selectedReportIds.length} selected</span>
              <button type="button" className="ghost-button" onClick={onSelectAllVisibleReports}>Select visible reports</button>
              <button type="button" className="ghost-button" onClick={onClearReportSelection} disabled={!selectedReportIds.length}>Clear</button>
              <button type="button" className="btn-danger" onClick={onDeleteSelectedReports} disabled={!selectedReportIds.length}>Delete selected reports</button>
            </div>
          ) : null}
        </div>
        <div className="filter-grid compact-grid studio-home-filter-grid">
          <ClearableInputField
            label="Search"
            id="studio-home-search"
            name="studioHomeSearch"
            value={libraryQuery}
            onChange={onLibraryQueryChange}
            placeholder="Search reports, dashboards, fields, tags"
          />
          <label className="field">
            <span>Type</span>
            <select
              id="studio-home-type"
              name="studioHomeType"
              value={libraryFilter}
              onChange={(event) => onLibraryFilterChange(event.target.value as LibraryFilter)}
            >
              <option value="all">All types</option>
              <option value="report">Reports only</option>
              <option value="dashboard">Dashboards only</option>
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
              <option value="global">Shared with everyone</option>
              <option value="selected">Shared with selected users</option>
              <option value="personal">Personal</option>
              <option value="all">All visible</option>
            </select>
          </label>
          <label className="toggle-row"><input type="checkbox" checked={favoritesOnly} onChange={(event) => onFavoritesOnlyChange(event.target.checked)} /> Favorites</label>
          <label className="toggle-row"><input type="checkbox" checked={recentOnly} onChange={(event) => onRecentOnlyChange(event.target.checked)} /> Recent</label>
          {onLibrarySortChange ? (
            <label className="field">
              <span>Sort</span>
              <select value={librarySort || "updated-desc"} onChange={(e) => onLibrarySortChange(e.target.value as LibrarySort)}>
                <option value="updated-desc">Last updated</option>
                <option value="updated-asc">Oldest first</option>
                <option value="name-asc">Name A–Z</option>
                <option value="name-desc">Name Z–A</option>
              </select>
            </label>
          ) : null}
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
              <article
                key={object.id}
                className={`nav-card studio-home-object-card${object.type === "report" && selectedReportIds.includes(object.id) ? " is-selected" : ""}`}
              >
                <div className="studio-home-object-card-head">
                  <div className="studio-home-card-badges">
                    <span className="badge">{typeLabel(object.type)}</span>
                    <span className="badge">{object.scope === "personal" ? "Personal" : object.scope === "selected" ? "Selected users" : "Shared"}</span>
                  </div>
                  {object.type === "report" ? (
                    <label className="toggle-row studio-home-select-toggle">
                      <input
                        type="checkbox"
                        checked={selectedReportIds.includes(object.id)}
                        onChange={(event) => onToggleReportSelection(object.id, event.target.checked)}
                      />
                      Select
                    </label>
                  ) : null}
                </div>
                <strong>{object.name}</strong>
                <span>{object.description || "Open this item to edit its setup, layout, and output."}</span>
                <span className="micro">{object.folder || "Workspace"} · {object.category || (object.type === "report" ? "Reporting" : "Dashboard")}</span>
                <div className="studio-home-object-card-actions">
                  <Link
                    className="ghost-button btn-system"
                    to={buildHostedRoute(`/studio/${object.id}`)}
                  >
                    Open
                  </Link>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-hint" style={{ textAlign: "center", padding: "2rem" }}>
            {libraryQuery ? (
              <>
                <p>No results match your search — try different keywords or clear the search.</p>
              </>
            ) : (
              <>
                <p>Nothing here yet.</p>
                <div className="micro-row" style={{ justifyContent: "center", marginTop: "0.75rem", gap: "0.5rem" }}>
                  <button type="button" onClick={onCreateReport}>Create a report</button>
                  <button type="button" onClick={onCreateDashboard}>Create a dashboard</button>
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="surface stack">
        <div className="card-head">
          <div>
            <strong>Start from a template</strong>
            <div className="micro">Templates let you begin with a saved structure instead of starting blank.</div>
          </div>
        </div>
        {templates.length ? (
          <div className="summary-grid">
            {templates.slice(0, 8).map((template) => (
              <button type="button" className="template-card-button" key={template.id} onClick={() => onApplyTemplate(template)}>
                <strong>{template.name}</strong>
                <span>{template.type}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-hint">No templates yet. Save a report or dashboard as a template once you have a layout you want to reuse.</div>
        )}
      </section>
    </div>
  );
}
