import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildHostedRoute } from "../lib/embed";

const sections = [
  { id: "sign-in",         title: "Signing In & 2FA",              summary: "How to log in, set up Microsoft Authenticator, account lockout, and sign out" },
  { id: "initial-setup",   title: "Initial Setup Guide",           summary: "First-time admin setup: branding, Quickbase, data, email, and users" },
  { id: "accept-invite",   title: "Accepting an Invitation",       summary: "What to do when you receive an invitation email" },
  { id: "navigation",      title: "Navigating the Platform",       summary: "Topbar tabs, sidebar links, settings, refresh, and your account menu" },
  { id: "data-sources",    title: "Data Sources",                  summary: "Importing Excel files, updating existing workbooks, and managing your data" },
  { id: "create-report",   title: "Creating a Report",             summary: "Complete step-by-step walkthrough: Basics → Data → Filters → View → Review" },
  { id: "create-dashboard","title": "Creating a Dashboard",        summary: "Building dashboards and adding report cards to the canvas" },
  { id: "viewing",         title: "Viewing Reports & Dashboards",  summary: "Finding, filtering, exporting, and interacting with content" },
  { id: "scheduled-emails","title": "Scheduled Email Reports",     summary: "Automatically email reports and dashboards on a schedule" },
  { id: "user-management", title: "Managing Users",                summary: "Inviting users, managing roles, notifications, and resetting passwords" },
  { id: "roles",           title: "Roles & Permissions",           summary: "Built-in roles, custom roles, and what each role can do" },
  { id: "settings",        title: "Platform Settings",             summary: "Branding, Quickbase connection, data refresh, email, storage, and saving" },
  { id: "troubleshooting", title: "Common Problems & Fixes",       summary: "Account lockout, sign-in issues, missing data, and import errors" },
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
      }}>{n}</span>
      <span style={{ fontSize: "0.95rem", lineHeight: 1.6, paddingTop: 3 }}>{children}</span>
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

function Note({ children }: { children: ReactNode }) {
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

function Sub({ children }: { children: ReactNode }) {
  return <p style={{ margin: "0.5rem 0 0.25rem", fontWeight: 700, fontSize: "0.9rem", color: "var(--text)" }}>{children}</p>;
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
              <span className="micro">Click any section to jump to it.</span>
            </div>
            <div className="help-sidebar-actions">
              <Link className="ghost-button btn-neutral" to={buildHostedRoute("/")}>Home</Link>
              <Link className="ghost-button btn-system" to={buildHostedRoute("/viewer")}>Browse reports</Link>
              <Link className="ghost-button btn-system" to={buildHostedRoute("/studio")}>Builder</Link>
            </div>
          </div>
          <div className="help-sidebar-scroller">
            <nav className="help-sidebar-nav" aria-label="Manual sections">
              {sections.map((s) => (
                <button key={s.id} className="help-sidebar-link" type="button" onClick={() => scrollTo(s.id)}>
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
              <p>Complete step-by-step instructions for every feature. Written for everyday business users — no technical background needed. Use the sidebar to jump to any section.</p>
            </div>
          </div>

          <div className="help-grid">

            {/* ── 1. Signing In & 2FA ── */}
            <article className="card help-card" id="sign-in">
              <SectionHeading title="Signing In & Two-Factor Authentication" subtitle="How to log in with email, password, and Microsoft Authenticator" />
              <div className="stack-compact">
                <Sub>First-time sign-in (2FA setup required)</Sub>
                <Step n={1}>Open the platform in your browser. You will see the sign-in screen with <strong>Email address</strong> and <strong>Password</strong> fields.</Step>
                <Step n={2}>Enter your email address and password, then click <strong>Continue →</strong>.</Step>
                <Step n={3}>Because it is your first sign-in, a QR code setup screen appears. Open <strong>Microsoft Authenticator</strong> on your phone.</Step>
                <Step n={4}>In Microsoft Authenticator, tap the <strong>+</strong> button → <strong>Other account (Google, Facebook, etc.)</strong>.</Step>
                <Step n={5}>Point your camera at the QR code shown on the screen. The account is added to Authenticator automatically.</Step>
                <Step n={6}>Authenticator immediately shows a 6-digit code that changes every 30 seconds. Click <strong>I've scanned the code →</strong> on the platform.</Step>
                <Step n={7}>Enter the 6-digit code from Authenticator and click <strong>Verify &amp; sign in →</strong>. You are now signed in.</Step>
                <Tip>Can't scan the QR code? Click <strong>"Can't scan?"</strong> on the setup screen to reveal a manual entry key you can type into Authenticator.</Tip>

                <Sub>Returning sign-in</Sub>
                <Step n={1}>Enter your email and password, then click <strong>Continue →</strong>.</Step>
                <Step n={2}>Open Microsoft Authenticator on your phone and find the 6-digit code for this platform.</Step>
                <Step n={3}>Enter the code and click <strong>Sign in →</strong>. Codes refresh every 30 seconds — enter whichever code is currently shown.</Step>

                <Sub>Account lockout</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>After <strong>5 consecutive failed sign-in attempts</strong>, your account is locked for <strong>15 minutes</strong>. You will see a message on the sign-in screen telling you how many minutes remain. After 15 minutes the lock clears automatically and you can try again. If you need access sooner, ask your administrator to unlock your account from the Users page.</p>

                <Sub>Signing out</Sub>
                <Step n={1}>Click <strong>Sign out</strong> in the top-right corner of the top navigation bar.</Step>
                <Step n={2}>You are immediately returned to the sign-in screen. Your session data is cleared.</Step>

                <Sub>Your account settings (display name, dark mode, 2FA)</Sub>
                <Step n={1}>Click your <strong>name or initials</strong> in the top navigation bar (top-right area) to open your account settings drawer.</Step>
                <Step n={2}>Here you can change your <strong>display name</strong>, toggle <strong>dark mode</strong>, and manage your 2FA setup.</Step>

                <Note>Sessions expire automatically after a period of inactivity set by your administrator (default: 24 hours). You will see a warning before expiry with an option to stay signed in.</Note>
              </div>
            </article>

            {/* ── 2. Initial Setup Guide ── */}
            <article className="card help-card" id="initial-setup">
              <SectionHeading title="Initial Setup Guide" subtitle="First-time administrator setup — follow these steps in order" />
              <div className="stack-compact">
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>When the platform is first deployed, complete these steps in order to get everything running. You must have the <strong>Admin</strong> or <strong>Developer</strong> role.</p>

                <Sub>Step 1 — Set branding</Sub>
                <Step n={1}>Go to <strong>Settings</strong> (sidebar or topbar when in Building). The settings wizard opens.</Step>
                <Step n={2}>On <strong>Step 1 — Branding</strong>, set your <strong>Platform name</strong>, <strong>Navigation label</strong>, and <strong>Home label</strong> to match your organization.</Step>
                <Step n={3}>Set the <strong>Session timeout</strong> (hours of inactivity before sign-out) and <strong>Idle grace period</strong> (minutes of idle before the countdown starts).</Step>
                <Step n={4}>Click <strong>Next: Connect Quickbase →</strong> or click <strong>✓ Save settings to server</strong> at the bottom to save.</Step>

                <Sub>Step 2 — Connect Quickbase (skip if using Excel only)</Sub>
                <Step n={5}>On <strong>Step 2 — Connect Quickbase</strong>, enter your <strong>Quickbase website address</strong> (e.g. yourcompany.quickbase.com) and your <strong>personal access token</strong> (found in Quickbase under My Profile → Manage User Tokens).</Step>
                <Step n={6}>Click <strong>Load my apps</strong>, then select your app from the dropdown that appears.</Step>
                <Step n={7}>Click <strong>Connect and load tables</strong>. The platform reads your Quickbase table list.</Step>

                <Sub>Step 3 — Configure data refresh</Sub>
                <Step n={8}>On <strong>Step 3 — Data Refresh</strong>, check the boxes next to each Quickbase table you want to sync into the database.</Step>
                <Step n={9}>For each selected table, enter the <strong>saved report number</strong> from Quickbase (or leave blank to sync all records) and choose the <strong>key field</strong> (the unique identifier for each row).</Step>
                <Step n={10}>Enable the scheduled refresh and choose a cadence (daily, weekly, or monthly) and time.</Step>
                <Step n={11}>Click <strong>Refresh all now</strong> to do the first data pull immediately.</Step>

                <Sub>Step 4 — Set up email delivery (optional)</Sub>
                <Step n={12}>On <strong>Step 4 — Email Reports</strong>, configure your SendGrid API key and sender email address if you want to send scheduled reports by email.</Step>

                <Sub>Step 5 — Invite users</Sub>
                <Step n={13}>Go to <strong>Users</strong> in the sidebar, click <strong>+ Invite user</strong>, enter the person's email, choose a role, and click <strong>Send invitation</strong>. They will receive an email to set up their account.</Step>

                <Sub>Step 6 — Import Excel data (optional)</Sub>
                <Step n={14}>Go to <strong>Data Sources</strong> in the sidebar and click <strong>+ Import XLSX</strong> to upload Excel files as data sources for your reports.</Step>

                <Tip>You can save and return to Settings any time. All settings are stored in the database and persist across server restarts and deployments.</Tip>
              </div>
            </article>

            {/* ── 3. Accepting an Invitation ── */}
            <article className="card help-card" id="accept-invite">
              <SectionHeading title="Accepting an Invitation" subtitle="What to do when you receive an invitation email" />
              <div className="stack-compact">
                <Step n={1}>Check your email for an invitation from the platform. The subject line will say <strong>"You've been invited to join"</strong> the platform.</Step>
                <Step n={2}>Click the <strong>Accept invitation →</strong> button in the email. A setup page opens in your browser.</Step>
                <Step n={3}>You will see your email address, your assigned role, and two fields: <strong>Your name</strong> and <strong>Choose a password</strong>.</Step>
                <Step n={4}>Enter your full name in the <strong>Your name</strong> field.</Step>
                <Step n={5}>Enter a password of at least 8 characters in <strong>Choose a password</strong>, then repeat it in <strong>Confirm password</strong>.</Step>
                <Step n={6}>Click <strong>Set up my account</strong>. Your account is created and you are signed in automatically.</Step>
                <Step n={7}>You will then be prompted to set up Microsoft Authenticator for 2FA — follow the on-screen QR code instructions (see <strong>Signing In</strong> above).</Step>
                <Tip>Invitation links expire after 7 days. If yours has expired, ask your administrator to resend it from the Users management page.</Tip>
              </div>
            </article>

            {/* ── 4. Navigation ── */}
            <article className="card help-card" id="navigation">
              <SectionHeading title="Navigating the Platform" subtitle="The top navigation bar, left sidebar, and what each section is for" />
              <div className="stack-compact">
                <Sub>Top navigation bar</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>The bar across the top of every page contains the main navigation. On the left: the platform name. In the middle: <strong>Home</strong>, <strong>Building</strong>, and <strong>Viewing</strong> tabs to switch between the main sections. On the right: action buttons.</p>
                <Step n={1}><strong>Home</strong> — Your landing page with quick stats and recent items.</Step>
                <Step n={2}><strong>Building</strong> — Create and edit reports and dashboards. Also shows <strong>Refresh all</strong> and <strong>Settings</strong> buttons in the topbar when active.</Step>
                <Step n={3}><strong>Viewing</strong> — Browse and open all reports and dashboards you have access to.</Step>
                <Step n={4}><strong>Refresh all</strong> — Available on Home, Building, and Viewing. Pulls the latest data from all configured Quickbase tables into the database. Reports update immediately after.</Step>
                <Step n={5}><strong>Help Ticket</strong> — Opens a helpdesk ticket form in a popup (only visible if your administrator has configured the helpdesk integration in Settings).</Step>
                <Step n={6}><strong>Help</strong> — Opens this page.</Step>
                <Step n={7}><strong>Dark mode toggle</strong> (moon/sun icon) — Switches between light and dark themes. Your preference is saved in your browser.</Step>
                <Step n={8}><strong>Your name/initials</strong> — Click to open your account settings drawer where you can change your display name, toggle dark mode, and manage 2FA.</Step>
                <Step n={9}><strong>Users</strong> — Visible to admins and developers only. Opens the user management page.</Step>
                <Step n={10}><strong>Sign out</strong> — Immediately ends your session and returns to the sign-in screen.</Step>

                <Sub>Left sidebar</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>The left sidebar is always present. Hover over it to expand labels. Click the <strong>pin</strong> button at the top to keep it expanded permanently.</p>
                <Step n={11}><strong>Home / Viewing / Building</strong> — Same as the topbar tabs.</Step>
                <Step n={12}><strong>Reports &amp; Dashboards</strong> accordion — Expand to see a scrollable list of all your content, grouped by Dashboards then Reports. Click any item to open it directly.</Step>
                <Step n={13}><strong>Data Sources</strong> — View, import, rename, and delete Excel data files.</Step>
                <Step n={14}><strong>Scheduled Reports</strong> — Manage automated email delivery of reports (admins only).</Step>
                <Step n={15}><strong>Users</strong> — Invite and manage platform users (admins and developers only).</Step>
                <Step n={16}><strong>Roles</strong> — Create and manage permission roles (admins and developers only).</Step>
                <Step n={17}><strong>Settings</strong> — Platform configuration: branding, Quickbase, data refresh, email, and more.</Step>
                <Step n={18}><strong>Help</strong> — This page.</Step>
              </div>
            </article>

            {/* ── 5. Data Sources ── */}
            <article className="card help-card" id="data-sources">
              <SectionHeading title="Data Sources" subtitle="Importing Excel files, updating existing workbooks, and managing data" />
              <div className="stack-compact">
                <Sub>Importing an Excel file</Sub>
                <Step n={1}>Go to <strong>Data Sources</strong> in the sidebar.</Step>
                <Step n={2}>Click <strong>+ Import XLSX</strong> in the top-right corner. The import dialog opens.</Step>
                <Step n={3}><strong>Choose what is in the file:</strong><br />
                  <strong>"The file contains my data"</strong> — Rows of information (sales records, employee lists, claims, etc.) you want to report on.<br />
                  <strong>"The file defines report layouts"</strong> — A workbook that shows how reports should look, using data already in the platform (chart tabs define the layout).
                </Step>
                <Step n={4}><strong>Auto-create reports and dashboard toggle</strong> — When on (default), the platform reads any chart tabs in your workbook and automatically creates matching reports and a dashboard. Turn this off to import only the raw data rows.</Step>
                <Step n={5}><strong>Choose which workbook this file belongs to</strong> — Click the dropdown to see your existing workbooks. Select one to update it with new data, or select <strong>+ Add new workbook</strong> to create a new one. If no workbooks exist yet, it defaults to creating a new one.</Step>
                <Step n={6}>If creating a new workbook, type a name in the <strong>workbook name</strong> field that appears (e.g. "Sales Data", "Claims Report"). Use a descriptive name — you will select it by name on future imports.</Step>
                <Step n={7}>Drag your <strong>.xlsx file</strong> onto the drop zone, or click to browse and select it. A preview shows the file's sheet names, row count, and column names.</Step>
                <Step n={8}>Click the import button. The file uploads and data is stored in the database. All reports using this source update automatically.</Step>
                <Tip>When you re-import data into an existing workbook, ALL rows are replaced with the new file's contents. Columns added or removed in the new file are reflected immediately — no manual reconfiguration needed.</Tip>

                <Sub>Managing data sources</Sub>
                <Step n={9}>Go to <strong>Data Sources</strong>. A table lists all imported sources with row counts, column counts, and last-updated dates.</Step>
                <Step n={10}>To <strong>rename</strong> a source, click the pencil icon next to its name, type the new name, and press Enter.</Step>
                <Step n={11}>To <strong>preview</strong> the data, click the source name to see the first rows and all column names.</Step>
                <Step n={12}>To <strong>clear data only</strong> (keep the source entry but remove all rows), click the <strong>Clear data</strong> button.</Step>
                <Step n={13}>To <strong>permanently delete</strong> a source and all its data, click <strong>Delete</strong> and confirm. Reports using this source will stop working.</Step>
                <Note>Only .xlsx files are supported. Files must have column headers in the first row of each sheet. Maximum recommended file size is 25 MB.</Note>
              </div>
            </article>

            {/* ── 6. Creating a Report ── */}
            <article className="card help-card" id="create-report">
              <SectionHeading title="Creating a Report" subtitle="Complete step-by-step walkthrough: Basics → Data → Filters → View → Review" />
              <div className="stack-compact">
                <Step n={1}>Go to <strong>Building</strong> in the topbar or sidebar, then click <strong>Create a new report</strong>.</Step>

                <Sub>Step 1 — Basics</Sub>
                <Step n={2}><strong>Mode</strong> — Choose how data is displayed: <em>table</em> (rows and columns), <em>chart</em> (visual graph), <em>metric</em> (single number card), <em>pivot</em> (cross-tab), or others.</Step>
                <Step n={3}><strong>Record title field</strong> — Search for and select the field that identifies each record (e.g. "Customer Name" or "Order ID"). Used as the clickable title when detail rows are shown.</Step>
                <Step n={4}><strong>Decimal places</strong> — How many decimal places to show for number fields.</Step>
                <Step n={5}><strong>Show summary metrics</strong> — Toggle on to display calculated summary values (sum, count, average, etc.) above the report.</Step>
                <Step n={6}><strong>Include detail rows</strong> — Toggle on to show individual data rows. Toggle off for aggregate/summary-only reports.</Step>
                <Step n={7}><strong>Include chart above table</strong> — Toggle on to show a chart above the data table.</Step>
                <Step n={8}>Click <strong>Next</strong>.</Step>

                <Sub>Step 2 — Data</Sub>
                <Step n={9}><strong>Data source</strong> — Select which imported data source (Excel workbook or Quickbase table) powers this report.</Step>
                <Step n={10}><strong>Fields to show</strong> — Check which columns from the data source appear in the report. Drag to reorder.</Step>
                <Step n={11}><strong>Grouping</strong> — Optionally group rows by a field (e.g. group by "Department" to see totals per department).</Step>
                <Step n={12}><strong>Sorting</strong> — Choose a field to sort by and direction (ascending or descending).</Step>
                <Step n={13}>Click <strong>Next</strong>.</Step>

                <Sub>Step 3 — Filters</Sub>
                <Step n={14}>Click <strong>Add filter</strong>, choose a field, choose a condition (equals, contains, greater than, etc.), and enter a value. All filter conditions must be true for a row to appear.</Step>
                <Step n={15}>Add as many filters as needed. Click <strong>Next</strong>.</Step>

                <Sub>Step 4 — View</Sub>
                <Step n={16}><strong>Summary metrics</strong> — If you enabled summary metrics, click <strong>Add summary metric</strong>, choose a field, and choose the calculation (Sum, Count, Average, Minimum, Maximum, Count rows).</Step>
                <Step n={17}><strong>Chart settings</strong> — If your mode includes a chart, configure the X-axis field, Y-axis field, chart type (bar, line, pie, etc.), and color options.</Step>
                <Step n={18}>Click <strong>Next</strong>.</Step>

                <Sub>Step 5 — Review</Sub>
                <Step n={19}>Review and edit the report <strong>name</strong> (click to edit), description, folder, and sharing settings.</Step>
                <Step n={20}><strong>Sharing</strong> — Choose who can see this report: <em>Shared with everyone</em> (all users), <em>Specific users or roles</em> (select individuals), or <em>Personal</em> (only you).</Step>
                <Step n={21}>Click <strong>Create report</strong>. The report is saved and opens immediately.</Step>

                <Tip>You can edit any report at any time by opening it in the Building area and clicking <strong>Edit report</strong> in the toolbar at the bottom.</Tip>
              </div>
            </article>

            {/* ── 7. Creating a Dashboard ── */}
            <article className="card help-card" id="create-dashboard">
              <SectionHeading title="Creating a Dashboard" subtitle="Building dashboards and adding report cards to a tabbed canvas" />
              <div className="stack-compact">
                <Step n={1}>Go to <strong>Building</strong> in the topbar or sidebar, then click <strong>Create a new dashboard</strong>.</Step>
                <Step n={2}>Give the dashboard a name, description, folder, and sharing settings. Click <strong>Create dashboard</strong>.</Step>
                <Step n={3}>The dashboard canvas opens. Click <strong>Add report/graph</strong> in the toolbar.</Step>
                <Step n={4}>A panel opens. Choose an existing report from the list, or create a new one on the spot. Select a <strong>display size</strong> (small, medium, large, or full width) and click <strong>Add</strong>.</Step>
                <Step n={5}>The report card appears on the canvas. Repeat to add more cards.</Step>
                <Step n={6}>To <strong>reorganize cards</strong>, drag them by their header. Resize them using the size controls on each card.</Step>
                <Step n={7}>Dashboards support <strong>tabs</strong>. Click <strong>Dashboard settings</strong> in the toolbar to add, rename, or reorder tabs. Move cards between tabs by editing each card.</Step>
                <Step n={8}>Click <strong>Save to server</strong> in the toolbar to save your changes.</Step>
                <Tip>Click any report card in the dashboard to expand it to full-screen focus mode. Press Escape or click the back arrow to return to the dashboard.</Tip>
              </div>
            </article>

            {/* ── 8. Viewing Reports & Dashboards ── */}
            <article className="card help-card" id="viewing">
              <SectionHeading title="Viewing Reports & Dashboards" subtitle="Finding, filtering, exporting, and interacting with content" />
              <div className="stack-compact">
                <Sub>Finding content</Sub>
                <Step n={1}>Go to <strong>Viewing</strong> in the topbar or sidebar. All reports and dashboards you have access to appear as cards.</Step>
                <Step n={2}>Use the <strong>Search</strong> field to search by name, description, folder, or tag.</Step>
                <Step n={3}>Use the <strong>Type</strong> filter to show only Reports or only Dashboards.</Step>
                <Step n={4}>Use the <strong>Access</strong> filter to show only global (everyone), shared with specific people, or personal items.</Step>
                <Step n={5}>Toggle <strong>Favorites only</strong> or <strong>Recently opened</strong> to narrow results further.</Step>
                <Step n={6}>Click any card to open that report or dashboard.</Step>

                <Sub>Interacting with a report</Sub>
                <Step n={7}>When viewing a report, use the <strong>filter controls</strong> at the top to change what data appears. Changes apply instantly.</Step>
                <Step n={8}>Click <strong>Open full-screen</strong> to expand the report to fill your screen. Press Escape to return.</Step>
                <Step n={9}>Click <strong>Focus details</strong> to expand the data table; <strong>Focus chart</strong> to expand the chart.</Step>
                <Step n={10}>Click <strong>Save view</strong> to save your current filter/sort settings as a named view. Load any saved view from the list that appears.</Step>
                <Step n={11}>Click <strong>Export</strong> to download the report as an Excel file.</Step>

                <Sub>Interacting with a dashboard</Sub>
                <Step n={12}>Click any tab at the top of the dashboard to switch between tab sections.</Step>
                <Step n={13}>Click any report card to expand it to focus mode. Press Escape to return.</Step>
                <Step n={14}>Click <strong>Export</strong> to export the entire dashboard or individual cards to Excel or image.</Step>

                <Tip>Star/favorite a report or dashboard by clicking the <strong>Favorite</strong> button in the report toolbar. Favorites appear first when you filter by Favorites only.</Tip>
              </div>
            </article>

            {/* ── 9. Scheduled Email Reports ── */}
            <article className="card help-card" id="scheduled-emails">
              <SectionHeading title="Scheduled Email Reports" subtitle="Automatically email reports and dashboards to recipients on a schedule" />
              <div className="stack-compact">
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>Scheduled email delivery is managed in two places: the <strong>Scheduled Reports</strong> page (accessible from the sidebar) and <strong>Settings → Email Reports</strong> (Step 4). Both show the same list — use whichever is most convenient.</p>

                <Sub>Creating a new scheduled email</Sub>
                <Step n={1}>Go to <strong>Scheduled Reports</strong> in the sidebar (admins only). Click <strong>+ Set up a new scheduled email</strong>.</Step>
                <Step n={2}><strong>Which report or dashboard?</strong> — Choose the report or dashboard to deliver from the dropdown.</Step>
                <Step n={3}><strong>Frequency</strong> — Choose how often to send: <em>Hourly</em>, <em>Daily</em>, <em>Weekly</em>, or <em>Monthly</em>.</Step>
                <Step n={4}><strong>Time</strong> — Choose the hour of day to send (in your selected timezone).</Step>
                <Step n={5}><strong>Day</strong> (weekly/monthly) — Choose which day of the week or which day of the month.</Step>
                <Step n={6}><strong>Timezone</strong> — Select the timezone for scheduling.</Step>
                <Step n={7}><strong>Recipients</strong> — Enter one email address per line.</Step>
                <Step n={8}>Toggle <strong>Start sending right away</strong> to activate immediately, or leave off to save as paused.</Step>
                <Step n={9}>Click <strong>Set up scheduled email</strong> to save.</Step>

                <Sub>Managing scheduled emails</Sub>
                <Step n={10}>Each configured schedule shows in the list with report name, schedule summary, recipients, last sent, and next send time.</Step>
                <Step n={11}>Click <strong>Send test</strong> to immediately send a test email to all recipients.</Step>
                <Step n={12}>Click <strong>Edit</strong> to change any setting.</Step>
                <Step n={13}>Click <strong>Pause</strong> to temporarily stop sending. Click <strong>Resume</strong> to restart.</Step>
                <Step n={14}>Click <strong>Remove</strong> to permanently delete the schedule.</Step>

                <Note>Scheduled emails require SendGrid to be configured in Settings → Email Reports. If not set up, contact your administrator.</Note>
              </div>
            </article>

            {/* ── 10. Managing Users ── */}
            <article className="card help-card" id="user-management">
              <SectionHeading title="Managing Users" subtitle="Inviting users, managing roles, system notifications, and resetting passwords" />
              <div className="stack-compact">
                <Sub>Inviting a new user</Sub>
                <Step n={1}>Go to <strong>Users</strong> in the sidebar or topbar (admins and developers only).</Step>
                <Step n={2}>Click <strong>+ Invite user</strong> in the top-right corner.</Step>
                <Step n={3}>Enter the new user's <strong>email address</strong>. This must be their real email — the invitation link is sent here.</Step>
                <Step n={4}>Optionally enter their <strong>display name</strong> (shown in the platform).</Step>
                <Step n={5}>Choose a <strong>role</strong>: Viewer, Editor, or Admin. See the Roles section below for what each can do.</Step>
                <Step n={6}>Click <strong>Send invitation</strong>. An email is sent immediately with a link that expires in 7 days.</Step>
                <Step n={7}>The invitation appears in the <strong>Pending invitations</strong> table until accepted.</Step>

                <Sub>Pending invitations</Sub>
                <Step n={8}>Pending invitations show the email, role, and expiry date.</Step>
                <Step n={9}>Click <strong>↺ Resend</strong> to send a fresh invitation email (resets the 7-day expiry).</Step>
                <Step n={10}>Click <strong>✕ Cancel</strong> to remove the invitation so it can no longer be accepted.</Step>

                <Sub>Managing existing users</Sub>
                <Step n={11}>All accepted users appear in the <strong>All users</strong> table with their role, active status, system notifications status, and last login.</Step>
                <Step n={12}>To <strong>change a user's role</strong>, click the role dropdown in their row and select the new role. The change takes effect immediately.</Step>
                <Step n={13}>To <strong>toggle system notifications</strong> for a user, click the toggle in the <strong>Notifications</strong> column. When enabled (green), that user receives automated system emails such as data refresh completion and failure alerts.</Step>
                <Step n={14}>To <strong>deactivate</strong> a user (they can no longer sign in but their data is kept), click <strong>Deactivate</strong>.</Step>
                <Step n={15}>To <strong>reactivate</strong> a deactivated user, click <strong>Activate</strong>.</Step>
                <Step n={16}>To <strong>send a password reset link</strong>, click <strong>Reset pwd</strong>. An email is sent with a reset link that expires in 1 hour.</Step>
                <Step n={17}>To <strong>permanently delete</strong> a user and all their data, click <strong>Delete</strong> and confirm. This cannot be undone.</Step>
                <Step n={18}>To <strong>view the platform as that user</strong> (impersonate), click <strong>View as</strong>. A banner appears at the top. Click <strong>Exit — return to my account</strong> to return to your own account.</Step>

                <Note>You cannot delete or deactivate your own account. You cannot impersonate an administrator or developer. System notifications require SendGrid to be configured in Settings.</Note>
              </div>
            </article>

            {/* ── 11. Roles & Permissions ── */}
            <article className="card help-card" id="roles">
              <SectionHeading title="Roles & Permissions" subtitle="Built-in roles, custom roles, and what each role can do" />
              <div className="stack-compact">
                <Sub>Built-in roles</Sub>
                <Step n={1}><strong>Developer</strong> — Full unrestricted access to everything. Reserved for the platform administrator. Cannot be modified or assigned to other users.</Step>
                <Step n={2}><strong>Admin</strong> — Full access to all features including user management, role management, settings, data import, and all reports/dashboards.</Step>
                <Step n={3}><strong>Editor</strong> — Can create, edit, and delete their own reports and dashboards. Can import data. Cannot manage users, roles, or settings.</Step>
                <Step n={4}><strong>Viewer</strong> — Read-only access. Can open and interact with reports/dashboards shared with them. Cannot create, edit, or manage anything.</Step>

                <Sub>Creating a custom role</Sub>
                <Step n={5}>Go to <strong>Roles</strong> in the sidebar (admins and developers only).</Step>
                <Step n={6}>Click <strong>New role</strong> in the top-right corner.</Step>
                <Step n={7}>Enter a <strong>name</strong>, <strong>description</strong>, and choose a <strong>color</strong> for easy identification.</Step>
                <Step n={8}>In the permissions panel, toggle each permission on or off. Permissions are grouped by category: Content Access, Report &amp; Dashboard Builder, Data Sources, Platform Settings, User Management, Role Management, Testing, and Exports.</Step>
                <Step n={9}>Click <strong>Save role</strong>. The role is now available when inviting or updating users.</Step>
                <Step n={10}>To edit an existing custom role, select it from the left panel, make changes, and click <strong>Save role</strong>.</Step>
                <Step n={11}>To delete a custom role, select it and click <strong>Delete role</strong>. Users with that role will need to be reassigned.</Step>

                <Tip>Use the <strong>Grant all</strong> / <strong>Remove all</strong> buttons within each permission group to quickly set all permissions in that category at once.</Tip>
              </div>
            </article>

            {/* ── 12. Platform Settings ── */}
            <article className="card help-card" id="settings">
              <SectionHeading title="Platform Settings" subtitle="Branding, Quickbase, data refresh, email reports, storage, and saving — 6 steps" />
              <div className="stack-compact">
                <Sub>Opening Settings</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>Click <strong>Settings</strong> in the sidebar, or click the <strong>Settings</strong> button in the topbar when on the Building page. The settings wizard opens with 6 step buttons across the top. Click any step card to jump to it, or use the <strong>← Back</strong> and <strong>Next →</strong> buttons at the bottom of each step. The <strong>↺ Reload settings from server</strong> and <strong>✓ Save settings to server</strong> buttons at the very bottom apply to all steps at once.</p>

                <Sub>Step 1 — Branding</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>The top of this step shows a summary of workspace status, last loaded/saved times, last data sync, next scheduled sync, and total records in the database.</p>
                <Step n={1}><strong>Platform name</strong> — The name shown in the browser tab, topbar, and login page. Set this to your organization's name.</Step>
                <Step n={2}><strong>Navigation label</strong> — The label for the reports/dashboards section badge in the topbar (e.g. "Reports and Dashboards").</Step>
                <Step n={3}><strong>Home label</strong> — The label shown in the home section (e.g. "Workspace").</Step>
                <Step n={4}><strong>Open reports and dashboards in a new tab</strong> — When checked, report and dashboard links always open in a new browser tab.</Step>
                <Step n={5}><strong>Session timeout after idle (hours)</strong> — How many hours of inactivity before users are automatically signed out. Minimum: 1 hour.</Step>
                <Step n={6}><strong>Idle grace before timeout starts (minutes)</strong> — How many minutes a user can be idle before the timeout countdown begins. Activity in any tab from the same browser keeps the session alive.</Step>

                <Sub>Step 2 — Connect Quickbase</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>This step is optional if you only use Excel imports. You can connect to multiple Quickbase apps using separate "app profiles." Each profile has its own credentials and data refresh settings.</p>
                <Step n={7}><strong>Active app profile</strong> — Select which Quickbase app profile you are configuring. Click <strong>Add app profile</strong> to add a second Quickbase app connection.</Step>
                <Step n={8}><strong>Profile label</strong> — A name for this connection (e.g. "Claims app", "HR data").</Step>
                <Step n={9}><strong>Live mode for this app</strong> — When enabled, reports using this app's data will automatically refresh when opened in view mode. Warning: this makes reports take significantly longer to load and should only be used when real-time data is essential.</Step>
                <Step n={10}><strong>Your Quickbase website address</strong> — The URL you use to log in to Quickbase, e.g. <em>yourcompany.quickbase.com</em>.</Step>
                <Step n={11}><strong>Your personal access token</strong> — Found in Quickbase under My Profile → Manage User Tokens. Keep this private — treat it like a password.</Step>
                <Step n={12}><strong>App token</strong> (optional) — Only required if your Quickbase admin has set up app-level tokens. Leave blank unless instructed.</Step>
                <Step n={13}>Click <strong>Load my apps</strong> to fetch all apps in your Quickbase account, then select the app you want to connect from the dropdown.</Step>
                <Step n={14}>Click <strong>Connect and load tables</strong>. The platform reads your Quickbase table list and verifies the connection.</Step>
                <Step n={15}>If the connection succeeds, an <strong>Auto-configure settings</strong> button appears. Click it to automatically map your Quickbase tables to sensible default settings.</Step>

                <Sub>Step 3 — Data Refresh</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>This step controls which Quickbase tables are synced to the PostgreSQL database and how often. Reports and dashboards always read from the database — Quickbase is never queried live when viewing content.</p>
                <Step n={16}><strong>Enable scheduled refresh</strong> — Toggle on to allow automatic data refresh on a recurring schedule.</Step>
                <Step n={17}><strong>Cadence</strong> — How often to refresh: <em>Nightly / daily</em>, <em>Weekly</em>, or <em>Monthly</em>.</Step>
                <Step n={18}><strong>Time</strong> — The time of day to run the scheduled refresh (24-hour clock).</Step>
                <Step n={19}><strong>Day of week</strong> (weekly cadence only) — Which day of the week to run.</Step>
                <Step n={20}><strong>Day of month</strong> (monthly cadence only) — Which day of the month to run (1–31).</Step>
                <Step n={21}><strong>Timezone</strong> — The timezone for the scheduled time.</Step>
                <Step n={22}><strong>Tables to sync to PostgreSQL</strong> — Check the box next to each Quickbase table you want to keep up to date. Only checked tables are pulled on each refresh. (You must click "Connect and load tables" in Step 2 first to see your tables here.)</Step>
                <Step n={23}><strong>Quickbase saved report number</strong> (per table) — The number of the saved report in Quickbase that determines which rows and fields to pull. Find it in Quickbase by opening the table, going to Reports, and looking at the report's URL. <em>Leave this blank to sync all records and all fields from the table automatically.</em></Step>
                <Step n={24}><strong>Key field</strong> (per table) — The field that uniquely identifies each record in this table (like an ID number). This is used to relate tables to each other in the database when joining data across reports. If your table fields are loaded, a dropdown appears — otherwise type the field ID number.</Step>
                <Step n={25}>Click <strong>Refresh all now</strong> to immediately pull data from all selected Quickbase tables. You can also use the <strong>Refresh all</strong> button in the topbar from any page.</Step>
                <Step n={26}>Click <strong>Save all settings</strong> to persist the refresh schedule and table selections.</Step>

                <Sub>Step 4 — Email Reports</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>This step shows the same scheduled email list as the <strong>Scheduled Reports</strong> page in the sidebar. From here you can create, edit, pause, and delete automated email deliveries of reports and dashboards. Requires SendGrid to be configured on the server (contact your administrator for the API key setup).</p>

                <Sub>Step 5 — Storage &amp; Sharing</Sub>
                <Step n={27}><strong>Data storage</strong> — Shows whether the database is connected. When connected, all platform data (settings, reports, dashboards, imported data) is stored securely on the server and persists across restarts and deployments. Also shows total records, session timeout, and the platform's public address.</Step>
                <Step n={28}><strong>Sharing modes</strong> — Three sharing levels are available for each report and dashboard:
                  <br />• <em>Shared with everyone</em> — Any user who can sign in can see this item.
                  <br />• <em>Shared with specific users or roles</em> — Only users/roles you choose can see it (set per-item in the Builder).
                  <br />• <em>Personal</em> — Only the creator can see it.
                </Step>
                <Step n={29}><strong>Helpdesk tickets</strong> (optional) — Configure a Quickbase-based helpdesk ticket form accessible from the <strong>Help Ticket</strong> button in the topbar. Enter the Helpdesk App DBID, Tickets Table DBID, Parent Table DBID, and Parent App ID FID from your Quickbase helpdesk app. Leave all fields blank if you do not use this feature.</Step>

                <Sub>Step 6 — Save &amp; Apply</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>This step shows a summary of workspace mode, last loaded/saved times, and total records. Use the two buttons here (or the identical buttons at the bottom of every step) to apply your changes.</p>
                <Step n={30}><strong>↺ Reload settings from server</strong> — Discards any unsaved changes and reloads the current settings from the database.</Step>
                <Step n={31}><strong>✓ Save settings to server</strong> — Saves all settings changes across all steps to the database. Settings are persisted permanently and survive server restarts and deployments.</Step>
              </div>
            </article>

            {/* ── 13. Troubleshooting ── */}
            <article className="card help-card" id="troubleshooting">
              <SectionHeading title="Common Problems & Fixes" subtitle="What to check first when something looks wrong" />
              <div className="stack-compact">
                <Sub>Account locked — "Your account is temporarily locked"</Sub>
                <Step n={1}>Your account locks for <strong>15 minutes</strong> after 5 consecutive failed sign-in attempts. The sign-in screen will show how many minutes remain.</Step>
                <Step n={2}>Wait 15 minutes, then try again with the correct password.</Step>
                <Step n={3}>If you need access sooner, ask your administrator to go to <strong>Users</strong>, find your account, and click <strong>Reset pwd</strong> — this also clears the lockout.</Step>

                <Sub>Can't sign in — "Invalid email or password"</Sub>
                <Step n={4}>Double-check your email address spelling and that Caps Lock is off.</Step>
                <Step n={5}>Passwords are case-sensitive. Use the <strong>👁 Show password</strong> button to verify what you are typing.</Step>
                <Step n={6}>If you forgot your password, click <strong>Forgot password?</strong> on the sign-in screen, or ask your administrator to send a <strong>Reset pwd</strong> email from the Users page.</Step>

                <Sub>2FA code not working</Sub>
                <Step n={7}>Make sure your phone's time is synchronized (Settings → General → Date &amp; Time → Set Automatically on iPhone).</Step>
                <Step n={8}>Use the code that is currently displayed — if it is about to expire (the bar is almost empty), wait for the next one.</Step>
                <Step n={9}>If you lost access to Microsoft Authenticator, contact your administrator to reset your 2FA setup from the Users page.</Step>

                <Sub>Invitation link expired or invalid</Sub>
                <Step n={10}>Invitation links expire after 7 days. Ask your administrator to go to <strong>Users</strong> → <strong>Pending invitations</strong> and click <strong>↺ Resend</strong> next to your email.</Step>

                <Sub>Report shows no data or wrong data</Sub>
                <Step n={11}>Check the data source was imported successfully in <strong>Data Sources</strong>. Look for a row count greater than zero.</Step>
                <Step n={12}>Check that the report's filters are not too restrictive — remove all filters and see if data appears.</Step>
                <Step n={13}>If the source is Quickbase, click <strong>Refresh all</strong> in the topbar to pull the latest data from Quickbase into the database.</Step>
                <Step n={14}>Go to <strong>Settings → Data Refresh</strong> and confirm the correct tables are checked and that the report number (if set) and key field are correct.</Step>

                <Sub>Page looks broken or missing content</Sub>
                <Step n={15}>Try a hard refresh: hold <strong>Cmd (Mac) / Ctrl (Windows)</strong> and press <strong>Shift + R</strong>.</Step>
                <Step n={16}>Try opening the platform in an Incognito/Private window to rule out browser cache issues.</Step>
                <Step n={17}>If the problem persists, contact your administrator with a screenshot of any error messages and the URL you were on.</Step>

                <Sub>Excel import failed</Sub>
                <Step n={18}>Only <strong>.xlsx files</strong> are supported — not .xls or .csv. Re-save your file as .xlsx in Excel.</Step>
                <Step n={19}>Files over <strong>25 MB</strong> may fail. Try splitting large files or removing unused sheets.</Step>
                <Step n={20}>Make sure the <strong>first row</strong> of each sheet contains column headers.</Step>
                <Step n={21}>Make sure you selected the correct workbook in the picker (either an existing workbook to update, or "+ Add new workbook" to create one).</Step>

                <Sub>Can't see a report or dashboard someone shared</Sub>
                <Step n={22}>Ask the person who created it to check its <strong>Sharing</strong> settings in the Builder. It may be set to <em>Personal</em> (only visible to the creator).</Step>
                <Step n={23}>If it is shared with specific users, ask them to add your email or role to the shared list.</Step>

                <Sub>Settings not saving between visits</Sub>
                <Step n={24}>Always click <strong>✓ Save settings to server</strong> at the bottom of the Settings page after making changes. Settings are only saved when you explicitly click this button.</Step>
                <Step n={25}>If settings still revert, verify the database is connected in <strong>Settings → Storage &amp; Sharing</strong>. A disconnected database means settings fall back to defaults on restart.</Step>

                <Tip>When reporting an issue to your administrator, always include: the URL you were on, what you were trying to do, and any error message shown on screen or in the browser console (F12 → Console tab).</Tip>
              </div>
            </article>

          </div>
        </div>
      </div>
    </section>
  );
}
