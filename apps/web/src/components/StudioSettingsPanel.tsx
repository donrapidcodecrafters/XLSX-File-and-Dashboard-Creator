import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { QuickbaseAppProfile, QuickbaseConnectionConfig, StudioDocument, TableDefinition } from "@studio/shared";
import { getAdminConfig, type PlatformConfig } from "../lib/studioApi";
import type { QuickbaseAppSchema, QuickbaseRealmApp, QuickbaseSyncResult } from "../lib/studioApi";
import { buildQuickbaseSavedReportUrl } from "../lib/quickbaseLinks";
import { ScheduledEmailsPanel } from "./ScheduledEmailsPanel";

export function StudioSettingsPanel({
  documentState,
  activeQuickbaseProfile,
  activeQuickbaseConfig,
  activeProfileTables,
  savedRowsForApp,
  refreshStatusTitle,
  refreshStatusDetail,
  realmApps,
  realmAppsLoading,
  quickbaseSchema,
  quickbaseSchemaLoading,
  savingRemote,
  refreshingCache,
  lastQuickbaseSync,
  weekdayOptions,
  timezoneOptions,
  applyDocumentUpdate,
  setActiveQuickbaseProfile,
  updateQuickbaseProfileLabel,
  updateQuickbaseProfileLiveMode,
  addQuickbaseProfile,
  removeQuickbaseProfile,
  updateQuickbaseField,
  applyQuickbaseAppSelection,
  loadRealmApps,
  loadQuickbaseMetadata,
  autoDetectQuickbaseMappings,
  updateRefreshScheduleField,
  updateRefreshSourceTables,
  updateRefreshSourceReportId,
  updateRefreshSourceKeyFieldId,
  saveRemote,
  refreshAllNow,
  reloadRemote
}: {
  documentState: StudioDocument;
  activeQuickbaseProfile: QuickbaseAppProfile | null;
  activeQuickbaseConfig: QuickbaseConnectionConfig;
  activeProfileTables: TableDefinition[];
  savedRowsForApp: number;
  refreshStatusTitle: string;
  refreshStatusDetail: string;
  realmApps: QuickbaseRealmApp[];
  realmAppsLoading: boolean;
  quickbaseSchema: QuickbaseAppSchema | null;
  quickbaseSchemaLoading: boolean;
  savingRemote: boolean;
  refreshingCache: boolean;
  lastQuickbaseSync: QuickbaseSyncResult | null;
  weekdayOptions: Array<{ value: number; label: string }>;
  timezoneOptions: string[];
  applyDocumentUpdate: (updater: (draft: StudioDocument) => void) => void;
  setActiveQuickbaseProfile: (profileId: string) => void;
  updateQuickbaseProfileLabel: (value: string) => void;
  updateQuickbaseProfileLiveMode: (enabled: boolean) => void;
  addQuickbaseProfile: () => void;
  removeQuickbaseProfile: (profileId: string) => void;
  updateQuickbaseField: (field: keyof StudioDocument["quickbase"], value: string) => void;
  applyQuickbaseAppSelection: (appId: string) => void;
  loadRealmApps: () => Promise<void>;
  loadQuickbaseMetadata: () => Promise<QuickbaseAppSchema | null>;
  autoDetectQuickbaseMappings: () => void;
  updateRefreshScheduleField: <K extends keyof QuickbaseAppProfile["refreshSchedule"]>(field: K, value: QuickbaseAppProfile["refreshSchedule"][K]) => void;
  updateRefreshSourceTables: (tableIds: string[]) => void;
  updateRefreshSourceReportId: (tableId: string, value: string) => void;
  updateRefreshSourceKeyFieldId: (tableId: string, value: string) => void;
  saveRemote: () => void;
  refreshAllNow: () => Promise<void>;
  reloadRemote: () => void;
}) {
  const settingsSteps = useMemo(() => ([
    { id: "overview", label: "Branding", description: "Set your platform name, navigation labels, and session timeout settings." },
    { id: "profiles", label: "Connect Quickbase", description: "Connect to your Quickbase apps and configure your access credentials." },
    { id: "refresh", label: "Data Refresh", description: "Choose which tables to keep up to date and set a refresh schedule." },
    { id: "automation", label: "Email Reports", description: "Send reports and dashboards automatically to people's inboxes on a schedule." },
    { id: "storage", label: "Storage & Sharing", description: "How data is stored and who can access each report and dashboard." },
    { id: "review", label: "Save & Apply", description: "Review and save all your settings changes." }
  ]), []);
  const [activeStep, setActiveStep] = useState<(typeof settingsSteps)[number]["id"]>("overview");
  const activeStepIndex = settingsSteps.findIndex((step) => step.id === activeStep);
  const activeStepMeta = settingsSteps[activeStepIndex] || settingsSteps[0];
  const [platformConfig, setPlatformConfig] = useState<PlatformConfig | null>(null);
  const [platformConfigLoading, setPlatformConfigLoading] = useState(false);

  useEffect(() => {
    if (activeStep !== "storage") return;
    if (platformConfig) return;
    setPlatformConfigLoading(true);
    getAdminConfig()
      .then((cfg) => setPlatformConfig(cfg))
      .catch(() => {})
      .finally(() => setPlatformConfigLoading(false));
  }, [activeStep, platformConfig]);

  function renderStep(id: (typeof settingsSteps)[number]["id"], content: ReactNode) {
    if (activeStep !== id) return null;
    const idx = settingsSteps.findIndex((s) => s.id === id);
    const hasPrev = idx > 0;
    const hasNext = idx < settingsSteps.length - 1;
    return (
      <>
        {content}
        {(hasPrev || hasNext) && (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, paddingTop: 8 }}>
            <div>
              {hasPrev && (
                <button
                  type="button"
                  onClick={() => setActiveStep(settingsSteps[idx - 1].id)}
                  style={{
                    padding: "7px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: "1px solid var(--border, #E5E7EB)", background: "var(--surface-alt, #F9FAFB)",
                    color: "var(--text-secondary, #374151)", fontFamily: "inherit",
                  }}
                >
                  ← Back
                </button>
              )}
            </div>
            <div>
              {hasNext && (
                <button
                  type="button"
                  onClick={() => setActiveStep(settingsSteps[idx + 1].id)}
                  style={{
                    padding: "7px 18px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer",
                    border: "none", background: "var(--brand, #0d7c66)",
                    color: "#fff", fontFamily: "inherit",
                  }}
                >
                  Next: {settingsSteps[idx + 1].label} →
                </button>
              )}
            </div>
          </div>
        )}
      </>
    );
  }
  return (
    <div className="stack">
      <div className="builder-stepper">
        {settingsSteps.map((step, index) => (
          <button
            key={step.id}
            type="button"
            className={`builder-step-button${step.id === activeStep ? " active-tab" : ""}${activeStepIndex > index ? " builder-step-complete" : ""}`}
            onClick={() => setActiveStep(step.id)}
          >
            <span className="badge">{index + 1}</span>
            <strong>{step.label}</strong>
            <span className="step-description">{step.description}</span>
          </button>
        ))}
      </div>

      <div className="sync-status">
        <strong>{activeStepMeta.label}</strong>
        <span>{activeStepMeta.description}</span>
      </div>

      {renderStep("overview", (
        <>
          <div className="summary-grid">
            <div className="summary-card"><strong>{documentState.sync.providerMode === "api" ? "Active" : "Local only"}</strong><span>Workspace mode</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastLoadedAt ? new Date(documentState.sync.lastLoadedAt).toLocaleTimeString() : "Not yet"}</strong><span>Last loaded</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastSavedAt ? new Date(documentState.sync.lastSavedAt).toLocaleTimeString() : "Not yet"}</strong><span>Last saved</span></div>
            <div className="summary-card"><strong>{activeQuickbaseProfile?.refreshStatus.lastSuccessAt ? new Date(activeQuickbaseProfile.refreshStatus.lastSuccessAt).toLocaleString() : "Never synced"}</strong><span>Last data sync</span></div>
            <div className="summary-card"><strong>{activeQuickbaseProfile?.refreshStatus.nextRunAt ? new Date(activeQuickbaseProfile.refreshStatus.nextRunAt).toLocaleString() : "Not scheduled"}</strong><span>Next scheduled sync</span></div>
            <div className="summary-card"><strong>{savedRowsForApp.toLocaleString()}</strong><span>Records in database</span></div>
          </div>
          <label className="field">
            <span>Platform name</span>
            <input value={documentState.branding.platformName} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.platformName = event.target.value; })} />
          </label>
          <label className="field">
            <span>Navigation label</span>
            <input value={documentState.branding.navigationLabel} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.navigationLabel = event.target.value; })} />
          </label>
          <label className="field">
            <span>Home label</span>
            <input value={documentState.branding.homeLabel} onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.homeLabel = event.target.value; })} />
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={documentState.branding.openLinksInNewTab === true}
              onChange={(event) => applyDocumentUpdate((draft) => { draft.branding.openLinksInNewTab = event.target.checked; })}
            />
            Open reports and dashboards in a new tab
          </label>
          <label className="field">
            <span>Session timeout after idle (hours)</span>
            <input
              type="number"
              min="1"
              step="1"
              value={documentState.session.inactivityTimeoutHours}
              onChange={(event) => applyDocumentUpdate((draft) => {
                const nextValue = Math.max(1, Number(event.target.value) || 24);
                draft.session.inactivityTimeoutHours = nextValue;
              })}
            />
          </label>
          <label className="field">
            <span>Idle grace before timeout starts (minutes)</span>
            <input
              type="number"
              min="0"
              step="1"
              value={documentState.session.inactivityGraceMinutes}
              onChange={(event) => applyDocumentUpdate((draft) => {
                const nextValue = Math.max(0, Number(event.target.value) || 5);
                draft.session.inactivityGraceMinutes = nextValue;
              })}
            />
          </label>
          <div className="micro">
            Users stay signed in while they are active. The timeout countdown only starts after this many idle minutes, and activity in another tab from the same browser keeps the same session alive.
          </div>
        </>
      ))}

      {renderStep("profiles", (
        <>
          <div className="sync-status sync-status-ok" style={{ marginBottom: 8 }}>
            <strong>How Quickbase sync works</strong>
            <span>Enter your Quickbase connection details below. When you click "Refresh all now" or the scheduled refresh runs, data is pulled from Quickbase and stored in the PostgreSQL database. Reports, charts, and dashboards always read from the database — Quickbase is never queried live when viewing content.</span>
          </div>
          <div className="card">
        <div className="card-head">
          <strong>Quickbase app connections</strong>
          <span className="micro">Connect one or more Quickbase apps. Each app has its own credentials, refresh schedule, and table selections. Connection settings are saved to the database.</span>
        </div>
        <label className="field">
          <span>Active app profile</span>
          <select value={documentState.activeQuickbaseProfileId} onChange={(event) => setActiveQuickbaseProfile(event.target.value)}>
            {documentState.quickbaseProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label || profile.quickbase.appId || profile.id}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Profile label</span>
          <input value={activeQuickbaseProfile?.label || ""} onChange={(event) => updateQuickbaseProfileLabel(event.target.value)} placeholder="Claims app" />
        </label>
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={activeQuickbaseProfile?.liveMode === true}
            onChange={(event) => updateQuickbaseProfileLiveMode(event.target.checked)}
          />
          Live mode for this app
        </label>
        <div className="micro">
          Warning: live mode refreshes the specific report or dashboard automatically when it opens in viewing or embed mode, and it can take significantly longer to load.
        </div>
        <div className="studio-actions">
          <button onClick={addQuickbaseProfile}>Add app profile</button>
          <button onClick={() => activeQuickbaseProfile ? removeQuickbaseProfile(activeQuickbaseProfile.id) : undefined} disabled={documentState.quickbaseProfiles.length <= 1}>
            Remove app profile
          </button>
        </div>
      </div>
      <div className="card">
        <div className="card-head">
          <strong>Quickbase connection credentials</strong>
          <span className="micro">Enter your Quickbase credentials below, then click "Load my apps" to find and select your app automatically.</span>
        </div>
        <label className="field">
          <span>Your Quickbase website address</span>
          <input value={activeQuickbaseConfig.realmHostname} onChange={(event) => updateQuickbaseField("realmHostname", event.target.value)} placeholder="yourcompany.quickbase.com" />
          <span className="micro">The web address you use to log in to Quickbase — for example, acme.quickbase.com</span>
        </label>
        <label className="field">
          <span>Your personal access token</span>
          <input type="password" value={activeQuickbaseConfig.userToken} onChange={(event) => updateQuickbaseField("userToken", event.target.value)} placeholder="QB-USER-TOKEN-…" />
          <span className="micro">Found in Quickbase under My Profile → Manage User Tokens. Keep this private.</span>
        </label>
        <label className="field">
          <span>App token <span style={{ fontWeight: 400 }}>(optional)</span></span>
          <input value={activeQuickbaseConfig.appToken} onChange={(event) => updateQuickbaseField("appToken", event.target.value)} placeholder="Leave blank unless required by your Quickbase admin" />
        </label>
        <label className="field">
          <span>Select your Quickbase app</span>
          <div className="inline-actions">
            <select value={activeQuickbaseConfig.appId} onChange={(event) => applyQuickbaseAppSelection(event.target.value)}>
              <option value="">{realmApps.length ? "Choose an app from the list…" : "Click 'Load my apps' first"}</option>
              {realmApps.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
            <button onClick={() => { void loadRealmApps(); }} disabled={realmAppsLoading}>
              {realmAppsLoading ? "Loading…" : "Load my apps"}
            </button>
          </div>
          <span className="micro">Click "Load my apps" to see all apps available in your Quickbase account, then select the one you want to connect.</span>
        </label>
        <div className="studio-actions">
          <button onClick={() => { void loadQuickbaseMetadata(); }} disabled={quickbaseSchemaLoading}>
            {quickbaseSchemaLoading ? "Loading table list…" : "Connect and load tables"}
          </button>
          {quickbaseSchema ? <button onClick={autoDetectQuickbaseMappings}>Auto-configure settings</button> : null}
        </div>
        {quickbaseSchema ? (
          <div className="card">
            <div className="card-head">
              <strong>{quickbaseSchema.name}</strong>
              <span className="micro">{quickbaseSchema.tables.length} tables loaded</span>
            </div>
            <div className="micro">{quickbaseSchema.description || "Quickbase schema loaded for this app profile."}</div>
          </div>
        ) : null}
      </div>
        </>
      ))}

      {renderStep("refresh", (
        <div className="card">
        <div className="card-head">
          <strong>Automatic data refresh schedule</strong>
          <span className="micro">Set a recurring schedule to pull fresh data from Quickbase into the PostgreSQL database. Reports and dashboards always read from the database, so they load instantly without connecting to Quickbase each time.</span>
        </div>
        <label className="field">
          <span>Enable scheduled refresh</span>
          <select value={activeQuickbaseProfile?.refreshSchedule.enabled ? "enabled" : "disabled"} onChange={(event) => updateRefreshScheduleField("enabled", event.target.value === "enabled")}>
            <option value="disabled">Disabled</option>
            <option value="enabled">Enabled</option>
          </select>
        </label>
        <div className="filter-grid compact-grid">
          <label className="field">
            <span>Cadence</span>
            <select value={activeQuickbaseProfile?.refreshSchedule.cadence || "daily"} onChange={(event) => updateRefreshScheduleField("cadence", event.target.value as StudioDocument["sync"]["refreshSchedule"]["cadence"])}>
              <option value="daily">Nightly / daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label className="field">
            <span>Time</span>
            <input type="time" value={activeQuickbaseProfile?.refreshSchedule.timeOfDay || "02:00"} onChange={(event) => updateRefreshScheduleField("timeOfDay", event.target.value)} />
          </label>
        </div>
        {activeQuickbaseProfile?.refreshSchedule.cadence === "weekly" ? (
          <label className="field">
            <span>Day of week</span>
            <select value={String(activeQuickbaseProfile?.refreshSchedule.dayOfWeek || 0)} onChange={(event) => updateRefreshScheduleField("dayOfWeek", Number(event.target.value))}>
              {weekdayOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        ) : null}
        {activeQuickbaseProfile?.refreshSchedule.cadence === "monthly" ? (
          <label className="field">
            <span>Day of month</span>
            <input type="number" min={1} max={31} value={activeQuickbaseProfile?.refreshSchedule.dayOfMonth || 1} onChange={(event) => updateRefreshScheduleField("dayOfMonth", Math.max(1, Math.min(31, Number(event.target.value) || 1)))} />
          </label>
        ) : null}
        <label className="field">
          <span>Timezone</span>
          <select value={activeQuickbaseProfile?.refreshSchedule.timeZone || "America/Denver"} onChange={(event) => updateRefreshScheduleField("timeZone", event.target.value)}>
            {timezoneOptions.map((timeZone) => (
              <option key={timeZone} value={timeZone}>{timeZone}</option>
            ))}
          </select>
        </label>
        <div className="card">
          <div className="card-head">
            <strong>Which tables should be synced to the database?</strong>
            <span className="micro">Select the Quickbase tables to sync into PostgreSQL. On each refresh (manual or scheduled), data is pulled from Quickbase and stored in the database. Reports and dashboards read from the database — not directly from Quickbase.</span>
          </div>
          <div className="field">
            <span>Tables to sync to PostgreSQL</span>
            <div className="picker-list modal-picker-list">
              {activeProfileTables.map((table) => {
                const tableId = table.quickbaseTableId || table.id;
                const selected = (activeQuickbaseProfile?.refreshSource.tableIds || []).includes(tableId);
                return (
                  <label className="picker-row" key={table.id}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={(event) => {
                        const current = new Set(activeQuickbaseProfile?.refreshSource.tableIds || []);
                        if (event.target.checked) {
                          current.add(tableId);
                        } else {
                          current.delete(tableId);
                        }
                        updateRefreshSourceTables(Array.from(current));
                      }}
                    />
                    <span>{table.name}</span>
                    <em>{tableId}</em>
                  </label>
                );
              })}
              {!activeProfileTables.length ? <div className="empty-hint">Go to the "Connect Quickbase" step first and click "Connect and load tables" to see your available tables.</div> : null}
            </div>
          </div>
          <div className="micro">For each table you select, enter the saved report number from Quickbase (tells the platform which report to sync) and choose the key field (the unique identifier for each record, used to relate tables to each other in the database).</div>
          {activeQuickbaseProfile?.refreshSource.tableIds.length ? (
            <div className="stack-compact">
              {activeQuickbaseProfile.refreshSource.tableIds.map((tableId) => {
                const table = activeProfileTables.find((candidate) => (candidate.quickbaseTableId || candidate.id) === tableId);
                const reportId = activeQuickbaseProfile.refreshSource.reportIds?.[tableId] || "";
                const keyFieldId = activeQuickbaseProfile.refreshSource.keyFieldIds?.[tableId] || "";
                const reportHref = buildQuickbaseSavedReportUrl({
                  realmHostname: activeQuickbaseConfig.realmHostname,
                  tableId
                }, reportId);
                return (
                  <div className="card" key={tableId} style={{ padding: "10px 14px", gap: 8, display: "flex", flexDirection: "column" }}>
                    <strong style={{ fontSize: "0.9em" }}>{table?.name || tableId}</strong>
                    <label className="field">
                      <span>Quickbase saved report number</span>
                      <div className="inline-actions">
                        <input
                          value={reportId}
                          onChange={(event) => updateRefreshSourceReportId(tableId, event.target.value)}
                          placeholder="e.g. 7 — find this in Quickbase under Reports"
                        />
                        <a
                          className="ghost-button btn-help"
                          href={reportHref || undefined}
                          target="_blank"
                          rel="noreferrer"
                          aria-disabled={!reportHref}
                          onClick={(event) => { if (!reportHref) event.preventDefault(); }}
                          title="Open this table in Quickbase to find the report number"
                        >
                          Open in QB
                        </a>
                      </div>
                      <span className="micro">Data from this report is synced into the PostgreSQL database on every refresh.</span>
                    </label>
                    <label className="field">
                      <span>Key field <span style={{ fontWeight: 400 }}>(unique record identifier)</span></span>
                      {table?.fields?.length ? (
                        <select
                          value={keyFieldId}
                          onChange={(event) => updateRefreshSourceKeyFieldId(tableId, event.target.value)}
                        >
                          <option value="">— select the key field —</option>
                          {table.fields.map((field) => (
                            <option key={field.id} value={field.id}>{field.label || field.id} ({field.id})</option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={keyFieldId}
                          onChange={(event) => updateRefreshSourceKeyFieldId(tableId, event.target.value)}
                          placeholder="Field ID — e.g. 3 (Record ID) or your unique identifier field"
                        />
                      )}
                      <span className="micro">The key field uniquely identifies each record. It is used to relate this table to other tables in the database when joining data.</span>
                    </label>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="micro">Every selected table needs a saved report number so the platform knows which Quickbase data to pull, and a key field so records can be uniquely identified and related across tables.</div>
        </div>
        <div className="studio-actions">
          <button type="button" onClick={() => { void reloadRemote(); }} disabled={savingRemote || refreshingCache}>
            Load all settings
          </button>
          <button type="button" onClick={() => { void saveRemote(); }} disabled={savingRemote || refreshingCache}>
            {savingRemote ? "Saving all settings…" : "Save all settings"}
          </button>
          <button type="button" onClick={() => { void refreshAllNow(); }} disabled={refreshingCache}>
            {refreshingCache ? "Refreshing all reports…" : "Refresh all now"}
          </button>
        </div>
        <div className="micro">Save and load always apply to every settings step for this workspace.</div>
        <div className={`sync-status ${activeQuickbaseProfile?.refreshStatus.lastError ? "sync-status-warn" : "sync-status-ok"}`}>
          <strong>{refreshStatusTitle}</strong>
          <span>{refreshStatusDetail}</span>
        </div>
        </div>
      ))}

      {renderStep("automation", (
        <div className="card">
          <ScheduledEmailsPanel documentState={documentState} />
        </div>
      ))}

      {renderStep("storage", (
        <>
          {/* Database status — admin-friendly, no technical details */}
          <div className="card">
            <div className="card-head">
              <strong>Data storage</strong>
              <span className="micro">All platform data is stored securely on the server.</span>
            </div>
            {platformConfigLoading ? (
              <div className="empty-hint">Loading…</div>
            ) : platformConfig ? (
              <>
                <div className={`sync-status ${platformConfig.postgres.connected ? "sync-status-ok" : "sync-status-warn"}`} style={{ margin: 0 }}>
                  <strong>{platformConfig.postgres.connected ? "Database connected" : "Database not configured"}</strong>
                  <span>{platformConfig.postgres.connected ? "All platform data is stored and backed up on the server." : "Contact your system administrator to configure the database connection."}</span>
                </div>
                <div className="summary-grid" style={{ marginTop: 8 }}>
                  <div className="summary-card"><strong>{savedRowsForApp.toLocaleString()}</strong><span>Records in database</span></div>
                  <div className="summary-card"><strong>{platformConfig.auth.sessionTtlHours}h</strong><span>Session timeout</span></div>
                  <div className="summary-card"><strong>{platformConfig.server.publicUrl.replace(/^https?:\/\//, "")}</strong><span>Platform address</span></div>
                </div>
              </>
            ) : (
              <div className="empty-hint">Contact your administrator for storage configuration details.</div>
            )}
          </div>

          {/* Sharing model */}
          <div className="card">
            <div className="card-head">
              <strong>Sharing</strong>
              <span className="micro">Control who can see each report and dashboard.</span>
            </div>
            <div className="stack" style={{ gap: 10 }}>
              <div className="builder-subsection">
                <div className="builder-subsection-head">
                  <strong>Shared with everyone</strong>
                  <span className="micro">Any user who can sign in can see these items. Use for company-wide reports.</span>
                </div>
              </div>
              <div className="builder-subsection">
                <div className="builder-subsection-head">
                  <strong>Shared with specific users or roles</strong>
                  <span className="micro">Only the users or roles you choose can see these items. Set this per-item in the report or dashboard editor.</span>
                </div>
              </div>
              <div className="builder-subsection">
                <div className="builder-subsection-head">
                  <strong>Personal</strong>
                  <span className="micro">Only the creator can see these items. Good for drafts and work-in-progress.</span>
                </div>
              </div>
            </div>
            <div className="micro" style={{ marginTop: 8 }}>
              To change who a report or dashboard is shared with, open it in the Builder and use the Share option.
            </div>
          </div>

          {/* Helpdesk (still Quickbase-connected) */}
          <div className="card">
            <div className="card-head">
              <strong>Helpdesk tickets</strong>
              <span className="micro">Configure the ticket form shown in the top bar (optional — uses your Quickbase app).</span>
            </div>
            <div className="filter-grid compact-grid">
              <label className="field"><span>Helpdesk App DBID</span><input value={activeQuickbaseConfig.helpdeskAppDbid} onChange={(event) => updateQuickbaseField("helpdeskAppDbid", event.target.value)} placeholder="App DBID" /></label>
              <label className="field"><span>Tickets Table DBID</span><input value={activeQuickbaseConfig.helpdeskTicketsTableDbid} onChange={(event) => updateQuickbaseField("helpdeskTicketsTableDbid", event.target.value)} placeholder="Table DBID" /></label>
            </div>
            <div className="filter-grid compact-grid">
              <label className="field"><span>Parent Table DBID</span><input value={activeQuickbaseConfig.helpdeskParentTableDbid} onChange={(event) => updateQuickbaseField("helpdeskParentTableDbid", event.target.value)} placeholder="Table DBID" /></label>
              <label className="field"><span>Parent App ID FID</span><input value={activeQuickbaseConfig.helpdeskParentAppIdFid} onChange={(event) => updateQuickbaseField("helpdeskParentAppIdFid", event.target.value)} placeholder="FID" /></label>
            </div>
            <div className="micro">Leave these blank if you do not use Quickbase for helpdesk tickets.</div>
          </div>
        </>
      ))}

      {renderStep("review", (
        <>
          <div className="summary-grid">
            <div className="summary-card"><strong>{documentState.sync.providerMode === "api" ? "Active" : "Local only"}</strong><span>Workspace mode</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastLoadedAt ? new Date(documentState.sync.lastLoadedAt).toLocaleTimeString() : "Not yet"}</strong><span>Last loaded</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastSavedAt ? new Date(documentState.sync.lastSavedAt).toLocaleTimeString() : "Not yet"}</strong><span>Last saved</span></div>
            <div className="summary-card"><strong>{savedRowsForApp.toLocaleString()}</strong><span>Rows in database</span></div>
          </div>
          <div className="sync-status sync-status-ok">
            <strong>Ready to save</strong>
            <span>Review the summary above, then use the buttons below to reload settings from the server or save your current changes.</span>
          </div>
        </>
      ))}

      <div className="studio-actions">
        <button type="button" className="ghost-button btn-neutral" onClick={() => setActiveStep(settingsSteps[Math.max(0, activeStepIndex - 1)].id)} disabled={activeStepIndex <= 0}>Back</button>
      </div>
      <div className="studio-actions">
        <button type="button" className="ghost-button btn-system" onClick={() => { void reloadRemote(); }}>↺ Reload settings from server</button>
        <button type="button" className="ghost-button btn-create" onClick={() => { void saveRemote(); }} disabled={savingRemote}>{savingRemote ? "Saving…" : "✓ Save settings to server"}</button>
      </div>
    </div>
  );
}
