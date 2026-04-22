import { Link } from "react-router-dom";
import { type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { ClearableInputField } from "./ClearableInputField";

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
  onDeleteSelectedReports
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
  onApplyTemplate: (template: StudioTemplateRecord) => void;
  onToggleReportSelection: (reportId: string, selected: boolean) => void;
  onSelectAllVisibleReports: () => void;
  onClearReportSelection: () => void;
  onDeleteSelectedReports: () => void;
}) {
  const visibleReports = filteredObjects.filter((object) => object.type === "report");
  const quickStartActions = [
    {
      id: "new-report",
      title: "Add new report",
      description: "Choose a table, fields, filters, and a report or chart view.",
      action: onCreateReport
    },
    {
      id: "new-dashboard",
      title: "Add new dashboard",
      description: "Start a dashboard canvas and add reports, charts, and summary cards.",
      action: onCreateDashboard
    },
    {
      id: "template",
      title: "Use a template",
      description: "Apply an existing dashboard or report structure.",
      action: onUseTemplate
    },
    {
      id: "import-xlsx",
      title: xlsxImporting ? "Importing xlsx" : "Import xlsx",
      description: "Reconstruct workbook sheets into reports and dashboards.",
      action: onImportXlsx,
      disabled: xlsxImporting
    }
  ];

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
          <button type="button" onClick={onSave} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
          <button type="button" onClick={onOpenSettings}>Settings</button>
        </div>
      </div>

      <section className="surface stack">
        <div className="card-head">
          <strong>Quick start</strong>
          <span className="micro">Use this row when you want to begin something new.</span>
        </div>
        <div className="studio-quickstart-grid">
          {quickStartActions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="template-card-button studio-quickstart-button"
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
            <strong>Browse workspace items</strong>
            <div className="micro">Pick an existing report or dashboard before entering the builder.</div>
          </div>
          {visibleReports.length ? (
            <div className="studio-actions">
              <span className="micro">{selectedReportIds.length} selected</span>
              <button type="button" className="ghost-button" onClick={onSelectAllVisibleReports}>Select visible reports</button>
              <button type="button" className="ghost-button" onClick={onClearReportSelection} disabled={!selectedReportIds.length}>Clear</button>
              <button type="button" onClick={onDeleteSelectedReports} disabled={!selectedReportIds.length}>Delete selected reports</button>
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
              <article
                key={object.id}
                className={`nav-card studio-home-object-card${object.type === "report" && selectedReportIds.includes(object.id) ? " is-selected" : ""}`}
              >
                <div className="studio-home-object-card-head">
                  <div className="studio-home-card-badges">
                    <span className="badge">{typeLabel(object.type)}</span>
                    <span className="badge">{object.scope === "personal" ? "Personal" : "Shared"}</span>
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
                    className="ghost-button"
                    to={buildHostedRoute(`/studio/${object.id}`)}
                    target={openLinksInNewTab ? "_blank" : undefined}
                    rel={openLinksInNewTab ? "noreferrer" : undefined}
                  >
                    Open
                  </Link>
                </div>
              </article>
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
