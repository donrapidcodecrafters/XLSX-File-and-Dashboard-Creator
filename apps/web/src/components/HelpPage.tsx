import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildHostedRoute } from "../lib/embed";

const sections = [
  { id: "sign-in",       title: "Signing In",                 summary: "How to log in, sign out, and manage your session" },
  { id: "navigation",    title: "Navigating the Platform",    summary: "Home, Viewing, and Building — what each area is for" },
  { id: "home",          title: "The Home Page",              summary: "Status panel, recent items, and quick-access shortcuts" },
  { id: "viewing",       title: "Viewing & Browsing",         summary: "Find and open saved reports and dashboards" },
  { id: "read-reports",  title: "Reading Reports",            summary: "Filters, view modes, saved views, focus mode, and export" },
  { id: "read-dashboards", title: "Reading Dashboards",       summary: "Tabs, runtime filters, focus card, and export" },
  { id: "studio-home",   title: "The Building Area",          summary: "Studio workspace overview and quick-start actions" },
  { id: "create-report", title: "Create a Report",            summary: "Step-by-step walkthrough of every builder step" },
  { id: "data-sources",  title: "Choosing Data Sources",      summary: "Quickbase, Excel data, and linking multiple sources" },
  { id: "join-sources",  title: "Linking Multiple Sources",   summary: "How to combine two or more data sources in one report" },
  { id: "create-dashboard", title: "Create a Dashboard",      summary: "Building dashboards from scratch on the canvas" },
  { id: "canvas",        title: "Dashboard Canvas",           summary: "Move, resize, reorder, and balance cards" },
  { id: "import-xlsx",   title: "Importing Excel Files",      summary: "Both import modes and the recreate workbook feature" },
  { id: "connect-qb",    title: "Connecting Quickbase",       summary: "Admin setup, bootstrapping, and multi-app workspaces" },
  { id: "refresh",       title: "Refreshing Data",            summary: "Manual refresh, scheduled refresh, and automated email reports" },
  { id: "history",       title: "Version History & Recovery", summary: "Snapshots, restoring older versions, favorites, and saved views" },
  { id: "export",        title: "Exporting to Excel",         summary: "Export reports, dashboards, and individual cards" },
  { id: "fixes",         title: "Common Problems & Fixes",    summary: "What to check first when something looks wrong" },
];

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "32px 1fr", gap: "0.625rem", alignItems: "start" }}>
      <span style={{
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: 28, height: 28, borderRadius: "50%",
        background: "linear-gradient(135deg, rgba(13,124,102,0.15), rgba(13,124,102,0.08))",
        border: "1px solid rgba(13,124,102,0.22)",
        fontSize: "0.78rem", fontWeight: 800, color: "var(--brand-deep)",
        flexShrink: 0, marginTop: 1
      }}>
        {n}
      </span>
      <span style={{ fontSize: "0.95rem", lineHeight: 1.55, paddingTop: 3 }}>{children}</span>
    </div>
  );
}

function Tip({ children }: { children: ReactNode }) {
  return (
    <div className="sync-status sync-status-ok" style={{ marginTop: "0.25rem" }}>
      <strong>Tip</strong>
      <span>{children}</span>
    </div>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return (
    <div className="sync-status sync-status-warn" style={{ marginTop: "0.25rem" }}>
      <strong>Important</strong>
      <span>{children}</span>
    </div>
  );
}

function SectionHeading({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="card-head">
      <div>
        <strong style={{ fontSize: "1.1rem" }}>{title}</strong>
        <div className="micro" style={{ marginTop: 2 }}>{subtitle}</div>
      </div>
    </div>
  );
}

export function HelpPage() {
  function scrollTo(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="surface stack viewer-page help-page">
      <div className="help-layout">

        {/* ── Sidebar nav ── */}
        <aside className="card help-sidebar">
          <div className="help-sidebar-top">
            <div className="card-head">
              <div>
                <span className="badge brand">Help</span>
                <strong>Platform Manual</strong>
              </div>
              <span className="micro">Click any section to jump directly to it.</span>
            </div>
            <div className="help-sidebar-actions">
              <Link className="ghost-button btn-neutral" to={buildHostedRoute("/")}>Go to Home</Link>
              <Link className="ghost-button btn-system" to={buildHostedRoute("/viewer")}>Browse content</Link>
              <Link className="ghost-button btn-system" to={buildHostedRoute("/studio")}>Open Building</Link>
            </div>
          </div>
          <div className="help-sidebar-scroller">
            <nav className="help-sidebar-nav" aria-label="Manual sections">
              {sections.map((s) => (
                <button
                  key={s.id}
                  className="help-sidebar-link"
                  type="button"
                  onClick={() => scrollTo(s.id)}
                >
                  <strong>{s.title}</strong>
                  <span>{s.summary}</span>
                </button>
              ))}
            </nav>
          </div>
        </aside>

        {/* ── Content ── */}
        <div className="help-content">

          <div className="hero viewer-hero help-hero">
            <div>
              <span className="badge brand">Help</span>
              <h1>Platform Manual</h1>
              <p>
                Written for everyday business users with no technical background.
                Every feature is covered with step-by-step instructions.
                Use the sidebar on the left to jump to any section.
              </p>
            </div>
          </div>

          <div className="help-grid">

            {/* ── 1. Signing In ── */}
            <article className="card help-card" id="sign-in">
              <SectionHeading title="Signing In" subtitle="How to log in, sign out, and manage your session" />
              <div className="stack-compact">
                <Step n={1}>
                  Open the platform link in your browser. You will see a sign-in screen with two fields: <strong>Email address</strong> and <strong>Password</strong>.
                </Step>
                <Step n={2}>
                  Type your email address exactly as it was set up by your administrator. Emails are not case-sensitive.
                </Step>
                <Step n={3}>
                  Type your password. Passwords are case-sensitive — check Caps Lock if the login fails.
                </Step>
                <Step n={4}>
                  Click <strong>Sign in</strong>. The platform will open immediately if your credentials are correct.
                </Step>
                <Step n={5}>
                  To sign out, click <strong>Sign out</strong> in the top-right corner of the navigation bar. You will be returned to the sign-in screen right away.
                </Step>
                <Tip>Your session stays active for up to 12 hours of use. If you close the tab and return before the session expires, you will not need to sign in again.</Tip>
                <Warning>If you see "Authentication required," your session has expired. Click Sign in again and enter your credentials to continue.</Warning>
              </div>
            </article>

            {/* ── 2. Navigation ── */}
            <article className="card help-card" id="navigation">
              <SectionHeading title="Navigating the Platform" subtitle="Three main areas — Home, Viewing, and Building" />
              <div className="stack-compact">
                <Step n={1}>
                  The top bar always shows three navigation tabs: <strong>Home</strong>, <strong>Building</strong>, and <strong>Viewing</strong>. Click any tab to switch areas instantly.
                </Step>
                <Step n={2}>
                  <strong>Home</strong> — Your starting point. Shows a summary of the workspace status, recent items you opened, quick shortcuts to favorites, and links to all available reports and dashboards organized by category.
                </Step>
                <Step n={3}>
                  <strong>Viewing</strong> — A full searchable library of every shared report and dashboard you can access. Use this when you know what you want to open or when you want to browse.
                </Step>
                <Step n={4}>
                  <strong>Building</strong> — The creation area. Use this to build new reports and dashboards, import Excel files, connect data sources, and edit existing objects. Normal day-to-day readers do not need to go here.
                </Step>
                <Step n={5}>
                  The <strong>Help</strong> link is also in the top navigation bar. Click it any time to open this manual without losing your current page.
                </Step>
                <Tip>If you only need to read reports and dashboards, you can do everything from Home and Viewing. You never have to open Building unless you are creating or editing something.</Tip>
              </div>
            </article>

            {/* ── 3. Home Page ── */}
            <article className="card help-card" id="home">
              <SectionHeading title="The Home Page" subtitle="Status panel, recent items, and quick-access shortcuts" />
              <div className="stack-compact">
                <Step n={1}>
                  Open <Link to={buildHostedRoute("/")}>Home</Link> from the top navigation. The large hero panel at the top shows the platform name and a summary of what is available.
                </Step>
                <Step n={2}>
                  Below the hero panel you will see highlight cards showing the total number of reports, dashboards, and connected data sources — this gives you a quick sense of the workspace size.
                </Step>
                <Step n={3}>
                  The main content area is split into two columns. The left column shows your <strong>recently opened</strong> reports and dashboards. The right column shows quick actions and refreshed data summaries.
                </Step>
                <Step n={4}>
                  Click any report or dashboard card on the Home page to open it directly — no need to go to Viewing first.
                </Step>
                <Step n={5}>
                  Use the <strong>Refresh all</strong> button in the top bar to manually trigger a data refresh for all connected sources. A progress overlay will appear and close automatically when the refresh is complete.
                </Step>
                <Tip>The Home page is the fastest way to reopen something you looked at recently. Your last 10 opened items appear at the top of the left column.</Tip>
              </div>
            </article>

            {/* ── 4. Viewing & Browsing ── */}
            <article className="card help-card" id="viewing">
              <SectionHeading title="Viewing & Browsing" subtitle="Find and open saved reports and dashboards" />
              <div className="stack-compact">
                <Step n={1}>
                  Open <Link to={buildHostedRoute("/viewer")}>Viewing</Link> from the top navigation. A search box and filter controls appear at the top.
                </Step>
                <Step n={2}>
                  Type any part of a report or dashboard name in the search box. Results filter in real time as you type — no need to press Enter.
                </Step>
                <Step n={3}>
                  Use the <strong>Type</strong> filter to show only reports, only dashboards, or both.
                </Step>
                <Step n={4}>
                  Use the <strong>Scope</strong> filter to switch between <em>Shared</em> (visible to everyone) and <em>Personal</em> (visible only to you).
                </Step>
                <Step n={5}>
                  Use the <strong>Sort</strong> control to order results by name or by most recently updated.
                </Step>
                <Step n={6}>
                  Click any card to open that report or dashboard immediately.
                </Step>
                <Step n={7}>
                  Click the star icon on any card to add it to your <strong>Favorites</strong>. Favorites also appear on the Home page for fast access.
                </Step>
                <Tip>If a card shows an orange badge it means the data source may need a refresh. Click the card and look for the freshness banner near the top of the report or dashboard.</Tip>
              </div>
            </article>

            {/* ── 5. Reading Reports ── */}
            <article className="card help-card" id="read-reports">
              <SectionHeading title="Reading Reports" subtitle="Filters, view modes, saved views, focus mode, and export" />
              <div className="stack-compact">
                <Step n={1}>
                  Open any report from Home or Viewing. The report loads in full-page reader mode with a left sidebar showing view controls and actions.
                </Step>
                <Step n={2}>
                  Check the <strong>freshness banner</strong> near the top of the report. It tells you whether you are looking at data from today's refresh, a scheduled cache, or an older local copy.
                </Step>
                <Step n={3}>
                  If the report supports multiple views, you will see toggle buttons — <strong>Table</strong>, <strong>Summary</strong>, or <strong>Chart</strong>. Click a toggle to switch how the data is displayed.
                </Step>
                <Step n={4}>
                  Use <strong>Focus chart</strong> or <strong>Focus details</strong> buttons to expand either the chart or the data table to a larger full-screen overlay. Press <kbd>Escape</kbd> or click outside to return to the normal view.
                </Step>
                <Step n={5}>
                  Long reports scroll inside their own table frame. Scroll inside the table to see more rows — you do not need to scroll the full page.
                </Step>
                <Step n={6}>
                  Use the <strong>page navigation</strong> controls at the bottom of the table to move between pages of results.
                </Step>
                <Step n={7}>
                  Click <strong>Refresh this report</strong> in the sidebar to re-pull data for just this report from its connected source without refreshing the entire workspace.
                </Step>
                <Step n={8}>
                  Click <strong>Download xlsx</strong> to export the full report to an Excel file. A progress message will appear — wait until it says the file is ready, then click the download link.
                </Step>
                <Step n={9}>
                  Click <strong>Save view</strong> to save your current focus mode, page, and section layout as a personal bookmark. Saved views appear in the sidebar and do not change the shared report for other users.
                </Step>
                <Step n={10}>
                  Click the star icon in the report header to add this report to your Favorites for fast access from the Home page.
                </Step>
                <Tip>Saved views are personal. When you save a view it only saves for your account — other users see the same default layout they always did.</Tip>
                <Warning>If the report shows a warning that a field is missing, the Quickbase source has changed. Ask your administrator to refresh the source data so the new field becomes available.</Warning>
              </div>
            </article>

            {/* ── 6. Reading Dashboards ── */}
            <article className="card help-card" id="read-dashboards">
              <SectionHeading title="Reading Dashboards" subtitle="Tabs, runtime filters, focus card, and export" />
              <div className="stack-compact">
                <Step n={1}>
                  Open any dashboard from Home or Viewing. The active tab loads first so the page appears quickly even when the dashboard has many cards.
                </Step>
                <Step n={2}>
                  Click any <strong>tab button</strong> at the top of the dashboard to switch between tabs. Each tab contains its own set of report cards.
                </Step>
                <Step n={3}>
                  If the dashboard has <strong>filter controls</strong>, they appear above the cards. Use the dropdowns or input fields to narrow the data shown across all matching cards simultaneously.
                </Step>
                <Step n={4}>
                  Click the <strong>Focus card</strong> button on any card title to expand it into a full-screen overlay with more space for reading the chart or table.
                </Step>
                <Step n={5}>
                  Cards with tables scroll inside their own frame. Scroll inside a card to see more rows — do not scroll the full page.
                </Step>
                <Step n={6}>
                  Click <strong>Download xlsx</strong> in the header to export the full dashboard to a multi-sheet Excel file. Each tab becomes a separate sheet with charts, summaries, and data rows.
                </Step>
                <Step n={7}>
                  Click <strong>Save view</strong> to save your current tab, filter values, and focused card as a personal bookmark.
                </Step>
                <Step n={8}>
                  Click <strong>Refresh</strong> to reload data for all cards on the current dashboard tab.
                </Step>
                <Tip>If a card shows a loading spinner after you change a filter, the dashboard is re-running that report in the background. Wait a moment for the result to appear.</Tip>
              </div>
            </article>

            {/* ── 7. Building Area ── */}
            <article className="card help-card" id="studio-home">
              <SectionHeading title="The Building Area" subtitle="Studio workspace overview and quick-start actions" />
              <div className="stack-compact">
                <Step n={1}>
                  Open <Link to={buildHostedRoute("/studio")}>Building</Link> from the top navigation. You land on the <strong>workspace home</strong> — a single page that shows everything in the workspace and lets you take any action.
                </Step>
                <Step n={2}>
                  The <strong>Quick start</strong> row at the top of the workspace home shows four buttons: <strong>New report</strong>, <strong>New dashboard</strong>, <strong>Templates</strong>, and <strong>Import xlsx</strong>. These are the only starting points for creating new things.
                </Step>
                <Step n={3}>
                  Below the quick start row is a searchable grid of every existing report and dashboard. Use the search box and the Type and Scope filters to find what you want to edit.
                </Step>
                <Step n={4}>
                  Click any existing item card to open it in the builder. You can edit all its settings, rename it, change its fields, or delete it.
                </Step>
                <Step n={5}>
                  The <strong>Settings</strong> button in the top bar opens the platform settings panel where administrators can connect Quickbase apps, configure data refresh schedules, and manage export automations. Normal users do not need to open Settings.
                </Step>
                <Step n={6}>
                  The <strong>Refresh all</strong> button in the top bar triggers a manual refresh of all connected Quickbase data sources. A progress overlay shows the status and closes when complete.
                </Step>
                <Tip>You can also open an existing item for quick editing by clicking it in the library on the left side of the Building page — no need to go back to the workspace home.</Tip>
              </div>
            </article>

            {/* ── 8. Create a Report ── */}
            <article className="card help-card" id="create-report">
              <SectionHeading title="Create a Report" subtitle="Step-by-step walkthrough of every builder step" />
              <div className="stack-compact">
                <Step n={1}>
                  In <Link to={buildHostedRoute("/studio")}>Building</Link>, click <strong>New report</strong> in the quick-start row. A step-by-step builder panel opens on the right side of the screen.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Step 1 of 5 — Basics</div>
                <Step n={2}>
                  Type a <strong>Name</strong> for the report. Keep it short and descriptive — this is what users see in the Viewing library.
                </Step>
                <Step n={3}>
                  Optionally type a <strong>Description</strong> to explain what the report shows.
                </Step>
                <Step n={4}>
                  Choose <strong>Shared</strong> if everyone should see this report, or <strong>Personal</strong> if it should be private to your account only. You can change this later.
                </Step>
                <Step n={5}>
                  Click <strong>Data</strong> in the step bar to continue.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Step 2 of 5 — Data</div>
                <Step n={6}>
                  Use the <strong>Main source</strong> dropdown to choose which data source this report will read from. The dropdown lists every connected Quickbase table and every imported Excel source.
                </Step>
                <Step n={7}>
                  To combine data from more than one source, see the <em>Linking Multiple Sources</em> section below. For a single source, skip to the next step.
                </Step>
                <Step n={8}>
                  In the <strong>Fields</strong> panel, click the <strong>+</strong> button next to each field you want to include in the report. Fields appear in the left column (available) and move to the right column (selected). Drag to reorder them.
                </Step>
                <Step n={9}>
                  Optionally fill in <strong>Display labels</strong> to rename fields with friendlier column headers for your readers.
                </Step>
                <Step n={10}>
                  Click <strong>Filters</strong> in the step bar to continue.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Step 3 of 5 — Filters</div>
                <Step n={11}>
                  Click <strong>Add filter rule</strong> to restrict which rows appear. Choose a field, an operator (equals, contains, greater than, etc.), and a value.
                </Step>
                <Step n={12}>
                  To combine multiple filters, choose <strong>AND</strong> (all conditions must match) or <strong>OR</strong> (any condition can match) using the join toggle.
                </Step>
                <Step n={13}>
                  Use the <strong>Sort</strong> section to define default sort order. Choose a field and direction (A–Z or Z–A).
                </Step>
                <Step n={14}>
                  Click <strong>View</strong> in the step bar to continue.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Step 4 of 5 — View</div>
                <Step n={15}>
                  Choose a <strong>Report mode</strong>: Table (rows of data), Summary (totals/metrics), Chart (visual), Timeline, Calendar, or Kanban.
                </Step>
                <Step n={16}>
                  For <strong>Chart</strong> mode: choose the chart type (bar, line, pie, donut, area, and 30+ more), then pick which field goes on the X axis (category), which field goes on the Y axis (value), and what aggregation to use (count, sum, average, min, max).
                </Step>
                <Step n={17}>
                  For <strong>Table</strong> mode with a chart: toggle <em>Show chart in table</em> to display a mini chart above the rows on the same card.
                </Step>
                <Step n={18}>
                  Add <strong>Summary metrics</strong> if you want totals or averages displayed above the report (e.g., "Total claims: 1,240").
                </Step>
                <Step n={19}>
                  Click <strong>Review</strong> in the step bar to see a live preview of the report.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Step 5 of 5 — Review</div>
                <Step n={20}>
                  Check the preview on the right. If something looks wrong, click the step where the problem is and fix it. The preview updates in real time.
                </Step>
                <Step n={21}>
                  Click <strong>Create report</strong> at the bottom. The report is saved immediately and added to the workspace library.
                </Step>
                <Tip>You can edit any saved report at any time by clicking it in the Building workspace home.</Tip>
                <Warning>If the Create button is greyed out, the Review step will tell you exactly which required field is missing. Fix it and the button will become active.</Warning>
              </div>
            </article>

            {/* ── 9. Data Sources ── */}
            <article className="card help-card" id="data-sources">
              <SectionHeading title="Choosing Data Sources" subtitle="Quickbase tables, imported Excel data, and combined sources" />
              <div className="stack-compact">
                <Step n={1}>
                  Every report pulls its rows from one or more <strong>data sources</strong>. A source is either a Quickbase table (live or cached) or an Excel file that has been imported into the platform.
                </Step>
                <Step n={2}>
                  <strong>Quickbase sources</strong> — When your administrator connects a Quickbase app, all its tables become available in the source dropdown. Data is pulled and cached on a schedule so reports open instantly without waiting for Quickbase.
                </Step>
                <Step n={3}>
                  <strong>Excel data sources</strong> — Upload an Excel file using the <strong>Import xlsx</strong> button in Building. The rows in the file are stored permanently in the platform database. Reports referencing this source update instantly when you re-upload the file with the same source name.
                </Step>
                <Step n={4}>
                  <strong>Multiple combined sources</strong> — Select a main source in the report builder, then click <strong>+ Add source</strong> or <strong>+ Link [source name] as additional source</strong> to bring in a second table. See the <em>Linking Multiple Sources</em> section for full instructions.
                </Step>
                <Step n={5}>
                  The source you choose in Step 2 of the report builder controls which fields appear in the field picker. Switching the main source will clear any joined sources and reset your field selection.
                </Step>
                <Tip>If a source you need is not in the dropdown, ask your administrator to import the Excel file or connect the Quickbase app that contains it.</Tip>
              </div>
            </article>

            {/* ── 10. Linking Multiple Sources ── */}
            <article className="card help-card" id="join-sources">
              <SectionHeading title="Linking Multiple Sources" subtitle="Combine two or more data sources in one report or chart" />
              <div className="stack-compact">
                <Step n={1}>
                  In the report builder, go to the <strong>Data</strong> step. Choose your primary (main) data source from the <strong>Main source</strong> dropdown.
                </Step>
                <Step n={2}>
                  Below the main source picker, look for the <strong>+ Add source</strong> dropdown or a <strong>+ Link "[name]" as additional source</strong> button. Click it to add a second source.
                </Step>
                <Step n={3}>
                  A new <strong>Additional source card</strong> appears. It shows the name of the second source and asks: <em>How are these sources connected?</em>
                </Step>
                <Step n={4}>
                  Click <strong>Auto-detect</strong> — the platform will scan both sources and automatically suggest which columns match. If a column called "Claim Number" exists in both sources, for example, it will suggest that pair. Auto-detect can find multiple matching pairs at once.
                </Step>
                <Step n={5}>
                  If Auto-detect does not find a match (or finds the wrong one), click <strong>+ Add match column</strong> manually. Two dropdowns appear — the left one shows columns from the main source, the right one shows columns from the additional source. Pick the matching pair from each.
                </Step>
                <Step n={6}>
                  Repeat step 5 for each additional column pair that should match (e.g., match on Claim Number AND Member ID simultaneously for a stricter join).
                </Step>
                <Step n={7}>
                  Choose how unmatched rows are handled: <strong>Keep all rows from the main source</strong> (recommended — rows with no match get blank values from the additional source) or <strong>Only include rows that match in both sources</strong> (stricter — removes any main-source row that has no match).
                </Step>
                <Step n={8}>
                  Repeat steps 2–7 to add a third or fourth source if needed. Each additional source gets its own connection card.
                </Step>
                <Step n={9}>
                  The <strong>Fields</strong> picker below now shows columns from all sources combined. Fields from additional sources are labeled with their source name in parentheses, e.g., <em>Status (Claims DB)</em>. Select any combination of fields from any source.
                </Step>
                <Step n={10}>
                  Continue through Filters and View steps as normal. Filters and chart settings can reference fields from any linked source.
                </Step>
                <Tip>Auto-detect matches columns by name. If two columns mean the same thing but have different names (e.g., "Claim #" and "ClaimID"), use Add match column manually to define that pair.</Tip>
                <Warning>Changing the main source clears all linked sources and resets your field selection. Set the main source first before adding additional sources.</Warning>
              </div>
            </article>

            {/* ── 11. Create a Dashboard ── */}
            <article className="card help-card" id="create-dashboard">
              <SectionHeading title="Create a Dashboard" subtitle="Build dashboards from scratch on the canvas" />
              <div className="stack-compact">
                <Step n={1}>
                  In <Link to={buildHostedRoute("/studio")}>Building</Link>, click <strong>New dashboard</strong> in the quick-start row. A basics panel opens.
                </Step>
                <Step n={2}>
                  Type a <strong>Name</strong> and optional <strong>Description</strong>, choose <strong>Shared</strong> or <strong>Personal</strong> scope, then click <strong>Create dashboard</strong>. The empty dashboard canvas opens immediately.
                </Step>
                <Step n={3}>
                  The canvas starts with one empty tab. Click <strong>Add tab</strong> to create additional tabs. Click any tab name to rename it.
                </Step>
                <Step n={4}>
                  Click <strong>Add card</strong> (or the large "+" area on the empty canvas) to place your first report card on the current tab.
                </Step>
                <Step n={5}>
                  In the <em>Choose report</em> dialog, pick an existing report from the list. You can search by name. Click <strong>Add card</strong> to place it.
                </Step>
                <Step n={6}>
                  The card appears on the canvas. Click it to select it — the right panel shows size, position, display mode, and tab controls for that card.
                </Step>
                <Step n={7}>
                  Use the <strong>Display mode</strong> control in the right panel to choose whether this card shows a Table, Summary, or Chart — independently of the underlying report's default view.
                </Step>
                <Step n={8}>
                  Drag any card to reposition it. Drop it between other cards to insert it into that row.
                </Step>
                <Step n={9}>
                  Use the resize handle (bottom-right corner of each card) to make it wider or taller.
                </Step>
                <Step n={10}>
                  Add <strong>Runtime filters</strong> by clicking the filter icon in the dashboard toolbar. Runtime filters let readers narrow all cards simultaneously without needing to edit each report individually.
                </Step>
                <Step n={11}>
                  Click <strong>Save</strong> at any time to save your layout. Changes are not final until saved.
                </Step>
                <Tip>You can add the same report to a dashboard more than once — for example, showing the same report as a summary card on one tab and as a chart card on another tab.</Tip>
              </div>
            </article>

            {/* ── 12. Dashboard Canvas ── */}
            <article className="card help-card" id="canvas">
              <SectionHeading title="Dashboard Canvas" subtitle="Move, resize, reorder, and balance cards precisely" />
              <div className="stack-compact">
                <Step n={1}>
                  Open a dashboard in <Link to={buildHostedRoute("/studio")}>Building</Link> and click any card to select it. A blue border appears around the selected card and its controls appear in the right panel.
                </Step>
                <Step n={2}>
                  <strong>Move a card</strong> — Drag it by its title bar to any position. A drop indicator shows exactly where it will land. Release to place it.
                </Step>
                <Step n={3}>
                  <strong>Resize a card</strong> — Drag the small handle at the bottom-right corner. The card snaps to the grid in whole units. Alternatively, use the <em>Width</em> and <em>Height</em> number inputs in the right panel for exact sizes.
                </Step>
                <Step n={4}>
                  <strong>Move to a different tab</strong> — With the card selected, use the <em>Move to tab</em> control in the right panel to send it to another tab without dragging.
                </Step>
                <Step n={5}>
                  <strong>Row actions</strong> — Each row of cards has a row menu button (three dots) on the left. Click it to access: <em>Balance row</em> (equal widths), <em>Emphasize first</em> (first card wider), <em>Emphasize last</em> (last card wider), or <em>Split evenly</em>.
                </Step>
                <Step n={6}>
                  <strong>Balance tab</strong> — Click the <em>Balance tab</em> button in the dashboard toolbar to automatically distribute all cards on the current tab into clean equal rows.
                </Step>
                <Step n={7}>
                  <strong>Balance dashboard</strong> — Click the <em>Balance dashboard</em> button to apply the same balancing to every tab at once.
                </Step>
                <Step n={8}>
                  <strong>Delete a card</strong> — With the card selected, scroll to the bottom of the right panel and click <em>Remove card</em>. This removes the card from the dashboard but does not delete the underlying report.
                </Step>
                <Step n={9}>
                  Click <strong>Save</strong> to save all layout changes.
                </Step>
                <Tip>If a chart inside a card looks squeezed, increase the card height. Charts scale automatically to fill the card they are placed in.</Tip>
                <Warning>Dragging a card to a different tab requires holding and pausing over the tab button briefly before releasing. If it does not work on the first try, use the Move to tab control in the right panel instead.</Warning>
              </div>
            </article>

            {/* ── 13. Importing Excel ── */}
            <article className="card help-card" id="import-xlsx">
              <SectionHeading title="Importing Excel Files" subtitle="Two import modes and the recreate workbook feature" />
              <div className="stack-compact">
                <Step n={1}>
                  In <Link to={buildHostedRoute("/studio")}>Building</Link>, click <strong>Import xlsx</strong> in the quick-start row. An import dialog opens with two clearly labelled options.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Mode A — Data I want to report on</div>
                <Step n={2}>
                  Choose <strong>Data I want to report on</strong> when the Excel file contains rows of real data (sales records, claims, employee lists, etc.) that you want to build reports and charts from.
                </Step>
                <Step n={3}>
                  Give the source a <strong>Name</strong> so you can identify it later. Optionally enter a <strong>Source ID</strong> — if you leave it blank, one is generated automatically from the file name.
                </Step>
                <Step n={4}>
                  The <strong>Source ID</strong> is important for updates. If you re-upload a new version of the same file with the same Source ID, the old data is replaced instantly and all reports that use this source update automatically.
                </Step>
                <Step n={5}>
                  Toggle <strong>Recreate workbook structure</strong> ON if your workbook has a data tab (row data) AND separate chart or visualization tabs. The platform will import the data rows and automatically create matching reports and a dashboard that mirror the workbook's tab layout.
                </Step>
                <Step n={6}>
                  Toggle <strong>Recreate workbook structure</strong> OFF if you only want to import the data rows without creating any reports or dashboards automatically.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Mode B — Report template (Quickbase / Postgres)</div>
                <Step n={7}>
                  Choose <strong>Report template</strong> when the Excel file defines report or dashboard layouts, but the actual data will come from Quickbase or an already-imported Excel data source — not from the file itself.
                </Step>
                <Step n={8}>
                  With this mode, the platform reads chart definitions, field references, and layout from the workbook and creates the corresponding reports and dashboards. The data backing those reports comes from Quickbase or Postgres, not from the Excel file.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 4 }}>Completing the upload</div>
                <Step n={9}>
                  Drop your <strong>.xlsx file</strong> into the drop zone or click <em>click to browse</em> to choose it from your computer.
                </Step>
                <Step n={10}>
                  Click <strong>Import &amp; recreate workbook</strong> (or <em>Import data source</em> / <em>Import template</em> depending on your toggle selections). The upload and analysis runs automatically.
                </Step>
                <Step n={11}>
                  A confirmation message appears when the import is complete, summarizing what was created (number of data rows, reports, and dashboards). The new items appear immediately in the workspace library.
                </Step>
                <Tip>Only .xlsx files are supported. If you have an older .xls file, open it in Excel and save it as .xlsx first.</Tip>
                <Warning>Re-importing a file with the same Source ID immediately replaces ALL existing rows for that source. Every chart and dashboard that uses that source will update to show the new data. There is no undo — make sure the new file is correct before importing.</Warning>
              </div>
            </article>

            {/* ── 14. Connect Quickbase ── */}
            <article className="card help-card" id="connect-qb">
              <SectionHeading title="Connecting Quickbase" subtitle="Admin setup, bootstrapping, and multi-app workspaces" />
              <div className="stack-compact">
                <Step n={1}>
                  This section is for platform <strong>administrators</strong> only. Normal users do not need to connect apps.
                </Step>
                <Step n={2}>
                  Open <Link to={buildHostedRoute("/studio")}>Building</Link> and click <strong>Settings</strong> in the top bar. The Settings panel opens on the right.
                </Step>
                <Step n={3}>
                  In the <em>Connected apps</em> section, click <strong>Add app</strong>. A form appears asking for your Quickbase <strong>Realm hostname</strong> (e.g., mycompany.quickbase.com), your <strong>User token</strong>, and optionally an <strong>App token</strong>.
                </Step>
                <Step n={4}>
                  Click <strong>Find apps</strong> to automatically discover all apps in that realm. Select the one you want to connect. This is easier and less error-prone than typing App IDs manually.
                </Step>
                <Step n={5}>
                  Click <strong>Bootstrap</strong>. The platform validates the connection and creates any required support tables in Quickbase. A green status badge appears when the app is ready.
                </Step>
                <Step n={6}>
                  Configure which Quickbase tables and saved report IDs to pull during a refresh. Open the app profile, scroll to <em>Refresh sources</em>, and add the table IDs or Quickbase report IDs for each table you want cached.
                </Step>
                <Step n={7}>
                  Set a <strong>Refresh schedule</strong> — daily, weekly, or monthly — and the preferred time of day. The platform will automatically sync data from Quickbase on that schedule without any manual action.
                </Step>
                <Step n={8}>
                  Click <strong>Refresh now</strong> inside the app profile to trigger an immediate manual sync. A progress bar shows the status for each table being pulled.
                </Step>
                <Tip>If you need reports from two separate Quickbase apps in one workspace, add both apps in Settings. You can then build dashboards that show cards from both apps side by side.</Tip>
                <Warning>Do not delete a connected app profile while reports or dashboards reference it. Disconnect the app only after updating or removing all objects that use it.</Warning>
              </div>
            </article>

            {/* ── 15. Refreshing Data ── */}
            <article className="card help-card" id="refresh">
              <SectionHeading title="Refreshing Data" subtitle="Manual refresh, scheduled refresh, and automated email reports" />
              <div className="stack-compact">
                <strong style={{ fontSize: "0.9rem" }}>Manual refresh</strong>
                <Step n={1}>
                  Click <strong>Refresh all</strong> in the top bar of any page to immediately pull fresh data from all connected Quickbase sources. A progress overlay appears with a per-table status and estimated time remaining.
                </Step>
                <Step n={2}>
                  To refresh only the data for a single report or dashboard, open that item and click the <strong>Refresh this report</strong> button in its sidebar. This is faster than refreshing the entire workspace.
                </Step>
                <Step n={3}>
                  The freshness banner at the top of every report and dashboard tells you exactly when the data was last pulled. Green means fresh; orange means the cache is older than expected.
                </Step>

                <strong style={{ fontSize: "0.9rem", marginTop: "0.75rem", display: "block" }}>Scheduled refresh</strong>
                <Step n={4}>
                  Open <Link to={buildHostedRoute("/studio")}>Building</Link> → <strong>Settings</strong> and open an app profile. Set the <strong>Refresh schedule</strong> (daily, weekly, or monthly) and the <strong>time of day</strong>. The platform will automatically run the refresh at that time without any manual action.
                </Step>
                <Step n={5}>
                  Scheduled refreshes run in the background. Users working during a refresh will not see any interruption — they continue to see the last good cache until the new one completes, then the new data appears automatically.
                </Step>

                <strong style={{ fontSize: "0.9rem", marginTop: "0.75rem", display: "block" }}>Automated email reports</strong>
                <Step n={6}>
                  Administrators can schedule any report or dashboard to be emailed automatically as an Excel attachment. Open <strong>Settings</strong>, scroll to <em>Scheduled exports</em>, and click <strong>Add schedule</strong>.
                </Step>
                <Step n={7}>
                  Configure: the <strong>report or dashboard</strong> to export, a <strong>cron schedule</strong> (e.g., <em>every day at 7 AM</em>), the <strong>recipient email addresses</strong>, and the <strong>time zone</strong> the schedule should follow.
                </Step>
                <Step n={8}>
                  The platform runs the export on schedule, generates the Excel file in memory, and sends it via email as an attachment. Recipients do not need a platform account to receive the email.
                </Step>
                <Step n={9}>
                  Email delivery requires a SendGrid API key to be configured on the server. If you do not receive scheduled emails, ask your administrator to verify the SendGrid configuration.
                </Step>
                <Tip>Re-importing an Excel data source with the same Source ID automatically updates all reports that reference it — no manual refresh is needed for Excel-backed reports.</Tip>
              </div>
            </article>

            {/* ── 16. History & Recovery ── */}
            <article className="card help-card" id="history">
              <SectionHeading title="Version History & Recovery" subtitle="Snapshots, restoring older versions, favorites, and saved views" />
              <div className="stack-compact">
                <strong style={{ fontSize: "0.9rem" }}>Snapshots and version restore</strong>
                <Step n={1}>
                  While editing a report or dashboard in Building, click <strong>History</strong> (the clock icon in the top toolbar). A panel lists all saved snapshots of that object.
                </Step>
                <Step n={2}>
                  Click <strong>Create snapshot</strong> before making significant changes. Give the snapshot a short label like "Before filter change" so you can identify it later.
                </Step>
                <Step n={3}>
                  To restore an older version, find the snapshot in the History panel and click <strong>Restore</strong>. The object reverts to exactly how it was at the time of that snapshot.
                </Step>
                <Step n={4}>
                  Restoring a version does not delete the current version — it creates a new saved state. You can undo the restore by creating another snapshot first.
                </Step>

                <strong style={{ fontSize: "0.9rem", marginTop: "0.75rem", display: "block" }}>Favorites</strong>
                <Step n={5}>
                  Click the <strong>star icon</strong> on any report or dashboard card (in Viewing, Home, or Building) to add it to your favorites.
                </Step>
                <Step n={6}>
                  Favorites appear at the top of the Home page and can be filtered in Viewing. Click the star again to remove the favorite.
                </Step>

                <strong style={{ fontSize: "0.9rem", marginTop: "0.75rem", display: "block" }}>Saved views</strong>
                <Step n={7}>
                  Inside a report or dashboard reader, click <strong>Save view</strong> to bookmark your current combination of: focus mode, active tab, runtime filter values, and page number.
                </Step>
                <Step n={8}>
                  Give the saved view a short name. It appears in the sidebar of that report or dashboard under <em>Saved views</em>.
                </Step>
                <Step n={9}>
                  Saved views are personal — they only appear for your account and do not affect what other users see.
                </Step>
                <Tip>Snapshots are shared — any admin who opens the History panel can see and restore them. Create a snapshot before any large edit so the previous state is always recoverable.</Tip>
              </div>
            </article>

            {/* ── 17. Exporting ── */}
            <article className="card help-card" id="export">
              <SectionHeading title="Exporting to Excel" subtitle="Export reports, dashboards, and individual cards" />
              <div className="stack-compact">
                <Step n={1}>
                  Open any report or dashboard and look for the <strong>Download xlsx</strong> button in the sidebar or header.
                </Step>
                <Step n={2}>
                  Click <strong>Download xlsx</strong>. The export starts immediately in the background. A progress message appears — do not close the page while exporting.
                </Step>
                <Step n={3}>
                  When the progress says <em>Download ready</em>, click the download link that appears. Your browser will save the file to your Downloads folder.
                </Step>
                <Step n={4}>
                  <strong>Report exports</strong> include an Overview sheet with metadata (source, row count, applied filters), a Data sheet with all rows and correct column headers, and optionally a Summary sheet with charts and totals.
                </Step>
                <Step n={5}>
                  <strong>Dashboard exports</strong> produce a multi-sheet workbook. Each tab of the dashboard becomes its own sheet. Cards with charts include a chart image; cards with tables include all rows.
                </Step>
                <Step n={6}>
                  Exports always reflect the <strong>current saved state</strong> of the report or dashboard, including any runtime filters you applied before clicking Download.
                </Step>
                <Step n={7}>
                  You can also export from the Building page. Open a report or dashboard in the builder and click <strong>Export xlsx</strong> in the preview header.
                </Step>
                <Tip>Dashboard exports can take longer when the dashboard has many cards with large datasets. Leave the page open until you see "Download ready."</Tip>
                <Warning>If the export fails with an error, check whether the data source needs a refresh. An empty or stale cache can cause export errors for some chart types.</Warning>
              </div>
            </article>

            {/* ── 18. Common Fixes ── */}
            <article className="card help-card" id="fixes">
              <SectionHeading title="Common Problems & Fixes" subtitle="What to check first when something looks wrong" />
              <div className="stack-compact">

                <div className="empty-hint" style={{ fontWeight: 700 }}>Content looks outdated or stale</div>
                <Step n={1}>
                  Click <strong>Refresh this report</strong> (in the report/dashboard sidebar) or <strong>Refresh all</strong> (in the top bar) to pull fresh data. The freshness banner will update to show the new pull timestamp.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Report says "field not found" or a column is missing</div>
                <Step n={2}>
                  The Quickbase table was changed and a field was removed or renamed. Ask your administrator to re-run the data refresh — new field definitions will be pulled automatically. Then edit the report to remove or replace the missing field.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Report or chart shows no data</div>
                <Step n={3}>
                  Check the data source: is it a Quickbase source that has never been refreshed? Is it an Excel source that was not imported yet? Go to Building → Settings and check the refresh status for the connected app, or re-import the Excel file.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Dashboard card fails to load</div>
                <Step n={4}>
                  Click the source report name inside the failed card to open it in a full reader. The report reader will show a clearer error message. Fix any issues there first, then return to the dashboard.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Session expired or "Authentication required"</div>
                <Step n={5}>
                  Sign in again using your email and password. Your work is saved on the server — you will not lose any reports or dashboards.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Cannot find a report or dashboard</div>
                <Step n={6}>
                  Check the <strong>Scope</strong> filter in Viewing. If you are looking for a personal item, switch Scope to <em>Personal</em>. If it is a shared item someone else created, make sure Scope is set to <em>Shared</em>.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Import xlsx fails with an error</div>
                <Step n={7}>
                  Confirm the file is <strong>.xlsx format</strong> (not .xls, .csv, or .xlsm). Open it in Excel, choose <em>File → Save As</em>, and select <em>Excel Workbook (.xlsx)</em>. Then try the import again.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Multi-source join returns no rows</div>
                <Step n={8}>
                  The match columns may not share any common values. Go to Building, edit the report, open the Data step, and check the join conditions. Make sure both selected columns contain the same type of value (e.g., both are claim numbers, not one claim number and one member ID). Try adding a second match column if values look correct but nothing matches.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Scheduled email is not arriving</div>
                <Step n={9}>
                  Check your spam/junk folder first. If the email is not there, ask your administrator to verify the SendGrid API key and sender email in the server configuration.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>The platform is slow to open</div>
                <Step n={10}>
                  The first load after a server restart or a long idle period can take a few seconds while the server reconnects to the database. Subsequent page loads and report runs will be much faster once the server is warmed up.
                </Step>

                <div className="empty-hint" style={{ fontWeight: 700, marginTop: 8 }}>Cannot find Building or Settings</div>
                <Step n={11}>
                  Click <strong>Building</strong> in the top navigation bar. Settings is the gear icon or "Settings" button that appears in the top-right corner of the Building page — it is not shown on Home or Viewing.
                </Step>

                <Tip>For any other issue, use the <strong>Open Helpdesk Ticket</strong> button in the top navigation bar to submit a support request directly from within the platform.</Tip>
              </div>
            </article>

          </div>{/* end help-grid */}
        </div>{/* end help-content */}
      </div>{/* end help-layout */}
    </section>
  );
}
