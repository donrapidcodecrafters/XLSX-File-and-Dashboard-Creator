import type { QuickbaseAppProfile, QuickbaseConnectionConfig, StudioDocument, TableDefinition } from "@studio/shared";
import type { QuickbaseAppSchema, QuickbaseRealmApp, QuickbaseSyncResult } from "../lib/studioApi";

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
  return (
    <div className="stack">
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
        <div className="micro">
          Tip: use <strong>Find apps</strong> to see the Quickbase apps you can access in this realm, then pick the one you want instead of typing the App ID manually.
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
      <div className="card">
        <div className="card-head">
          <strong>Schedule refresh for this app</strong>
          <span className="micro">This schedule applies to the active app profile and refreshes all selected refresh-source tables for that app. Individual report and dashboard pages still have object-scoped refresh.</span>
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
            <span className="micro">Choose the Quickbase tables this app profile should refresh from cache, then enter the full-source report ID for each selected table.</span>
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
          <div className="micro">
            Create one Quickbase source report per selected table that returns every record and every field needed by this platform. Then enter that report ID here, for example `125`.
          </div>
          {activeQuickbaseProfile?.refreshSource.tableIds.length ? (
            <div className="stack-compact">
              {activeQuickbaseProfile.refreshSource.tableIds.map((tableId) => {
                const table = activeProfileTables.find((candidate) => (candidate.quickbaseTableId || candidate.id) === tableId);
                return (
                  <label className="field" key={tableId}>
                    <span>{table?.name || tableId} report ID</span>
                    <input
                      value={activeQuickbaseProfile.refreshSource.reportIds?.[tableId] || ""}
                      onChange={(event) => updateRefreshSourceReportId(tableId, event.target.value)}
                      placeholder="Quickbase report ID / qid"
                    />
                  </label>
                );
              })}
            </div>
          ) : null}
          <div className="micro">
            Requirement: every selected table must have a report ID. Scheduled refresh for this app uses all of the selected table/report ID pairs.
          </div>
        </div>
        <div className="studio-actions">
          <button onClick={saveRemote} disabled={savingRemote || refreshingCache}>
            {savingRemote ? "Saving settings…" : "Save schedule settings"}
          </button>
          <button onClick={() => { void refreshAllNow(); }} disabled={refreshingCache}>
            {refreshingCache ? "Refreshing all reports…" : "Refresh all now"}
          </button>
        </div>
        <div className="micro">
          This app schedule is saved with the rest of the system settings JSON in Quickbase.
        </div>
        <div className={`sync-status ${activeQuickbaseProfile?.refreshStatus.lastError ? "sync-status-warn" : "sync-status-ok"}`}>
          <strong>{refreshStatusTitle}</strong>
          <span>{refreshStatusDetail}</span>
        </div>
      </div>
      <div className="studio-actions">
        <button onClick={reloadRemote}>Load from server</button>
        <button onClick={saveRemote} disabled={savingRemote}>{savingRemote ? "Saving…" : "Save to Quickbase and server"}</button>
      </div>
      {lastQuickbaseSync ? (
        <div className={`sync-status ${lastQuickbaseSync.ok ? "sync-status-ok" : "sync-status-warn"}`}>
          <strong>{lastQuickbaseSync.ok ? "Quickbase save succeeded" : "Quickbase save needs attention"}</strong>
          <span>{lastQuickbaseSync.message}</span>
          <span>
            {lastQuickbaseSync.savedObjects} saved reports or dashboards · {lastQuickbaseSync.savedSettings} user settings rows · {lastQuickbaseSync.savedVersions} version rows
          </span>
        </div>
      ) : null}
      <div className="card">
        <div className="card-head">
          <strong>Saved reports and dashboards</strong>
          <span className="micro">Type the DBID and field FIDs for the table that stores report and dashboard definitions.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.objectTableId} onChange={(event) => updateQuickbaseField("objectTableId", event.target.value)} placeholder="Table DBID for saved reports and dashboards" /></label>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Item key field FID</span><input value={activeQuickbaseConfig.objectKeyFieldId} onChange={(event) => updateQuickbaseField("objectKeyFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>Type field FID</span><input value={activeQuickbaseConfig.objectTypeFieldId} onChange={(event) => updateQuickbaseField("objectTypeFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Name field FID</span><input value={activeQuickbaseConfig.objectNameFieldId} onChange={(event) => updateQuickbaseField("objectNameFieldId", event.target.value)} placeholder="FID" /></label>
          <label className="field"><span>JSON field FID</span><input value={activeQuickbaseConfig.objectConfigFieldId} onChange={(event) => updateQuickbaseField("objectConfigFieldId", event.target.value)} placeholder="FID" /></label>
        </div>
        <div className="filter-grid compact-grid">
          <label className="field"><span>Owner field FID</span><input value={activeQuickbaseConfig.objectOwnerFieldId} onChange={(event) => updateQuickbaseField("objectOwnerFieldId", event.target.value)} placeholder="Optional FID" /></label>
          <label className="field"><span>Updated at field FID</span><input value={activeQuickbaseConfig.objectUpdatedAtFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedAtFieldId", event.target.value)} placeholder="Optional FID" /></label>
        </div>
        <label className="field"><span>Updated by field FID</span><input value={activeQuickbaseConfig.objectUpdatedByFieldId} onChange={(event) => updateQuickbaseField("objectUpdatedByFieldId", event.target.value)} placeholder="Optional FID" /></label>
      </div>
      <div className="card">
        <div className="card-head">
          <strong>User settings</strong>
          <span className="micro">Type the DBID and field FIDs for the table that stores per-user settings and storage configuration.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.settingsTableId} onChange={(event) => updateQuickbaseField("settingsTableId", event.target.value)} placeholder="Table DBID for user settings" /></label>
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
          <strong>Version history</strong>
          <span className="micro">Type the DBID and field FIDs for the table that stores version history and snapshots.</span>
        </div>
        <label className="field"><span>Table DBID</span><input value={activeQuickbaseConfig.versionTableId} onChange={(event) => updateQuickbaseField("versionTableId", event.target.value)} placeholder="Table DBID for version history" /></label>
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
    </div>
  );
}
