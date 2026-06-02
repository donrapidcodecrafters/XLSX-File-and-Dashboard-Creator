import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { buildHostedRoute } from "../lib/embed";

const sections = [
  { id: "sign-in",         title: "Signing In & 2FA",            summary: "How to log in, set up Microsoft Authenticator, and sign out" },
  { id: "accept-invite",   title: "Accepting an Invitation",     summary: "What to do when you receive an invitation email" },
  { id: "navigation",      title: "Navigating the Platform",     summary: "Sidebar, Home, Viewing, Building, and all nav sections" },
  { id: "data-sources",    title: "Data Sources",                summary: "Importing Excel files and managing your data" },
  { id: "create-report",   title: "Creating a Report",           summary: "Complete step-by-step walkthrough: Basics → Data → Filters → View → Review" },
  { id: "create-dashboard","title": "Creating a Dashboard",      summary: "Building dashboards and adding report cards to the canvas" },
  { id: "viewing",         title: "Viewing Reports & Dashboards", summary: "Finding, filtering, exporting, and interacting with content" },
  { id: "scheduled-emails","title": "Scheduled Email Reports",   summary: "Automatically email reports and dashboards on a schedule" },
  { id: "user-management", title: "Managing Users",              summary: "Inviting users, managing roles, resetting passwords" },
  { id: "roles",           title: "Roles & Permissions",         summary: "Built-in roles, custom roles, and what each role can do" },
  { id: "settings",        title: "Platform Settings",           summary: "Branding, Quickbase connection, data refresh, and more" },
  { id: "troubleshooting", title: "Common Problems & Fixes",     summary: "What to check first when something looks wrong" },
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

                <Sub>Signing out</Sub>
                <Step n={1}>Click <strong>Sign out</strong> in the top-right navigation bar, or find it at the bottom of the left sidebar.</Step>
                <Step n={2}>You are immediately returned to the sign-in screen. Your session data is cleared.</Step>

                <Note>Sessions expire automatically after a period of inactivity (configured by your administrator). You will see a warning 2 minutes before expiry with an option to stay signed in.</Note>
              </div>
            </article>

            {/* ── 2. Accepting an Invitation ── */}
            <article className="card help-card" id="accept-invite">
              <SectionHeading title="Accepting an Invitation" subtitle="What to do when you receive an invitation email" />
              <div className="stack-compact">
                <Step n={1}>Check your email for an invitation from the platform. The subject line will say <strong>"You've been invited to join Cadence Reporting Studio"</strong>.</Step>
                <Step n={2}>Click the <strong>Accept invitation →</strong> button in the email. A setup page opens in your browser.</Step>
                <Step n={3}>You will see your email address, your assigned role, and two fields: <strong>Your name</strong> and <strong>Choose a password</strong>.</Step>
                <Step n={4}>Enter your full name in the <strong>Your name</strong> field.</Step>
                <Step n={5}>Enter a password of at least 8 characters in <strong>Choose a password</strong>, then repeat it in <strong>Confirm password</strong>.</Step>
                <Step n={6}>Click <strong>Set up my account</strong>. Your account is created and you are signed in automatically.</Step>
                <Step n={7}>You will then be prompted to set up Microsoft Authenticator for 2FA — follow the on-screen QR code instructions (see <strong>Signing In</strong> above).</Step>
                <Tip>Invitation links expire after 7 days. If yours has expired, ask your administrator to resend it from the Users management page.</Tip>
              </div>
            </article>

            {/* ── 3. Navigation ── */}
            <article className="card help-card" id="navigation">
              <SectionHeading title="Navigating the Platform" subtitle="The sidebar, main areas, and what each section is for" />
              <div className="stack-compact">
                <Sub>The sidebar</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>The left sidebar is always visible. Hover over it to expand and see labels. Click the <strong>▶</strong> pin button in the sidebar header to keep it expanded permanently.</p>

                <Sub>Main section</Sub>
                <Step n={1}><strong>Home</strong> — Your landing page with quick stats and recent items.</Step>
                <Step n={2}><strong>Viewing</strong> — Browse and open all reports and dashboards you have access to.</Step>
                <Step n={3}><strong>Building</strong> — Create and edit reports and dashboards.</Step>

                <Sub>Content — Reports &amp; Dashboards accordion</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>Click <strong>📊 Reports &amp; Dashboards</strong> in the sidebar to expand a list of all your content, grouped by Dashboards then Reports. Click any item to open it directly.</p>

                <Sub>Data section</Sub>
                <Step n={1}><strong>Data Sources</strong> — View, rename, delete, and import Excel data files.</Step>
                <Step n={2}><strong>Scheduled Reports</strong> — Manage automated email delivery of reports (admins only).</Step>

                <Sub>Manage section (admins &amp; developers only)</Sub>
                <Step n={1}><strong>Users</strong> — Invite and manage platform users.</Step>
                <Step n={2}><strong>Roles</strong> — Create and manage permission roles.</Step>

                <Sub>System section</Sub>
                <Step n={1}><strong>Settings</strong> — Platform name, branding, Quickbase connection, and more.</Step>
                <Step n={2}><strong>Help</strong> — This page.</Step>

                <Sub>User profile (bottom of sidebar)</Sub>
                <p style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>Your name, role badge, and <strong>Sign out</strong> button are always visible at the bottom of the sidebar when it is expanded.</p>
              </div>
            </article>

            {/* ── 4. Data Sources ── */}
            <article className="card help-card" id="data-sources">
              <SectionHeading title="Data Sources" subtitle="Importing Excel files and managing your data" />
              <div className="stack-compact">
                <Sub>Importing an Excel file</Sub>
                <Step n={1}>Go to <strong>Data Sources</strong> in the sidebar.</Step>
                <Step n={2}>Click <strong>+ Import XLSX</strong> in the top-right corner. A dialog opens.</Step>
                <Step n={3}>Choose the import mode:<br />
                  <strong>"The file contains my data"</strong> — Use this when your Excel file has rows of information (sales records, employee lists, claims, etc.) that you want to report on.<br />
                  <strong>"The file defines report layouts"</strong> — Use this when your Excel file shows how reports should look (chart tabs, layouts) using data already in the platform.
                </Step>
                <Step n={4}>For data files: Toggle <strong>"Automatically create reports and a dashboard from this file"</strong> if you want the platform to read chart tabs in your workbook and create matching reports automatically.</Step>
                <Step n={5}>Enter a <strong>Name</strong> for this data source. Use the same name every time you upload an updated version — the platform will replace the old data and update all reports instantly.</Step>
                <Step n={6}>Drag your <strong>.xlsx file</strong> onto the drop zone, or click to browse and select it. A preview of the file's contents appears.</Step>
                <Step n={7}>Click the import button. The file uploads and data is stored in the database.</Step>
                <Tip>Always use the same source name when re-importing updated data. This automatically updates all reports that use that source without any additional steps.</Tip>

                <Sub>Managing data sources</Sub>
                <Step n={1}>Go to <strong>Data Sources</strong> in the sidebar. You see a table of all imported sources with row counts and last-updated dates.</Step>
                <Step n={2}>To <strong>rename</strong> a source, click the pencil icon next to its name, type the new name, and press Enter.</Step>
                <Step n={3}>To <strong>clear data only</strong> (keep the source but remove all rows), click the <strong>Clear data</strong> button on that row.</Step>
                <Step n={4}>To <strong>permanently delete</strong> a source and all its data, click <strong>Delete</strong> and confirm. Warning: any reports using this source will stop working.</Step>
                <Step n={5}>To <strong>preview</strong> the data, click the source name to see the first rows and all column names.</Step>
              </div>
            </article>

            {/* ── 5. Creating a Report ── */}
            <article className="card help-card" id="create-report">
              <SectionHeading title="Creating a Report" subtitle="Complete step-by-step walkthrough: Basics → Data → Filters → View → Review" />
              <div className="stack-compact">
                <Step n={1}>Go to <strong>Building</strong> in the sidebar, then click <strong>Create a new report</strong>.</Step>

                <Sub>Step 1 — Basics</Sub>
                <Step n={2}><strong>Mode</strong> — Choose how data is displayed. Options: <em>table</em> (rows and columns), <em>chart</em> (visual graph), <em>metric</em> (single number card), <em>pivot</em> (cross-tab), or others.</Step>
                <Step n={3}><strong>Record title field</strong> — Search for and select the field that identifies each record (e.g. "Customer Name" or "Order ID"). Used as the clickable title when detail rows are shown.</Step>
                <Step n={4}><strong>Decimal places</strong> — How many decimal places to show for number fields. Default is 2.</Step>
                <Step n={5}><strong>Show summary metrics</strong> — Toggle on to display summary values (sum, count, average, etc.) above the report.</Step>
                <Step n={6}><strong>Include detail rows</strong> — Toggle on to show individual data rows in the report. Toggle off for aggregate/summary-only reports.</Step>
                <Step n={7}><strong>Include chart above table</strong> — Toggle on to show a chart above the data table when mode is "table".</Step>
                <Step n={8}>Click <strong>Next</strong>.</Step>

                <Sub>Step 2 — Data</Sub>
                <Step n={9}><strong>Data source</strong> — Select which imported data source (Excel file or Quickbase table) powers this report.</Step>
                <Step n={10}><strong>Fields to show</strong> — Check which columns from the data source should appear in the report. Drag to reorder them.</Step>
                <Step n={11}><strong>Grouping</strong> — Optionally group rows by a field (e.g. group by "Department" to see totals per department).</Step>
                <Step n={12}><strong>Sorting</strong> — Choose a field to sort by and the sort direction (ascending or descending).</Step>
                <Step n={13}>Click <strong>Next</strong>.</Step>

                <Sub>Step 3 — Filters</Sub>
                <Step n={14}>Add filter conditions to limit which rows appear. Click <strong>Add filter</strong>, choose a field, choose a condition (equals, contains, greater than, etc.), and enter a value.</Step>
                <Step n={15}>Add multiple filters — they work together (all conditions must be true for a row to appear).</Step>
                <Step n={16}>Click <strong>Next</strong>.</Step>

                <Sub>Step 4 — View</Sub>
                <Step n={17}><strong>Summary metrics</strong> — If you enabled summary metrics in Basics, configure them here. Click <strong>Add summary metric</strong>, choose a field, and choose the calculation (Sum, Count, Average, Minimum, Maximum, Count rows).</Step>
                <Step n={18}><strong>Chart settings</strong> — If your mode includes a chart, configure the X-axis field, Y-axis field, chart type (bar, line, pie, etc.), and color options.</Step>
                <Step n={19}>Click <strong>Next</strong>.</Step>

                <Sub>Step 5 — Review</Sub>
                <Step n={20}>Review the report name (click to edit it), description, folder, and sharing settings.</Step>
                <Step n={21}><strong>Sharing</strong> — Choose who can see this report: <em>Shared with everyone</em> (all users), <em>Specific users or roles</em> (select individuals), or <em>Personal</em> (only you).</Step>
                <Step n={22}>Click <strong>Create report</strong>. The report is saved and opens immediately.</Step>

                <Tip>You can edit any report at any time by opening it in the Building area and clicking <strong>Edit report</strong> in the toolbar at the bottom.</Tip>
              </div>
            </article>

            {/* ── 6. Creating a Dashboard ── */}
            <article className="card help-card" id="create-dashboard">
              <SectionHeading title="Creating a Dashboard" subtitle="Building dashboards and adding report cards to a tabbed canvas" />
              <div className="stack-compact">
                <Step n={1}>Go to <strong>Building</strong> in the sidebar, then click <strong>Create a new dashboard</strong>.</Step>
                <Step n={2}>Give the dashboard a name, description, folder, and sharing settings. Click <strong>Create dashboard</strong>.</Step>
                <Step n={3}>The dashboard canvas opens. Click <strong>Add report/graph</strong> in the toolbar.</Step>
                <Step n={4}>A panel opens. Choose an existing report from the list, or create a new one on the spot. Select a <strong>display size</strong> (small, medium, large, or full width) and click <strong>Add</strong>.</Step>
                <Step n={5}>The report card appears on the canvas. Repeat to add more cards.</Step>
                <Step n={6}>To <strong>reorganize cards</strong>, drag them by their header to reorder. Resize them using the size controls.</Step>
                <Step n={7}>Dashboards support <strong>tabs</strong>. Click <strong>Dashboard settings</strong> in the toolbar to add, rename, or reorder tabs. Move cards between tabs by editing each card.</Step>
                <Step n={8}>Click <strong>Save to server</strong> in the toolbar to save your changes.</Step>
                <Tip>Click any card in the dashboard to expand it to full-screen "focus" mode. Press Escape or click back to return to the dashboard view.</Tip>
              </div>
            </article>

            {/* ── 7. Viewing Reports & Dashboards ── */}
            <article className="card help-card" id="viewing">
              <SectionHeading title="Viewing Reports & Dashboards" subtitle="Finding, filtering, exporting, and interacting with content" />
              <div className="stack-compact">
                <Sub>Finding content</Sub>
                <Step n={1}>Go to <strong>Viewing</strong> in the sidebar. All reports and dashboards you have access to appear as cards.</Step>
                <Step n={2}>Use the <strong>Search</strong> field to search by name, description, folder, or tag.</Step>
                <Step n={3}>Use the <strong>Type</strong> filter to show only Reports or only Dashboards.</Step>
                <Step n={4}>Use the <strong>Access</strong> filter to show only global (everyone), shared with specific people, or personal items.</Step>
                <Step n={5}>Toggle <strong>Favorites only</strong> or <strong>Recently opened</strong> to narrow results further.</Step>
                <Step n={6}>Click any card to open that report or dashboard.</Step>

                <Sub>Interacting with a report</Sub>
                <Step n={7}>When viewing a report, use the <strong>filter controls</strong> at the top to change what data appears. Changes apply instantly.</Step>
                <Step n={8}>Click <strong>Open full-screen</strong> to expand the report to fill your screen. Press Escape to return.</Step>
                <Step n={9}>Click <strong>Focus details</strong> to expand the data table; <strong>Focus chart</strong> to expand the chart.</Step>
                <Step n={10}>Click <strong>Save view</strong> to save your current filter/sort settings as a named view. Load any saved view from the sidebar that appears.</Step>
                <Step n={11}>Click <strong>Export</strong> to download the report as an Excel file.</Step>

                <Sub>Interacting with a dashboard</Sub>
                <Step n={12}>Click any tab at the top of the dashboard to switch between tab sections.</Step>
                <Step n={13}>Click any card to expand it to focus mode. Press Escape to return.</Step>
                <Step n={14}>Click <strong>Export</strong> to export the entire dashboard or individual cards to Excel or image.</Step>

                <Tip>Star/favorite a report or dashboard by clicking the <strong>Favorite</strong> button in the report toolbar. Favorites appear first when you filter by Favorites only.</Tip>
              </div>
            </article>

            {/* ── 8. Scheduled Email Reports ── */}
            <article className="card help-card" id="scheduled-emails">
              <SectionHeading title="Scheduled Email Reports" subtitle="Automatically email reports and dashboards to recipients on a schedule" />
              <div className="stack-compact">
                <Step n={1}>Go to <strong>Scheduled Reports</strong> in the sidebar (admins only). Click <strong>+ Set up a new scheduled email</strong>.</Step>
                <Step n={2}><strong>Which report or dashboard?</strong> — Choose the report or dashboard to deliver from the dropdown. Reports and dashboards are listed separately.</Step>
                <Step n={3}><strong>Frequency</strong> — Choose how often to send: <em>Daily</em>, <em>Weekly</em>, <em>Monthly</em>, or <em>Hourly</em>.</Step>
                <Step n={4}><strong>Time</strong> — Choose the hour of day to send (shown in your selected timezone).</Step>
                <Step n={5}><strong>Day</strong> (weekly/monthly) — Choose which day of the week or which day of the month.</Step>
                <Step n={6}><strong>Timezone</strong> — Select the timezone for scheduling. Recipients receive the email at the selected local time.</Step>
                <Step n={7}><strong>Recipients</strong> — Enter one email address per line. You can add up to 50 recipients.</Step>
                <Step n={8}>Toggle <strong>Start sending right away</strong> to activate immediately, or leave off to save as paused.</Step>
                <Step n={9}>Click <strong>Set up scheduled email</strong> to save.</Step>

                <Sub>Managing scheduled emails</Sub>
                <Step n={10}>Each configured schedule shows in the list with its report name, schedule summary, recipients, last sent time, and next send time.</Step>
                <Step n={11}>Click <strong>Send test</strong> to immediately send a test email to all recipients without waiting for the schedule.</Step>
                <Step n={12}>Click <strong>Edit</strong> to change any setting.</Step>
                <Step n={13}>Click <strong>Pause</strong> to temporarily stop sending without deleting the schedule. Click <strong>Resume</strong> to restart it.</Step>
                <Step n={14}>Click <strong>Remove</strong> to permanently delete the schedule.</Step>

                <Note>Scheduled emails require your administrator to configure the email delivery service. If not set up, contact your administrator.</Note>
              </div>
            </article>

            {/* ── 9. Managing Users ── */}
            <article className="card help-card" id="user-management">
              <SectionHeading title="Managing Users" subtitle="Inviting users, managing roles, resetting passwords, and removing access" />
              <div className="stack-compact">
                <Sub>Inviting a new user</Sub>
                <Step n={1}>Go to <strong>Users</strong> in the sidebar (admins and developers only).</Step>
                <Step n={2}>Click <strong>+ Invite user</strong> in the top-right corner.</Step>
                <Step n={3}>Enter the new user's <strong>email address</strong>. This must be their real email — the invitation link is sent here.</Step>
                <Step n={4}>Optionally enter their <strong>display name</strong> (shown in the platform).</Step>
                <Step n={5}>Choose a <strong>role</strong>: Viewer, Editor, or Admin. See the Roles section below for what each can do.</Step>
                <Step n={6}>Click <strong>Send invitation</strong>. An email is sent immediately with a link that expires in 7 days.</Step>
                <Step n={7}>The invitation appears in the <strong>Pending invitations</strong> table below the users list until accepted.</Step>

                <Sub>Pending invitations</Sub>
                <Step n={8}>Pending invitations show the email, role, and expiry date.</Step>
                <Step n={9}>Click <strong>↺ Resend</strong> to send a fresh invitation email (resets the 7-day expiry).</Step>
                <Step n={10}>Click <strong>✕ Cancel</strong> to remove the invitation so it can no longer be accepted.</Step>

                <Sub>Managing existing users</Sub>
                <Step n={11}>All accepted users appear in the <strong>All users</strong> table with their role, status, and last login.</Step>
                <Step n={12}>To <strong>change a user's role</strong>, click the role dropdown in the Actions column and select the new role. The change takes effect immediately.</Step>
                <Step n={13}>To <strong>deactivate</strong> a user (they can no longer sign in but their data is kept), click <strong>Deactivate</strong>.</Step>
                <Step n={14}>To <strong>send a password reset link</strong>, click <strong>Reset pwd</strong>. An email is sent with a reset link that expires in 1 hour.</Step>
                <Step n={15}>To <strong>permanently delete</strong> a user and all their data, click <strong>Delete</strong> and confirm. This cannot be undone.</Step>
                <Step n={16}>To <strong>view the platform as that user</strong> (impersonate), click <strong>View as</strong>. A banner appears at the top. Click <strong>Exit</strong> to return to your own account.</Step>

                <Note>You cannot delete or deactivate your own account. You also cannot impersonate an administrator or developer.</Note>
              </div>
            </article>

            {/* ── 10. Roles & Permissions ── */}
            <article className="card help-card" id="roles">
              <SectionHeading title="Roles & Permissions" subtitle="Built-in roles, custom roles, and what each role can do" />
              <div className="stack-compact">
                <Sub>Built-in roles</Sub>
                <Step n={1}><strong>Developer</strong> — Full unrestricted access to everything. Reserved for the platform administrator (don@rapidcodecrafters.com). Cannot be modified.</Step>
                <Step n={2}><strong>Admin</strong> — Full access to all features including user management, role management, settings, data import, and all reports/dashboards.</Step>
                <Step n={3}><strong>Editor</strong> — Can create, edit, and delete their own reports and dashboards. Can import data. Cannot manage users, roles, or settings.</Step>
                <Step n={4}><strong>Viewer</strong> — Read-only access. Can open and interact with reports/dashboards shared with them. Cannot create, edit, or manage anything.</Step>

                <Sub>Creating a custom role</Sub>
                <Step n={5}>Go to <strong>Roles</strong> in the sidebar (admins and developers only).</Step>
                <Step n={6}>Click <strong>New role</strong> in the top-right corner.</Step>
                <Step n={7}>Enter a <strong>name</strong>, <strong>description</strong>, and choose a <strong>color</strong> for easy identification.</Step>
                <Step n={8}>In the permissions panel, toggle each permission on or off. Permissions are grouped by category: Content Access, Report &amp; Dashboard Builder, Data Sources, Platform Settings, User Management, Role Management, Testing, and Exports.</Step>
                <Step n={9}>Click <strong>Save role</strong>. The role is now available when inviting users.</Step>
                <Step n={10}>To edit an existing custom role, select it from the left panel and make changes. Click <strong>Save role</strong>.</Step>
                <Step n={11}>To delete a custom role, select it and click <strong>Delete role</strong>. Users with that role will need to be reassigned.</Step>

                <Tip>Use the <strong>Grant all</strong> / <strong>Remove all</strong> buttons within each permission group to quickly set all permissions in that category at once.</Tip>
              </div>
            </article>

            {/* ── 11. Settings ── */}
            <article className="card help-card" id="settings">
              <SectionHeading title="Platform Settings" subtitle="Branding, Quickbase connection, data refresh, email reports, and more" />
              <div className="stack-compact">
                <Sub>Opening Settings</Sub>
                <Step n={1}>Click <strong>Settings</strong> in the sidebar. The full Settings page opens with 6 steps across the top.</Step>

                <Sub>Step 1 — Branding</Sub>
                <Step n={2}><strong>Platform name</strong> — The name shown in the browser tab, topbar, and login page. Change this to your organization's name.</Step>
                <Step n={3}><strong>Navigation label</strong> — The label for the reports/dashboards section (e.g. "Reports and Dashboards").</Step>
                <Step n={4}><strong>Home label</strong> — The label for the home section (e.g. "Workspace").</Step>
                <Step n={5}><strong>Open reports in new tab</strong> — Toggle on if you want report links to always open in a new browser tab.</Step>
                <Step n={6}><strong>Session timeout</strong> — How many hours of inactivity before users are automatically signed out (default: 24 hours).</Step>
                <Step n={7}><strong>Idle grace period</strong> — How many minutes before the timeout warning appears.</Step>

                <Sub>Step 2 — Connect Quickbase</Sub>
                <Step n={8}>Configure your Quickbase app connection if you want to sync live data from Quickbase. Enter your <strong>realm hostname</strong> (e.g. mycompany.quickbase.com), <strong>app ID</strong>, and <strong>user token</strong>.</Step>
                <Step n={9}>Click <strong>Connect and load tables</strong> to verify the connection and see your Quickbase tables.</Step>
                <Step n={10}>This step is optional — you can use the platform with only Excel imports and skip Quickbase entirely.</Step>

                <Sub>Step 3 — Data Refresh</Sub>
                <Step n={11}>Select which Quickbase tables to keep synchronized. Only tables you select will be pulled during refresh.</Step>
                <Step n={12}>Set the <strong>refresh schedule</strong> — how often to automatically pull fresh data from Quickbase.</Step>

                <Sub>Step 4 — Email Reports</Sub>
                <Step n={13}>Configure SendGrid for automated email delivery. Enter your <strong>SendGrid API key</strong> and <strong>from email address</strong>.</Step>
                <Step n={14}>The from email must be verified in your SendGrid account's Sender Authentication settings.</Step>

                <Sub>Step 5 — Storage &amp; Sharing</Sub>
                <Step n={15}>View your database connection status and record counts. These settings are managed by your administrator on the server.</Step>
                <Step n={16}>Review the three sharing modes: Shared with everyone, Shared with specific users/roles, and Personal.</Step>

                <Sub>Step 6 — Save &amp; Apply</Sub>
                <Step n={17}>Review the summary: workspace mode, last loaded, last saved, and total rows in the database.</Step>
                <Step n={18}>Click <strong>↺ Reload settings from server</strong> to refresh settings from the server without saving your current changes.</Step>
                <Step n={19}>Click <strong>✓ Save settings to server</strong> to persist all changes made across all steps.</Step>
              </div>
            </article>

            {/* ── 12. Troubleshooting ── */}
            <article className="card help-card" id="troubleshooting">
              <SectionHeading title="Common Problems & Fixes" subtitle="What to check first when something looks wrong" />
              <div className="stack-compact">
                <Sub>Can't sign in — "Invalid email or password"</Sub>
                <Step n={1}>Double-check your email address spelling and that Caps Lock is off.</Step>
                <Step n={2}>Passwords are case-sensitive. Try typing slowly or use the <strong>👁 Show password</strong> button to verify what you are typing.</Step>
                <Step n={3}>If you forgot your password, ask your administrator to send you a <strong>Reset pwd</strong> email from the Users management page.</Step>

                <Sub>2FA code not working</Sub>
                <Step n={4}>Make sure your phone's time is synchronized (Settings → General → Date &amp; Time → Set Automatically on iPhone).</Step>
                <Step n={5}>Use the code that is currently displayed — if it is about to expire (seconds bar is almost empty), wait for the next one.</Step>
                <Step n={6}>If you lost access to Microsoft Authenticator, contact your administrator to reset your 2FA setup.</Step>

                <Sub>Invitation link expired or invalid</Sub>
                <Step n={7}>Invitation links expire after 7 days. Ask your administrator to go to <strong>Users</strong> → <strong>Pending invitations</strong> and click <strong>↺ Resend</strong> next to your email.</Step>

                <Sub>Report shows no data or wrong data</Sub>
                <Step n={8}>Check the data source was imported successfully in <strong>Data Sources</strong>. Look for a row count greater than zero.</Step>
                <Step n={9}>Check that the report filters are not too restrictive — remove filters and see if data appears.</Step>
                <Step n={10}>If the source is Quickbase, click <strong>Refresh all</strong> in the topbar to pull the latest data.</Step>

                <Sub>Page looks broken or missing content</Sub>
                <Step n={11}>Try a hard refresh: hold <strong>Cmd (Mac) / Ctrl (Windows)</strong> and press <strong>Shift + R</strong>.</Step>
                <Step n={12}>Try opening the platform in an Incognito/Private window to rule out browser cache issues.</Step>
                <Step n={13}>If the problem persists, contact your administrator with a screenshot of any error messages in the page.</Step>

                <Sub>Excel import failed</Sub>
                <Step n={14}>Only <strong>.xlsx files</strong> are supported (not .xls or .csv). Re-save your file as .xlsx in Excel.</Step>
                <Step n={15}>Files over <strong>25 MB</strong> may fail. Try splitting large files or removing unused sheets.</Step>
                <Step n={16}>Make sure the first row of each sheet contains column headers.</Step>

                <Sub>Can't see a report or dashboard someone shared</Sub>
                <Step n={17}>Ask the person who created it to check the <strong>Sharing</strong> settings. It may be set to <em>Personal</em> (only visible to the creator) instead of <em>Shared with everyone</em>.</Step>
                <Step n={18}>If it is shared with specific users, ask them to add you or your role to the shared list.</Step>

                <Tip>When reporting an issue to your administrator, always include: the URL you were on, what you were trying to do, and any error message shown on screen or in the browser console (F12 → Console tab).</Tip>
              </div>
            </article>

          </div>
        </div>
      </div>
    </section>
  );
}
