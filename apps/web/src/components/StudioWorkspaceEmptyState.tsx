export function StudioWorkspaceEmptyState({
  loadingRemote,
  lastSavedAt,
  savingRemote,
  xlsxImporting,
  onSave,
  onCreateReport,
  onCreateDashboard,
  onImportXlsx,
  onUseTemplate,
  canCreate,
  canImport,
}: {
  loadingRemote: boolean;
  lastSavedAt?: string;
  savingRemote: boolean;
  xlsxImporting: boolean;
  onSave: () => void;
  onCreateReport: () => void;
  onCreateDashboard: () => void;
  onImportXlsx: () => void;
  onUseTemplate: () => void;
  canCreate?: boolean;
  canImport?: boolean;
}) {
  return (
    <div className="studio-canvas">
      <div className="hero studio-hero">
        <div>
          <span className="badge brand">Workspace</span>
          <h1>No reports or dashboards yet</h1>
          <p>Create a report or dashboard, import an existing setup, or apply a template. You should always be able to build from an empty workspace.</p>
          <div className="micro-row">
            <span>{loadingRemote ? "Loading saved workspace…" : "Workspace ready"}</span>
            <span>{lastSavedAt ? `Last saved ${new Date(lastSavedAt).toLocaleString()}` : "Not saved yet"}</span>
          </div>
        </div>
        <div className="link-toolbar">
          <button onClick={onSave} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save"}</button>
          {canCreate !== false && <button onClick={onCreateReport}>Create report</button>}
          {canCreate !== false && <button onClick={onCreateDashboard}>Create dashboard</button>}
          {canImport !== false && <button onClick={onImportXlsx} disabled={xlsxImporting}>{xlsxImporting ? "Importing xlsx…" : "Import xlsx"}</button>}
          {canCreate !== false && <button onClick={onUseTemplate}>Use template</button>}
        </div>
      </div>

      <section className="surface stack">
        <div className="card-head">
          <strong>Start here</strong>
          <span className="micro">Nothing is blocked just because the workspace is empty.</span>
        </div>
        <div className="summary-grid">
          {canCreate !== false && <button className="template-card-button" onClick={onCreateReport}>
            <strong>Create a report</strong>
            <span>Choose a table, fields, filters, and view.</span>
          </button>}
          {canCreate !== false && <button className="template-card-button" onClick={onCreateDashboard}>
            <strong>Create a dashboard</strong>
            <span>Start a blank dashboard and add report widgets.</span>
          </button>}
          {canCreate !== false && <button className="template-card-button" onClick={onUseTemplate}>
            <strong>Use a template</strong>
            <span>Apply a saved layout or report template.</span>
          </button>}
          {canImport !== false && <button className="template-card-button" onClick={onImportXlsx} disabled={xlsxImporting}>
            <strong>{xlsxImporting ? "Importing xlsx" : "Import xlsx"}</strong>
            <span>Reconstruct sheets as local reports and dashboards.</span>
          </button>}
        </div>
      </section>
    </div>
  );
}
