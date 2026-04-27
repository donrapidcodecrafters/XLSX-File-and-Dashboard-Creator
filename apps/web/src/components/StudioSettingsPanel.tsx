import { useMemo, useState, type ReactNode } from "react";
import type { QuickbaseAppProfile, QuickbaseConnectionConfig, StudioDocument, TableDefinition } from "@studio/shared";
import type { QuickbaseAppSchema, QuickbaseRealmApp, QuickbaseSyncResult } from "../lib/studioApi";
import { buildQuickbaseSavedReportUrl } from "../lib/quickbaseLinks";

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
  saveRemote: () => void;
  refreshAllNow: () => Promise<void>;
  reloadRemote: () => void;
}) {
  const settingsSteps = useMemo(() => ([
    { id: "overview", label: "Overview", description: "Branding, session, and current connection status." },
    { id: "profiles", label: "Profiles", description: "Quickbase app profiles and active app connection details." },
    { id: "refresh", label: "Refresh", description: "Scheduled refresh settings and source report mappings." },
    { id: "storage", label: "Storage", description: "Saved objects, settings, sharing roster, and version table mappings." },
    { id: "review", label: "Review", description: "Save, reload, and confirm the current app sync state." }
  ]), []);
  const [activeStep, setActiveStep] = useState<(typeof settingsSteps)[number]["id"]>("overview");
  const activeStepIndex = settingsSteps.findIndex((step) => step.id === activeStep);
  const activeStepMeta = settingsSteps[activeStepIndex] || settingsSteps[0];
  function renderStep(id: (typeof settingsSteps)[number]["id"], content: ReactNode) {
    if (activeStep !== id) return null;
    return content;
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
            <div className="summary-card"><strong>{documentState.sync.providerMode === "api" ? "Connected" : "Local draft"}</strong><span>Connection</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastLoadedAt ? new Date(documentState.sync.lastLoadedAt).toLocaleTimeString() : "n/a"}</strong><span>Last load</span></div>
            <div className="summary-card"><strong>{documentState.sync.lastSavedAt ? new Date(documentState.sync.lastSavedAt).toLocaleTimeString() : "n/a"}</strong><span>Last save</span></div>
            <div className="summary-card"><strong>{activeQuickbaseProfile?.refreshStatus.lastSuccessAt ? new Date(activeQuickbaseProfile.refreshStatus.lastSuccessAt).toLocaleString() : "Not refreshed"}</strong><span>Last app refresh</span></div>
            <div className="summary-card"><strong>{activeQuickbaseProfile?.refreshStatus.nextRunAt ? new Date(activeQuickbaseProfile.refreshStatus.nextRunAt).toLocaleString() : "Not scheduled"}</strong><span>Next app refresh</span></div>
            <div className="summary-card"><strong>{savedRowsForApp.toLocaleString()}</strong><span>Rows saved for faster loading</span></div>
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
          <div className="card">
        <div className="card-head">
          <strong>Quickbase app profiles</strong>
          <span className="micro">Connect several Quickbase apps in the same realm and keep their DBIDs, FIDs, schedules, and refresh source reports separate.</span>
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
          <strong>Quickbase connection for this app</strong>
          <span className="micro">Load the app schema first, then choose the refresh-source tables and report IDs for this app.</span>
        </div>
        <label className="field">
          <span>Realm hostname</span>
          <input value={activeQuickbaseConfig.realmHostname} onChange={(event) => updateQuickbaseField("realmHostname", event.target.value)} placeholder="yourrealm.quickbase.com" />
        </label>
        <label className="field">
          <span>User token</span>
          <input value={activeQuickbaseConfig.userToken} onChange={(event) => updateQuickbaseField("userToken", event.target.value)} placeholder="QB-USER-TOKEN ..." />
        </label>
        <label className="field">
          <span>App token</span>
          <input value={activeQuickbaseConfig.appToken} onChange={(event) => updateQuickbaseField("appToken", event.target.value)} placeholder="Optional app token" />
        </label>
        <label className="field">
          <span>App ID</span>
          <input value={activeQuickbaseConfig.appId} onChange={(event) => updateQuickbaseField("appId", event.target.value)} placeholder="App DBID" />
        </label>
        <label className="field">
          <span>Choose from your Quickbase apps</span>
          <div className="inline-actions">
            <select value={activeQuickbaseConfig.appId} onChange={(event) => applyQuickbaseAppSelection(event.target.value)}>
              <option value="">Select an app from this realm</option>
              {realmApps.map((item) => (
                <option key={item.id} value={item.id}>{item.name} ({item.id})</option>
              ))}
            </select>
            <button onClick={() => { void loadRealmApps(); }} disabled={realmAppsLoading}>
              {realmAppsLoading ? "Finding apps…" : "Find apps"}
            </button>
          </div>
        </label>
        <label className="field">
          <span>API base URL</span>
          <input value={activeQuickbaseConfig.apiBaseUrl} onChange={(event) => updateQuickbaseField("apiBaseUrl", event.target.value)} placeholder="https://api.quickbase.com/v1" />
        </label>
        <div className="studio-actions">
          <button onClick={() => { void loadQuickbaseMetadata(); }} disabled={quickbaseSchemaLoading}>
            {quickbaseSchemaLoading ? "Loading tables and fields…" : "Load tables and fields"}
          </button>
          {quickbaseSchema ? <button onClick={autoDetectQuickbaseMappings}>Auto-detect storage fields</button> : null}
        </div>
        <div className="micro">Use Find apps to choose an app from this realm.</div>
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
          <strong>Schedule refresh for this app</strong>
          <span className="micro">This schedule refreshes the selected source tables for the active app profile.</span>
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
            <strong>Refresh source reports</strong>
            <span className="micro">Choose the tables and report IDs used for refresh.</span>
          </div>
          <div className="field">
            <span>Tables to refresh</span>
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
              {!activeProfileTables.length ? <div className="empty-hint">Load tables and fields for this app first.</div> : null}
            </div>
          </div>
          <div className="micro">Enter the saved report ID for each selected table.</div>
          {activeQuickbaseProfile?.refreshSource.tableIds.length ? (
            <div className="stack-compact">
              {activeQuickbaseProfile.refreshSource.tableIds.map((tableId) => {
                const table = activeProfileTables.find((candidate) => (candidate.quickbaseTableId || candidate.id) === tableId);
                const reportId = activeQuickbaseProfile.refreshSource.reportIds?.[tableId] || "";
                const reportHref = buildQuickbaseSavedReportUrl({
                  realmHostname: activeQuickbaseConfig.realmHostname,
                  tableId
                }, reportId);
                return (
                  <label className="field" key={tableId}>
                    <span>{table?.name || tableId} report ID</span>
                    <div className="inline-actions">
                      <input
                        value={reportId}
                        onChange={(event) => updateRefreshSourceReportId(tableId, event.target.value)}
                        placeholder="Quickbase report ID"
                      />
                      <a
                        className="ghost-button"
                        href={reportHref || undefined}
                        target="_blank"
                        rel="noreferrer"
                        aria-disabled={!reportHref}
                        onClick={(event) => {
                          if (!reportHref) {
                            event.preventDefault();
                          }
                        }}
                      >
                        Open in QB
                      </a>
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}
          <div className="micro">Every selected table needs a report ID.</div>
        </div>
        <div className="studio-actions">
          <button onClick={saveRemote} disabled={savingRemote || refreshingCache}>
            {savingRemote ? "Saving settings…" : "Save schedule settings"}
          </button>
          <button onClick={() => { void refreshAllNow(); }} disabled={refreshingCache}>
            {refreshingCache ? "Refreshing all reports…" : "Refresh all now"}
          </button>
        </div>
        <div className="micro">Schedule settings are saved in Quickbase.</div>
        <div className={`sync-status ${activeQuickbaseProfile?.refreshStatus.lastError ? "sync-status-warn" : "sync-status-ok"}`}>
          <strong>{refreshStatusTitle}</strong>
          <span>{refreshStatusDetail}</span>
        </div>
        </div>
      ))}

      {renderStep("storage", (
        <>
          <div className="card">
        <div className="card-head">
          <strong>Saved reports and dashboards</strong>
          <span className="micro">Enter the DBID and field FIDs for the saved reports table.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.objectTableId} onChange={(event) => updateQuickbaseField("objectTableId", event.target.value)} placeholder="Table DBID" /></label>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Item key field FID</span><input value={activeQuickbaseConfig.objectKeyFieldId} onChange={(event) => updateQuickbaseField("objectKeyFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Type field FID</span><input value={activeQuickbaseConfig.objectTypeFieldId} onChange={(event) => updateQuickbaseField("objectTypeFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Name field FID</span><input value={activeQuickbaseConfig.objectNameFieldId} onChange={(event) => updateQuickbaseField("objectNameFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>JSON field FID</span><input value={activeQuickbaseConfig.objectConfigFieldId} onChange={(event) => updateQuickbaseField("objectConfigFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Report creator field FID</span><input value={activeQuickbaseConfig.objectOwnerFieldId} onChange={(event) => updateQuickbaseField("objectOwnerFieldId", event.target.value)} placeholder="Optional FID" /></label>
          <label className="field"><span>Personal report owner field FID</span><input value={activeQuickbaseConfig.objectPersonalOwnerFieldId} onChange={(event) => updateQuickbaseField("objectPersonalOwnerFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Updated at field FID</span><input value={activeQuickbaseConfig.objectUpdatedAtFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedAtFieldId", event.target.value)} placeholder="Optional FID" /></label>
          <label className="field"><span>Updated by field FID</span><input value={activeQuickbaseConfig.objectUpdatedByFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <div className="micro">Report creator stores who created the item. Personal report owner is only used for personal visibility.</div>
      </div>
      <div className="card">
        <div className="card-head">
          <strong>User settings</strong>
          <span className="micro">Enter the DBID and field FIDs for user settings.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.settingsTableId} onChange={(event) => updateQuickbaseField("settingsTableId", event.target.value)} placeholder="Table DBID" /></label>
        <div className="filter-grid compact-grid">
          <label className="field"><span>User field FID</span><input value={activeQuickbaseConfig.settingsUserFieldId} onChange={(event) => updateQuickbaseField("settingsUserFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Object record field FID</span><input value={activeQuickbaseConfig.settingsObjectFieldId} onChange={(event) => updateQuickbaseField("settingsObjectFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Object key field FID</span><input value={activeQuickbaseConfig.settingsObjectKeyFieldId} onChange={(event) => updateQuickbaseField("settingsObjectKeyFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Updated by field FID</span><input value={activeQuickbaseConfig.settingsUpdatedByFieldId} onChange={(event) => updateQuickbaseField("settingsUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <label className="field"><span>Settings JSON field FID</span><input value={activeQuickbaseConfig.settingsJsonFieldId} onChange={(event) => updateQuickbaseField("settingsJsonFieldId", event.target.value)} placeholder="FID" /></label>
      </div>
      <div className="card">
        <div className="card-head">
          <strong>Sharing roster</strong>
          <span className="micro">Use a roster table for selected-user sharing.</span>
        </div>
        <label className="field"><span>Roster table DBID</span><input value={activeQuickbaseConfig.rosterTableId} onChange={(event) => updateQuickbaseField("rosterTableId", event.target.value)} placeholder="Optional DBID" /></label>
        <div className="filter-grid compact-grid">
          <label className="field"><span>User ID field FID</span><input value={activeQuickbaseConfig.rosterUserIdFieldId} onChange={(event) => updateQuickbaseField("rosterUserIdFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Employee name field FID</span><input value={activeQuickbaseConfig.rosterEmployeeNameFieldId} onChange={(event) => updateQuickbaseField("rosterEmployeeNameFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Employee email field FID</span><input value={activeQuickbaseConfig.rosterEmployeeEmailFieldId} onChange={(event) => updateQuickbaseField("rosterEmployeeEmailFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Employee record ID field FID</span><input value={activeQuickbaseConfig.rosterEmployeeRecordIdFieldId} onChange={(event) => updateQuickbaseField("rosterEmployeeRecordIdFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <div className="micro">Selected-user sharing stores Quickbase user IDs from this roster.</div>
      </div>
      <div className="card">
        <div className="card-head">
          <strong>Version history</strong>
          <span className="micro">Enter the DBID and field FIDs for version history.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.versionTableId} onChange={(event) => updateQuickbaseField("versionTableId", event.target.value)} placeholder="Table DBID" /></label>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Object record field FID</span><input value={activeQuickbaseConfig.versionObjectFieldId} onChange={(event) => updateQuickbaseField("versionObjectFieldId", event.target.value)} placeholder="Optional FID" /></label>
          <label className="field"><span>Object key field FID</span><input value={activeQuickbaseConfig.versionObjectKeyFieldId} onChange={(event) => updateQuickbaseField("versionObjectKeyFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Snapshot JSON field FID</span><input value={activeQuickbaseConfig.versionSnapshotFieldId} onChange={(event) => updateQuickbaseField("versionSnapshotFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Changed at field FID</span><input value={activeQuickbaseConfig.versionChangedAtFieldId} onChange={(event) => updateQuickbaseField("versionChangedAtFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Changed by field FID</span><input value={activeQuickbaseConfig.versionChangedByFieldId} onChange={(event) => updateQuickbaseField("versionChangedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
          <label className="field"><span>Updated by field FID</span><input value={activeQuickbaseConfig.versionUpdatedByFieldId} onChange={(event) => updateQuickbaseField("versionUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
      </div>
        </>
      ))}

      {renderStep("review", (
        <>
          <div className="summary-grid">
            <div className="summary-card"><strong>{documentState.sync.providerMode === "api" ? "Connected" : "Local draft"}</strong><span>Connection</span></div>
            <div className="summary-card"><strong>{activeQuickbaseConfig.appId || "Not set"}</strong><span>Active app ID</span></div>
            <div className="summary-card"><strong>{activeQuickbaseProfile?.refreshSource.tableIds.length || 0}</strong><span>Tables selected for refresh</span></div>
            <div className="summary-card"><strong>{savedRowsForApp.toLocaleString()}</strong><span>Rows cached for this app</span></div>
          </div>
          {lastQuickbaseSync ? (
            <div className={`sync-status ${lastQuickbaseSync.ok ? "sync-status-ok" : "sync-status-warn"}`}>
              <strong>{lastQuickbaseSync.ok ? "Quickbase save succeeded" : "Quickbase save needs attention"}</strong>
              <span>{lastQuickbaseSync.message}</span>
              <span>
                {lastQuickbaseSync.savedObjects} saved reports or dashboards · {lastQuickbaseSync.savedSettings} user settings rows · {lastQuickbaseSync.savedVersions} version rows
              </span>
            </div>
          ) : (
            <div className="sync-status">
              <strong>Ready to save</strong>
              <span>Use the actions below to load from the server or save the current settings into Quickbase and the server document.</span>
            </div>
          )}
        </>
      ))}

      <div className="studio-actions">
        <button type="button" className="ghost-button" onClick={() => setActiveStep(settingsSteps[Math.max(0, activeStepIndex - 1)].id)} disabled={activeStepIndex <= 0}>Back</button>
        <button type="button" onClick={() => setActiveStep(settingsSteps[Math.min(settingsSteps.length - 1, activeStepIndex + 1)].id)} disabled={activeStepIndex >= settingsSteps.length - 1}>Next</button>
      </div>
      <div className="studio-actions">
        <button onClick={reloadRemote}>Load from server</button>
        <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to Quickbase and server"}</button>
      </div>
    </div>
  );
}
