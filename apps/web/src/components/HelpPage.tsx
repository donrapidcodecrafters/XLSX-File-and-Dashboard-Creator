import { Link } from "react-router-dom";

// Keep this manual aligned with the current live product flow whenever labels,
// routes, builder steps, or reader behavior change.
const helpSections = [
  { id: "first-day", title: "First Day Setup", summary: "What to click the first time you open the platform" },
  { id: "admin-setup", title: "Admin Setup And Connected Apps", summary: "How to connect, bootstrap, and refresh Quickbase apps safely" },
  { id: "browse", title: "Browse And Open Content", summary: "How to find reports and dashboards quickly" },
  { id: "reports", title: "Use Reports And Charts", summary: "How to read, filter, focus, and export reports" },
  { id: "dashboards", title: "Use Dashboards", summary: "Tabs, filters, cards, and full-screen inspection" },
  { id: "studio", title: "Create And Edit In Studio", summary: "How to build reports, dashboards, and private items" },
  { id: "widgets", title: "Move And Resize Dashboard Cards", summary: "How to position cards cleanly without guessing" },
  { id: "multi-app", title: "Use Multiple Apps Together", summary: "How shared filters, labels, and mixed-app dashboards behave" },
  { id: "import-export", title: "Import And Export XLSX", summary: "How workbook reconstruction and export jobs work" },
  { id: "history", title: "History, Recovery, And Favorites", summary: "How to save views, restore versions, and keep your place" },
  { id: "fixes", title: "Common Fixes", summary: "What to check first when something looks wrong" }
];

export function HelpPage() {
  return (
    <section className="surface stack viewer-page help-page">
      <div className="hero viewer-hero">
        <div>
          <span className="badge brand">Help</span>
          <h1>Platform Manual</h1>
          <p>Everything here is written for a first-time business user and reflects the current live workflow. Use these links in order if you are new, or jump directly to the task you need.</p>
        </div>
        <div className="link-toolbar viewer-actions">
          <Link className="ghost-button" to="/">Home</Link>
          <Link className="ghost-button" to="/viewer">Browse content</Link>
          <Link className="ghost-button" to="/studio">Open building area</Link>
        </div>
      </div>

      <div className="card help-card help-nav-card">
        <div className="card-head">
          <strong>Quick Navigation</strong>
          <span className="micro">Use these links to move around the platform and this manual</span>
        </div>
        <div className="help-link-grid">
          <Link className="ghost-button" to="/">Go to Home</Link>
          <Link className="ghost-button" to="/viewer">Go to Viewing</Link>
          <Link className="ghost-button" to="/studio">Go to Building</Link>
          {helpSections.map((section) => (
            <a className="ghost-button" key={section.id} href={`#${section.id}`}>{section.title}</a>
          ))}
        </div>
      </div>

      <div className="help-grid">
        <article className="card help-card" id="first-day">
          <div className="card-head">
            <strong>First Day Setup</strong>
            <span className="micro">Start here if this is your first time</span>
          </div>
          <ol className="flat-list">
            <li>Open the platform from your Quickbase dashboard button. Do not try to start from an expired bookmarked tab.</li>
            <li>When the top bar appears, use `Home` if you want guided starting points, `Viewing` if you want to open existing work, or `Building` if you need to create something new.</li>
            <li>When you open `Building`, you now land on a workspace home first. The first large card shows the workspace status, and the `Quick start` row directly under it is the only place for `Add new report`, `Add new dashboard`, `Use a template`, and `Import xlsx`.</li>
            <li>If the page says the session expired, go back to Quickbase and launch again from the original button.</li>
            <li>If you only need to read reports or dashboards, stay in `Home` or `Viewing`. You do not need Studio for normal day-to-day use.</li>
          </ol>
        </article>

        <article className="card help-card" id="admin-setup">
          <div className="card-head">
            <strong>Admin Setup And Connected Apps</strong>
            <span className="micro">Only for setup or maintenance users</span>
          </div>
          <ol className="flat-list">
            <li>Open <Link to="/studio">Building</Link>, then open `Settings` only if you are responsible for connecting or maintaining Quickbase apps.</li>
            <li>Use the connected-app section to add a realm and app. The platform validates and bootstraps required support tables automatically before marking the app ready.</li>
            <li>Use `Find apps` when possible instead of typing raw IDs manually. This reduces setup mistakes for first-time admins.</li>
            <li>After setup, return ordinary users to <Link to="/">Home</Link> or <Link to="/viewer">Viewing</Link>. Normal business users should not need to work inside settings.</li>
          </ol>
        </article>

        <article className="card help-card" id="browse">
          <div className="card-head">
            <strong>Browse And Open Content</strong>
            <span className="micro">How to find what you need quickly</span>
          </div>
          <ol className="flat-list">
            <li>Open <Link to="/viewer">Viewing</Link> to search across saved reports and dashboards.</li>
            <li>Use `Scope` to switch between shared content and your personal items.</li>
            <li>Use the app badge on each card to confirm which connected Quickbase app the item belongs to.</li>
            <li>Use `Favorites` and `Recent` filters when the library gets large.</li>
            <li>Open a card directly from the viewer, or start at <Link to="/">Home</Link> if you prefer grouped sections and app-based browsing.</li>
          </ol>
        </article>

        <article className="card help-card" id="reports">
          <div className="card-head">
            <strong>Use Reports And Charts</strong>
            <span className="micro">How to read, filter, focus, and export reports</span>
          </div>
          <ol className="flat-list">
            <li>Open a report from <Link to="/viewer">Viewing</Link> or <Link to="/">Home</Link>.</li>
            <li>Check the freshness banner near the top of the page before sharing or exporting. This tells you whether you are looking at cached or live data.</li>
            <li>Use `Save view` to keep your own preferred page or focus mode without changing the shared report for everyone else.</li>
            <li>Use `Focus chart` or `Focus details` when you need a larger reading surface.</li>
            <li>Large report tables scroll inside the report itself. You should not need to scroll the entire page just to read more rows.</li>
            <li>Use `Download xlsx` to export the report you are currently viewing. Wait until the export status says the file is ready.</li>
          </ol>
        </article>

        <article className="card help-card" id="dashboards">
          <div className="card-head">
            <strong>Use Dashboards</strong>
            <span className="micro">Tabs, filters, cards, and reader behavior</span>
          </div>
          <ol className="flat-list">
            <li>Open a dashboard and start on the active tab. The platform loads the current tab first so the page appears quickly.</li>
            <li>Use the filter controls at the top of the dashboard to change the current view for the cards that match those filters.</li>
            <li>Use `Save view` if you want to keep your own tab/filter/focus combination as a personal bookmark.</li>
            <li>Use `Focus card` on any widget when you need to inspect that card in a larger dialog.</li>
            <li>Dashboard table cards scroll inside their own frame. If a card shows more rows than fit, scroll inside the card instead of the full page.</li>
            <li>Charts and reports are clipped to the size of each dashboard card. If a card needs more room, resize that card in Building rather than expecting the widget to overflow.</li>
          </ol>
        </article>

        <article className="card help-card" id="studio">
          <div className="card-head">
            <strong>Create And Edit In Studio</strong>
            <span className="micro">The safe building area for native platform objects</span>
          </div>
          <ol className="flat-list">
            <li>Open <Link to="/studio">Building</Link> to create or edit reports, dashboards, and workbook imports.</li>
            <li>Start on the Building home. Use the `Quick start` row below the top workspace card when you want to create something new, use a template, or import a workbook. Use the browse section underneath when you want to open an existing item.</li>
            <li>Click an existing item to edit it, or choose `Add new report`, `Add new dashboard`, `Templates`, or `Import xlsx` to start something new.</li>
            <li>Choose `Shared` if everyone should see the object, or `Personal` if the object should stay private to you.</li>
            <li>For reports, move through the builder in this order: basics, data, filters, view, review.</li>
            <li>For dashboards, save the starter dashboard first, then use the canvas to add tabs and cards.</li>
            <li>Click a dashboard card on the canvas to edit only that card. The selected-card inspector controls its report, size, position, display mode, and tab actions.</li>
            <li>Use Settings only when you need to connect or maintain apps. Normal building starts from the workspace home, not from Settings.</li>
          </ol>
        </article>

        <article className="card help-card" id="widgets">
          <div className="card-head">
            <strong>Move And Resize Dashboard Cards</strong>
            <span className="micro">Use the canvas without trial and error</span>
          </div>
          <ol className="flat-list">
            <li>Open a dashboard in <Link to="/studio">Building</Link> and click the card you want to change. The selected-card panel always edits only that card.</li>
            <li>Drag the card on the canvas to move it. The preview highlights the destination row and shows when other cards will reflow.</li>
            <li>Use the size controls in the selected-card area when you need exact width, height, or x/y placement.</li>
            <li>Widgets stay inside the card size you set. If a chart or report feels cramped, increase that card’s width or height instead of expecting it to overlap nearby cards.</li>
            <li>Use row actions such as `Balance row`, `Split evenly`, `Emphasize first`, or `Emphasize last` when you want a cleaner layout without manually adjusting every card.</li>
            <li>Use `Balance tab` or `Balance dashboard` after larger edits so cards fill rows cleanly and stay readable.</li>
          </ol>
        </article>

        <article className="card help-card" id="multi-app">
          <div className="card-head">
            <strong>Use Multiple Apps Together</strong>
            <span className="micro">How mixed-app reports and dashboards stay organized</span>
          </div>
          <ol className="flat-list">
            <li>Check the app badge on every report or dashboard card before opening it. That badge shows which connected Quickbase app owns the object.</li>
            <li>Use app filters in <Link to="/viewer">Viewing</Link> or the Studio library when many objects exist across several apps.</li>
            <li>Dashboards can mix widgets from multiple apps. Runtime filters only affect the cards whose source reports match the selected filter fields.</li>
            <li>If a widget on a mixed-app dashboard does not react to a filter, open the source report or the dashboard editor and confirm that the filter targets that report.</li>
          </ol>
        </article>

        <article className="card help-card" id="import-export">
          <div className="card-head">
            <strong>Import And Export XLSX</strong>
            <span className="micro">How workbook reconstruction and export jobs behave</span>
          </div>
          <ol className="flat-list">
            <li>Use `Import xlsx` inside <Link to="/studio">Building</Link> to reconstruct workbook sheets as editable platform objects.</li>
            <li>After import, read the import review carefully. It tells you which sheets were imported, what headers were repaired, and which layouts or filters were inferred.</li>
            <li>If a sheet was skipped or repaired, the review tells you exactly what changed. The platform does not silently hide substitutions.</li>
            <li>Exports reflect the current saved object and the current dashboard runtime filters.</li>
            <li>Dashboard exports preserve visuals, summaries, and warnings instead of flattening everything into raw rows only.</li>
          </ol>
        </article>

        <article className="card help-card" id="history">
          <div className="card-head">
            <strong>History, Recovery, And Favorites</strong>
            <span className="micro">How to keep track of work safely</span>
          </div>
          <ol className="flat-list">
            <li>Use `Favorite` on reports and dashboards you open often. Favorites appear in Home and Viewing.</li>
            <li>Use `Save view` inside report and dashboard readers to keep personal reading states such as filters, tabs, or focus modes.</li>
            <li>Use `History` inside Studio when you need to inspect or restore an earlier saved version of a shared object.</li>
            <li>Personal overrides do not overwrite the shared base object. They only change your own reading state.</li>
          </ol>
        </article>

        <article className="card help-card" id="fixes">
          <div className="card-head">
            <strong>Common Fixes</strong>
            <span className="micro">What to check first when something looks wrong</span>
          </div>
          <ol className="flat-list">
            <li>If content looks stale, use `Refresh now` on the current object or `Refresh all` from settings when you are responsible for the app cache.</li>
            <li>If a report, chart, or dashboard needs to load or refresh source rows before it can open, the platform shows a full-screen loading overlay with progress, lets you cancel the refresh, and opens the object automatically when the refresh completes.</li>
            <li>If a field is missing, reload the app metadata or refresh the source report cache so new Quickbase fields become available.</li>
            <li>If a dashboard widget fails, open the source report from Studio or the reader to isolate the problem.</li>
            <li>If you cannot find where to start building, go back to <Link to="/studio">Building</Link>. The first Building screen is the workspace home where you choose an existing item or create a new one.</li>
            <li>If the platform says the session expired, relaunch from Quickbase.</li>
            <li>If an imported workbook does not look right, read the import review, fix the workbook, and import again.</li>
          </ol>
        </article>
      </div>
    </section>
  );
}
