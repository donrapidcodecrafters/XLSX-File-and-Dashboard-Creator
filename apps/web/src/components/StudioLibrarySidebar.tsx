import { type ChangeEvent, type RefObject } from "react";
import { Link } from "react-router-dom";
import { type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { typeLabel } from "../lib/catalog";

type LibraryFilter = "all" | "report" | "dashboard";
type LibraryScopeFilter = "all" | "global" | "personal";

export function StudioLibrarySidebar({
  homeLabel,
  navigationLabel,
  openLinksInNewTab = false,
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
  activeObjectId,
  templates,
  xlsxImporting,
  importInputRef,
  importXlsxInputRef,
  onImportJsonChange,
  onImportXlsxChange,
  onApplyTemplate,
  onOpenCreateReport,
  onOpenCreateDashboard,
  onOpenTemplates
}: {
  homeLabel: string;
  navigationLabel: string;
  openLinksInNewTab?: boolean;
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
  activeObjectId?: string;
  templates: StudioTemplateRecord[];
  xlsxImporting: boolean;
  importInputRef: RefObject<HTMLInputElement>;
  importXlsxInputRef: RefObject<HTMLInputElement>;
  onImportJsonChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportXlsxChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onApplyTemplate: (template: StudioTemplateRecord) => void;
  onOpenCreateReport: () => void;
  onOpenCreateDashboard: () => void;
  onOpenTemplates: () => void;
}) {
  return (
    <aside className="studio-library">
      <div className="surface stack">
        <div className="studio-section-head">
          <div>
            <div className="eyebrow">{homeLabel}</div>
            <h2>{navigationLabel}</h2>
          </div>
          <div className="studio-actions">
            <button onClick={onOpenCreateReport}>New report</button>
            <button onClick={onOpenCreateDashboard}>New dashboard</button>
          </div>
        </div>
        <label className="field">
          <span>Search</span>
          <input
            id="studio-library-search"
            name="studioLibrarySearch"
            value={libraryQuery}
            onChange={(event) => onLibraryQueryChange(event.target.value)}
            placeholder="Search reports, dashboards, fields, tags"
          />
        </label>
        <div className="filter-grid compact-grid">
          <label className="field">
            <span>Type</span>
            <select
              id="studio-library-type"
              name="studioLibraryType"
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
              id="studio-library-scope"
              name="studioLibraryScope"
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
            <span>Personal objects stay out of the default library until you switch the scope filter.</span>
          </div>
        ) : null}
        <div className="nav-list">
          {filteredObjects.length ? filteredObjects.map((object) => (
            <Link
              key={object.id}
              className={`nav-card${object.id === activeObjectId ? " active-card" : ""}`}
              to={`/studio/${object.id}`}
              target={openLinksInNewTab ? "_blank" : undefined}
              rel={openLinksInNewTab ? "noreferrer" : undefined}
            >
              <span className="badge">{typeLabel(object.type)}</span>
              <span className="badge">{object.scope === "personal" ? "Personal" : "Shared"}</span>
              <strong>{object.name}</strong>
              <span className="micro">{object.folder} · {object.category}</span>
            </Link>
          )) : <div className="empty-hint">No reports or dashboards match this builder filter.</div>}
        </div>
      </div>

      <div className="surface stack">
        <div className="card-head">
          <strong>Templates</strong>
          <button onClick={onOpenTemplates}>Manage</button>
        </div>
        <div className="template-list">
          {templates.slice(0, 4).map((template) => (
            <button className="template-card-button" key={template.id} onClick={() => onApplyTemplate(template)}>
              <strong>{template.name}</strong>
              <span>{template.type}</span>
            </button>
          ))}
        </div>
        <div className="link-toolbar">
          <button onClick={() => importInputRef.current?.click()}>Import JSON</button>
          <button onClick={() => importXlsxInputRef.current?.click()} disabled={xlsxImporting}>{xlsxImporting ? "Importing xlsx…" : "Import xlsx"}</button>
        </div>
        <input ref={importInputRef} hidden type="file" accept="application/json" onChange={onImportJsonChange} />
        <input ref={importXlsxInputRef} hidden type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onImportXlsxChange} />
      </div>
    </aside>
  );
}
