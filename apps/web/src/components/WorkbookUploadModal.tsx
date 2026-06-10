import { useEffect, useRef, useState } from "react";
import { fetchStudioSources, getWorkbookProfile, importStudioWorkbook, importStudioWorkbookSource, peekXlsxFile, saveWorkbookProfile } from "../lib/studioApi";
import type { StudioSourceSummary, StudioWorkbookImportResult, StudioWorkbookSourceImportResult, WorkbookProfile, XlsxSheetPeek } from "../lib/studioApi";

type UploadMode = "data-source" | "template";

export interface WorkbookUploadResult {
  mode: UploadMode;
  recreated: boolean;
  workbookImport?: StudioWorkbookImportResult;
  sourceImport?: StudioWorkbookSourceImportResult & { reports: unknown[]; dashboard: unknown | null };
}

interface FilePeek {
  sheetNames: string[];
  sheets: XlsxSheetPeek[];
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface WorkbookUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: WorkbookUploadResult) => void;
}

const T = {
  bg:          "var(--surface, #fff)",
  bgAlt:       "var(--surface-alt, #F9FAFB)",
  border:      "var(--border, #E5E7EB)",
  borderMd:    "var(--border-md, #D1D5DB)",
  brand:       "var(--brand, #0d7c66)",
  brandDeep:   "var(--brand-deep, #065F46)",
  brandLight:  "var(--brand-light, #ECFDF5)",
  brandBorder: "var(--brand-border, #A7F3D0)",
  text:        "var(--text, #111827)",
  textSoft:    "var(--text-soft, #6B7280)",
  textSecondary: "var(--text-secondary, #374151)",
  infoBg:      "var(--info-bg, #EFF6FF)",
  infoBorder:  "var(--info-border, #BFDBFE)",
  infoText:    "var(--info-text, #1E40AF)",
  errorBg:     "var(--error-bg, #FEF2F2)",
  errorBorder: "var(--error-border, #FECACA)",
  errorText:   "var(--error-text, #991B1B)",
  trackOff:    "var(--track-off, #D1D5DB)",
  radius:      "10px",
  radiusSm:    "6px",
  shadowXl:    "0 20px 25px rgba(0,0,0,0.12), 0 8px 10px rgba(0,0,0,0.06)",
  font:        "'Inter', 'Segoe UI', system-ui, sans-serif",
};

/** Derives a stable source ID from a user-typed name, matching the server's normalizeBaseSourceId logic. */
function slugify(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "workbook";
}
function nameToSourceId(name: string) {
  return `xlsx:${slugify(name)}`;
}

export function WorkbookUploadModal({ open, onClose, onSuccess }: WorkbookUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // UI state
  const [mode, setMode] = useState<UploadMode>("data-source");
  const [recreate, setRecreate] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [peek, setPeek] = useState<FilePeek | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  // Sheet selection: which tabs contain raw data (become Postgres tables)
  const [dataSheets, setDataSheets] = useState<string[]>([]);

  // Workbook import profile (saved settings from previous imports)
  const [profile, setProfile] = useState<WorkbookProfile | null>(null);
  const [profileApplied, setProfileApplied] = useState(false);

  // Workbook picker state (data-source mode only)
  const [xlsxSources, setXlsxSources] = useState<StudioSourceSummary[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  // "" = nothing chosen, "new" = creating new, anything else = existing sourceId
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [newWorkbookName, setNewWorkbookName] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load existing xlsx sources whenever modal opens in data-source mode
  useEffect(() => {
    if (!open || mode !== "data-source") return;
    setSourcesLoading(true);
    fetchStudioSources()
      .then((res: { sources: StudioSourceSummary[] }) => {
        setXlsxSources(res.sources.filter((s) => s.sourceType === "xlsx"));
      })
      .catch(() => { /* non-blocking */ })
      .finally(() => setSourcesLoading(false));
  }, [open, mode]);

  // Load saved profile when an existing workbook is selected
  useEffect(() => {
    if (!selectedSourceId || selectedSourceId === "new") {
      setProfile(null); setProfileApplied(false); return;
    }
    getWorkbookProfile(selectedSourceId)
      .then((res) => {
        setProfile(res.profile);
        // Auto-apply saved data sheets if no file peeked yet
        if (res.profile.dataSheets?.length > 0) {
          setDataSheets(res.profile.dataSheets);
          setProfileApplied(true);
        }
        // Default to data-only update so user edits in reports/dashboards are preserved
        setRecreate(false);
      })
      .catch(() => { setProfile(null); setProfileApplied(false); });
  }, [selectedSourceId]);

  // When a new file is peeked and we have a saved profile, override auto-detection with profile sheets
  useEffect(() => {
    if (!profile || !peek) return;
    const saved = profile.dataSheets.filter((name) => peek.sheets?.some((s) => s.name === name));
    if (saved.length > 0) { setDataSheets(saved); setProfileApplied(true); }
  }, [peek, profile]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  function reset() {
    setFile(null); setPeek(null); setError(""); setImporting(false);
    setDragging(false); setSelectedSourceId(""); setNewWorkbookName("");
    setDropdownOpen(false); setDataSheets([]);
  }

  function handleClose() {
    if (importing) return;
    reset(); onClose();
  }

  async function acceptFile(f: File | null | undefined) {
    if (!f) return;
    const isXlsx = f.name.toLowerCase().endsWith(".xlsx") ||
      f.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    if (!isXlsx) { setError("Only .xlsx files are supported."); return; }
    setError(""); setPeek(null); setFile(f);
    // Auto-fill new workbook name from filename if user is creating new
    if (selectedSourceId === "new" && !newWorkbookName) {
      setNewWorkbookName(f.name.replace(/\.xlsx$/i, "").replace(/[-_]/g, " ").trim());
    }
    setPeeking(true);
    try {
      const r = await peekXlsxFile(f);
      setPeek(r);
        // Auto-select: prefer saved profile sheets, then heuristic, then all
      const autoSelected = (r.sheets || []).filter((s) => s.looksLikeData).map((s) => s.name);
      if (!profile) {
        setDataSheets(autoSelected.length > 0 ? autoSelected : (r.sheets || []).map((s) => s.name));
      }
    } catch { /* non-blocking */ }
    finally { setPeeking(false); }
  }

  async function handleSubmit() {
    if (!file || importing) return;
    setImporting(true); setError("");
    try {
      if (mode === "data-source") {
        // Determine which sourceId / sourceName to pass
        const isNew = selectedSourceId === "new" || selectedSourceId === "";
        const sourceIdArg = isNew ? undefined : selectedSourceId;
        const sourceNameArg = isNew ? (newWorkbookName.trim() || file.name.replace(/\.xlsx$/i, "").trim()) : undefined;
        // Only send dataSheets when there are multiple sheets and the user made a selection.
        const multiSheet = (peek?.sheets?.length ?? 0) > 1;
        const dataSheetsArg = multiSheet && dataSheets.length > 0 ? dataSheets : undefined;
        const opts = { sourceId: sourceIdArg, sourceName: sourceNameArg, dataSheets: dataSheetsArg };

        if (recreate) {
          // Import data to Postgres only — report creation happens in the review modal
          const sourceResult = await importStudioWorkbookSource(file, opts);
          // Analyze workbook structure for the review modal (cap rows to avoid OOM on large data sheets)
          const workbookResult = await importStudioWorkbook(file, { maxRowsPerSheet: 500 });
          const profileId = sourceResult.sources?.[0]?.sourceId ?? sourceIdArg ?? slugify(sourceNameArg || file.name);
          if (profileId) {
            void saveWorkbookProfile(profileId, {
              workbookName: sourceNameArg || profile?.workbookName || file.name.replace(/\.xlsx$/i, ""),
              dataSheets: dataSheetsArg || dataSheets,
              sourceIds: sourceResult.sources?.map((s: { sourceId: string }) => s.sourceId) || [],
              objectIds: []
            }).catch(() => {});
          }
          onSuccess({ mode, recreated: true, sourceImport: sourceResult as typeof sourceResult & { reports: unknown[]; dashboard: unknown | null }, workbookImport: workbookResult });
        } else {
          const result = await importStudioWorkbookSource(file, opts);
          // Update profile data sheets on data-only reimport
          const profileId = sourceIdArg || profile?.id;
          if (profileId) {
            void saveWorkbookProfile(profileId, {
              dataSheets: dataSheetsArg || dataSheets,
              sourceIds: result.sources?.map((s: { sourceId: string }) => s.sourceId) || profile?.sourceIds || []
            }).catch(() => {});
          }
          onSuccess({ mode, recreated: false, sourceImport: result as typeof result & { reports: unknown[]; dashboard: unknown | null } });
        }
      } else {
        const result = await importStudioWorkbook(file);
        onSuccess({ mode, recreated: recreate, workbookImport: result });
      }
      reset(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setImporting(false);
    }
  }

  if (!open) return null;

  const isData = mode === "data-source";
  const selectedSource = xlsxSources.find((s) => s.sourceId === selectedSourceId);
  const isUpdating = Boolean(selectedSource);
  const multiSheet = (peek?.sheets?.length ?? 0) > 1;
  const hasDataSheetSelection = !isData || !multiSheet || dataSheets.length > 0;
  const canSubmit = Boolean(file) && !importing && !peeking && hasDataSheetSelection && (
    !isData ||
    selectedSourceId === "" ||
    (selectedSourceId === "new" && newWorkbookName.trim().length > 0) ||
    isUpdating
  );

  // Label for the picker button
  function pickerLabel() {
    if (sourcesLoading) return "Loading workbooks…";
    if (selectedSourceId === "new") return `+ New workbook${newWorkbookName.trim() ? ` — "${newWorkbookName.trim()}"` : ""}`;
    if (selectedSource) return `Update: ${selectedSource.sourceName}`;
    if (xlsxSources.length === 0) return "New workbook (no existing workbooks yet)";
    return "Select workbook…";
  }

  const submitLabel = importing
    ? "Importing…"
    : isData
      ? isUpdating
        ? recreate ? `Update "${selectedSource!.sourceName}" + refresh reports` : `Update "${selectedSource!.sourceName}"`
        : recreate ? "Import & create reports and dashboard" : "Import as data source"
      : "Import report layouts";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{
        width: "100%", maxWidth: 540,
        background: T.bg, borderRadius: 16,
        border: `1px solid ${T.border}`, boxShadow: T.shadowXl,
        display: "flex", flexDirection: "column", gap: 0,
        maxHeight: "calc(100dvh - 48px)", overflowY: "auto",
        fontFamily: T.font,
      }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 20px 16px" }}>
          <h2 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 700, color: T.text, letterSpacing: "-0.01em" }}>
            Import Excel File
          </h2>
          <button
            onClick={handleClose} disabled={importing} type="button"
            style={{
              width: 32, height: 32, borderRadius: 8,
              border: `1px solid ${T.border}`, background: T.bgAlt,
              color: T.textSoft, fontSize: "1rem", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0, fontFamily: T.font, lineHeight: 1,
            }}
          >✕</button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, padding: "0 20px 20px" }}>

          {/* Mode selection */}
          <div>
            <p style={{ margin: "0 0 8px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.textSoft }}>
              What is in this file?
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8 }}>
              {[
                { id: "data-source", title: "The file contains my data", desc: "Rows of information (sales, claims, employees, etc.) you want to report on." },
                { id: "template", title: "The file defines report layouts", desc: "A workbook showing how reports should look, using data already in the platform." },
              ].map((opt) => {
                const active = mode === opt.id;
                return (
                  <button
                    key={opt.id} type="button"
                    onClick={() => { setMode(opt.id as UploadMode); setSelectedSourceId(""); setNewWorkbookName(""); }}
                    disabled={importing}
                    style={{
                      display: "flex", flexDirection: "column", gap: 4,
                      padding: "12px 12px", borderRadius: T.radius, textAlign: "left",
                      border: active ? `2px solid ${T.brand}` : `1px solid ${T.border}`,
                      background: active ? T.brandLight : T.bgAlt,
                      cursor: importing ? "not-allowed" : "pointer",
                      transition: "border-color 100ms, background 100ms",
                      fontFamily: T.font, minHeight: 0,
                      boxShadow: active ? `0 0 0 3px rgba(13,124,102,0.1)` : "none",
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: active ? T.brandDeep : T.text, lineHeight: 1.3 }}>
                      {opt.title}
                    </span>
                    <span style={{ fontSize: 12, color: T.textSoft, lineHeight: 1.4, fontWeight: 400 }}>
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recreate toggle */}
          <div style={{
            display: "flex", alignItems: "flex-start", gap: 12,
            padding: "12px 14px", borderRadius: T.radius,
            border: `1px solid ${recreate ? T.brand : T.border}`,
            background: recreate ? T.brandLight : T.bgAlt,
            cursor: importing ? "not-allowed" : "pointer", fontFamily: T.font,
            transition: "border-color 100ms, background 100ms",
          }} onClick={() => { if (!importing) setRecreate((r) => !r); }}>
            <div style={{
              flexShrink: 0, marginTop: 2,
              width: 34, height: 18, borderRadius: 9,
              background: recreate ? T.brand : T.trackOff,
              position: "relative", transition: "background 150ms",
            }}>
              <div style={{
                position: "absolute", width: 14, height: 14, borderRadius: "50%",
                background: "#fff", top: 2, left: recreate ? 18 : 2, transition: "left 150ms",
                boxShadow: "0 1px 3px rgba(0,0,0,0.18)",
              }} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, lineHeight: 1.3, marginBottom: 3 }}>
                {isData
                  ? "Automatically create reports and a dashboard from this file"
                  : "Recreate the workbook tab structure as a dashboard"}
              </div>
              <div style={{ fontSize: 12, color: T.textSoft, lineHeight: 1.5, fontWeight: 400 }}>
                {isData
                  ? "The platform will read any chart tabs in your workbook and create matching reports and a dashboard automatically. Turn this off to only import the data rows."
                  : "Each tab with charts becomes a dashboard tab with matching report cards."}
              </div>
            </div>
          </div>

          {/* ── Workbook picker (data-source mode only) ── */}
          {isData && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, letterSpacing: "0.01em" }}>
                Which workbook does this file belong to?
              </label>

              {/* Custom dropdown */}
              <div ref={dropdownRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  disabled={importing || sourcesLoading}
                  onClick={() => !importing && !sourcesLoading && setDropdownOpen((o) => !o)}
                  style={{
                    width: "100%", padding: "9px 12px",
                    borderRadius: T.radiusSm, fontFamily: T.font,
                    border: `1px solid ${dropdownOpen ? T.brand : T.borderMd}`,
                    background: T.bg, color: selectedSourceId ? T.text : T.textSoft,
                    fontSize: 13, textAlign: "left", cursor: importing ? "not-allowed" : "pointer",
                    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
                    boxShadow: dropdownOpen ? `0 0 0 3px rgba(13,124,102,0.12)` : "none",
                    boxSizing: "border-box",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                    {pickerLabel()}
                  </span>
                  <span style={{ color: T.textSoft, fontSize: 10, flexShrink: 0 }}>{dropdownOpen ? "▲" : "▼"}</span>
                </button>

                {dropdownOpen && (
                  <div style={{
                    position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0,
                    background: T.bg, border: `1px solid ${T.borderMd}`, borderRadius: T.radius,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.12)", zIndex: 100,
                    maxHeight: 260, overflowY: "auto",
                  }}>
                    {/* Existing workbooks */}
                    {xlsxSources.length > 0 && (
                      <>
                        <div style={{ padding: "8px 12px 4px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: T.textSoft }}>
                          Update existing workbook
                        </div>
                        {xlsxSources.map((source) => (
                          <button
                            key={source.sourceId}
                            type="button"
                            onClick={() => { setSelectedSourceId(source.sourceId); setDropdownOpen(false); }}
                            style={{
                              display: "flex", flexDirection: "column", gap: 1,
                              width: "100%", padding: "9px 12px", textAlign: "left",
                              background: selectedSourceId === source.sourceId ? T.brandLight : "transparent",
                              border: "none", cursor: "pointer", fontFamily: T.font,
                              borderBottom: `1px solid ${T.border}`,
                            }}
                            onMouseEnter={(e) => { if (selectedSourceId !== source.sourceId) e.currentTarget.style.background = T.bgAlt; }}
                            onMouseLeave={(e) => { if (selectedSourceId !== source.sourceId) e.currentTarget.style.background = "transparent"; }}
                          >
                            <span style={{ fontSize: 13, fontWeight: 600, color: selectedSourceId === source.sourceId ? T.brandDeep : T.text }}>
                              {source.sourceName}
                            </span>
                            <span style={{ fontSize: 11, color: T.textSoft }}>
                              {source.rowCount.toLocaleString()} rows · {source.fieldCount} columns · last updated {source.updatedAt ? new Date(source.updatedAt).toLocaleDateString() : "never"}
                            </span>
                          </button>
                        ))}
                        <div style={{ height: 4 }} />
                      </>
                    )}

                    {/* Add new */}
                    <button
                      type="button"
                      onClick={() => { setSelectedSourceId("new"); setDropdownOpen(false); if (!newWorkbookName && file) setNewWorkbookName(file.name.replace(/\.xlsx$/i, "").replace(/[-_]/g, " ").trim()); }}
                      style={{
                        display: "flex", alignItems: "center", gap: 8,
                        width: "100%", padding: "10px 12px", textAlign: "left",
                        background: selectedSourceId === "new" ? T.brandLight : "transparent",
                        border: "none", cursor: "pointer", fontFamily: T.font,
                      }}
                      onMouseEnter={(e) => { if (selectedSourceId !== "new") e.currentTarget.style.background = T.bgAlt; }}
                      onMouseLeave={(e) => { if (selectedSourceId !== "new") e.currentTarget.style.background = "transparent"; }}
                    >
                      <span style={{
                        width: 20, height: 20, borderRadius: "50%",
                        background: T.brand, color: "#fff",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 14, fontWeight: 700, flexShrink: 0, lineHeight: 1,
                      }}>+</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: selectedSourceId === "new" ? T.brandDeep : T.text }}>
                        Add new workbook
                      </span>
                    </button>
                  </div>
                )}
              </div>

              {/* New workbook name input (only when "new" is selected) */}
              {selectedSourceId === "new" && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <input
                    type="text"
                    value={newWorkbookName}
                    onChange={(e) => setNewWorkbookName(e.target.value)}
                    placeholder="e.g. Sales Data, Claims Report, Employee List"
                    disabled={importing}
                    autoFocus
                    style={{
                      width: "100%", padding: "8px 12px", borderRadius: T.radiusSm,
                      border: `1px solid ${T.borderMd}`, background: T.bg,
                      fontSize: 13, fontFamily: T.font, color: T.text,
                      outline: "none", boxSizing: "border-box",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = T.borderMd; e.currentTarget.style.boxShadow = "none"; }}
                  />
                  {newWorkbookName.trim() && (
                    <p style={{ margin: 0, fontSize: 11, color: T.textSoft }}>
                      Will be saved as <strong style={{ color: T.text, fontFamily: "monospace" }}>{nameToSourceId(newWorkbookName)}</strong>
                    </p>
                  )}
                </div>
              )}

              {/* Saved profile notice */}
              {profile && (
                <div style={{ padding: "10px 12px", borderRadius: T.radiusSm, background: T.brandLight, border: `1px solid ${T.brandBorder}`, fontSize: 12, color: T.brandDeep, lineHeight: 1.5 }}>
                  <strong>✓ Import profile found.</strong> Data sheets and settings from your last import are saved. Your reports and dashboards will not be recreated — only the data will update. Turn on "Automatically create reports" below to rebuild them.
                </div>
              )}
              {/* Info when updating an existing workbook (no profile) */}
              {isUpdating && !profile && (
                <div style={{ padding: "10px 12px", borderRadius: T.radiusSm, background: T.infoBg, border: `1px solid ${T.infoBorder}`, fontSize: 12, color: T.infoText, lineHeight: 1.5 }}>
                  <strong>Replacing existing data.</strong> All rows in <strong>{selectedSource!.sourceName}</strong> will be replaced with the contents of this file. Columns added or removed in the file will be reflected immediately. All reports using this source will update automatically.
                </div>
              )}
            </div>
          )}

          {/* Drop zone */}
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void acceptFile(e.dataTransfer.files[0]); }}
            onClick={() => !importing && fileInputRef.current?.click()}
            role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click(); }}
            style={{
              border: `1.5px dashed ${dragging ? T.brand : file ? T.brand : T.borderMd}`,
              borderRadius: T.radius, padding: "20px 16px", textAlign: "center",
              cursor: importing ? "not-allowed" : "pointer",
              background: dragging ? T.brandLight : file ? T.brandLight : T.bgAlt,
              transition: "border-color 120ms, background 120ms",
            }}
          >
            <input
              ref={fileInputRef} type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              hidden onChange={(e) => { void acceptFile(e.target.files?.[0]); }}
              disabled={importing}
            />
            {file ? (
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.brandDeep, marginBottom: 2 }}>{file.name}</div>
                <div style={{ fontSize: 11, color: T.textSoft }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB · Click to choose a different file
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: T.textSoft }}>
                Drop your <strong style={{ color: T.text }}>.xlsx file</strong> here, or <strong style={{ color: T.brand }}>click to browse</strong>
              </div>
            )}
          </div>

          {/* Peek preview + sheet selector */}
          {peeking ? (
            <div style={{ fontSize: 12, color: T.textSoft }}>Reading file contents…</div>
          ) : peek ? (
            <>
              {/* Sheet type selector — only shown in data-source mode with 2+ sheets */}
              {isData && peek.sheets && peek.sheets.length > 1 && (
                <div style={{ border: `1px solid ${T.brand}`, borderRadius: T.radius, padding: "14px 16px", background: T.brandLight }}>
                  {profileApplied ? (
                    <p style={{ margin: "0 0 10px", fontSize: 12, fontWeight: 600, color: T.brandDeep }}>
                      ✓ Using saved settings from your previous import. Change selections below to override.
                    </p>
                  ) : (
                    <p style={{ margin: "0 0 10px", fontSize: 13, fontWeight: 700, color: T.brandDeep }}>
                      Which tabs contain raw data rows?
                    </p>
                  )}
                  {!profileApplied && (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: T.textSoft, lineHeight: 1.5 }}>
                      Selected tabs become database tables. Unselected tabs (summaries, charts, pivot tables) will be recreated as reports and charts using the data tabs as their source.
                    </p>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {peek.sheets.map((sheet) => {
                      const isChecked = dataSheets.includes(sheet.name);
                      return (
                        <label
                          key={sheet.name}
                          style={{
                            display: "flex", alignItems: "center", gap: 10,
                            padding: "9px 12px", borderRadius: T.radiusSm, cursor: "pointer",
                            border: `1px solid ${isChecked ? T.brand : T.border}`,
                            background: isChecked ? T.bg : T.bgAlt,
                            transition: "border-color 100ms, background 100ms",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => {
                              setDataSheets((prev) =>
                                prev.includes(sheet.name)
                                  ? prev.filter((n) => n !== sheet.name)
                                  : [...prev, sheet.name]
                              );
                            }}
                          />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {sheet.name}
                            </div>
                            <div style={{ fontSize: 11, color: T.textSoft }}>
                              {sheet.rowCount.toLocaleString()} rows · {sheet.columnCount} columns
                            </div>
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99,
                            letterSpacing: "0.04em", textTransform: "uppercase", flexShrink: 0,
                            background: sheet.looksLikeData ? T.brandLight : T.infoBg,
                            color: sheet.looksLikeData ? T.brandDeep : T.infoText,
                            border: `1px solid ${sheet.looksLikeData ? T.brandBorder : T.infoBorder}`,
                          }}>
                            {sheet.looksLikeData ? "Data" : "Summary / Chart"}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  {dataSheets.length === 0 && (
                    <p style={{ margin: "10px 0 0", fontSize: 12, color: T.errorText, fontWeight: 600 }}>
                      Select at least one data tab to continue.
                    </p>
                  )}
                </div>
              )}

              {/* File summary (columns / row count) */}
              <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: "10px 14px", background: T.bgAlt }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                  {peek.sheetNames.map((n) => (
                    <span key={n} style={{
                      background: isData && multiSheet && dataSheets.includes(n) ? T.brandLight : T.bg,
                      border: `1px solid ${isData && multiSheet && dataSheets.includes(n) ? T.brandBorder : T.border}`,
                      borderRadius: 5, padding: "1px 8px", fontSize: 11, fontWeight: 600,
                      color: isData && multiSheet && dataSheets.includes(n) ? T.brandDeep : T.textSoft,
                    }}>{n}</span>
                  ))}
                  <span style={{ background: T.brandLight, border: `1px solid ${T.brandBorder}`, borderRadius: 5, padding: "1px 8px", fontSize: 11, fontWeight: 700, color: T.brandDeep }}>
                    {peek.rowCount.toLocaleString()} rows
                  </span>
                </div>
                <div style={{ fontSize: 11, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  Columns: {peek.headers.slice(0, 8).join(", ")}{peek.headers.length > 8 ? ` +${peek.headers.length - 8} more` : ""}
                </div>
              </div>
            </>
          ) : null}

          {/* Error */}
          {error ? (
            <div style={{ padding: "10px 14px", borderRadius: T.radius, border: `1px solid ${T.errorBorder}`, background: T.errorBg, color: T.errorText, fontSize: 13 }}>
              {error}
            </div>
          ) : null}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 2 }}>
            <button
              type="button" onClick={handleClose} disabled={importing}
              style={{
                padding: "0 16px", minHeight: 36, borderRadius: T.radiusSm,
                border: `1px solid ${T.border}`, background: T.bg, color: T.textSecondary,
                fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: T.font,
              }}
            >Cancel</button>
            <button
              type="button"
              onClick={() => { void handleSubmit(); }}
              disabled={!canSubmit}
              style={{
                padding: "0 16px", minHeight: 36, borderRadius: T.radiusSm,
                border: "none", background: !canSubmit ? T.borderMd : T.brand,
                color: "#fff", fontSize: 13, fontWeight: 700,
                cursor: !canSubmit ? "not-allowed" : "pointer",
                fontFamily: T.font, transition: "background 100ms",
                opacity: !canSubmit ? 0.65 : 1,
              }}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
