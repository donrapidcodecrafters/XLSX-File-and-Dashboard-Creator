import { type ChangeEvent, type RefObject, useState } from "react";
import { Link } from "react-router-dom";
import { groupStudioLibraryItemsByFolder, type FolderDefinition, type StudioObject, type StudioTemplateRecord } from "@studio/shared";
import { buildFolderMap, resolveFolderName, typeLabel } from "../lib/catalog";
import { buildHostedRoute } from "../lib/embed";
import { useFolderCollapseState } from "../lib/folders";
import { ClearableInputField } from "./ClearableInputField";

const DRAG_OBJECT_ID_MIME = "application/x-studio-object-id";

type LibraryFilter = "all" | "report" | "dashboard";
type LibraryScopeFilter = "all" | "global" | "selected" | "personal";

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
  folders = [],
  onMoveToFolder,
  onCreateFolder,
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
  folders?: FolderDefinition[];
  onMoveToFolder?: (objectId: string, folderId: string) => void;
  onCreateFolder?: (name: string) => Promise<string | undefined>;
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
  const foldersById = buildFolderMap(folders);
  const { toggleFolder, isCollapsed } = useFolderCollapseState("studio-library");
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const { unfoldered, byFolderId } = groupStudioLibraryItemsByFolder(filteredObjects);

  function renderObjectCard(object: StudioObject) {
    return (
      <Link
        key={object.id}
        className={`nav-card${object.id === activeObjectId ? " active-card" : ""}`}
        to={buildHostedRoute(`/studio/${object.id}`)}
        target={openLinksInNewTab ? "_blank" : undefined}
        rel={openLinksInNewTab ? "noreferrer" : undefined}
        draggable={Boolean(onMoveToFolder)}
        onDragStart={(event) => { if (onMoveToFolder) event.dataTransfer.setData(DRAG_OBJECT_ID_MIME, object.id); }}
      >
        <span className="badge">{typeLabel(object.type)}</span>
        <span className="badge">{object.scope === "personal" ? "Personal" : object.scope === "selected" ? "Selected users" : "Shared"}</span>
        <strong>{object.name}</strong>
        <span className="micro">{[resolveFolderName(object.folderId, foldersById), object.category].filter(Boolean).join(" · ")}</span>
      </Link>
    );
  }

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
            {onCreateFolder ? <button onClick={() => setCreatingFolder(true)}>New folder</button> : null}
          </div>
        </div>
        {creatingFolder ? (
          <form
            className="filter-grid compact-grid"
            onSubmit={(event) => {
              event.preventDefault();
              const name = newFolderName.trim();
              if (name) void onCreateFolder?.(name);
              setNewFolderName("");
              setCreatingFolder(false);
            }}
          >
            <input
              autoFocus
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onBlur={() => { if (!newFolderName.trim()) setCreatingFolder(false); }}
              placeholder="Folder name"
            />
          </form>
        ) : null}
        <ClearableInputField
          label="Search"
          id="studio-library-search"
          name="studioLibrarySearch"
          value={libraryQuery}
          onChange={onLibraryQueryChange}
          placeholder="Search reports, dashboards, fields, tags"
        />
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
              <option value="global">Shared with everyone</option>
              <option value="selected">Shared with selected users</option>
              <option value="personal">Personal</option>
              <option value="all">All visible</option>
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
          {filteredObjects.length ? (
            <>
              {Object.keys(byFolderId).map((folderId) => {
                const collapsed = isCollapsed(folderId);
                return (
                  <div key={folderId}>
                    <button
                      type="button"
                      className="nav-accordion-folder"
                      onClick={() => toggleFolder(folderId)}
                      onDragOver={(event) => { if (onMoveToFolder) event.preventDefault(); }}
                      onDrop={(event) => {
                        const objectId = event.dataTransfer.getData(DRAG_OBJECT_ID_MIME);
                        if (objectId) onMoveToFolder?.(objectId, folderId);
                      }}
                    >
                      <span className="nav-accordion-group-chevron">{collapsed ? "▸" : "▾"}</span>
                      <span>{foldersById[folderId]?.name || "Untitled folder"}</span>
                      <span className="nav-accordion-group-count">{byFolderId[folderId].length}</span>
                    </button>
                    {!collapsed && byFolderId[folderId].map(renderObjectCard)}
                  </div>
                );
              })}
              {unfoldered.map(renderObjectCard)}
            </>
          ) : <div className="empty-hint">No reports or dashboards match this builder filter.</div>}
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
