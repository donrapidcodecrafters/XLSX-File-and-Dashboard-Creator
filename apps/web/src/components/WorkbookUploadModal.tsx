import { useEffect, useRef, useState } from "react";
import { fetchSourceFields, fetchStudioSources, getWorkbookProfile, importStudioWorkbook, importStudioWorkbookSource, peekXlsxFile, saveWorkbookProfile } from "../lib/studioApi";
import type { StudioSourceSummary, StudioWorkbookImportResult, StudioWorkbookSourceImportResult, WorkbookProfile, XlsxSheetPeek } from "../lib/studioApi";

interface ExistingSourceFields {
  fields: Array<{ id: string; label: string; type: string }>;
  keyFieldIds: string[];
  headerSkipRows: number;
}

function diffHeaders(fileHeaders: string[], existing: ExistingSourceFields | undefined) {
  if (!existing || !existing.fields.length) return null;
  // Guard against a stray null/undefined header label (e.g. a genuinely empty header
  // cell surviving as a JSON `null`) crashing the whole app instead of just being
  // treated as an unlabeled column.
  const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase();
  const existingLabels = existing.fields.map((f) => f.label);
  const existingSet = new Set(existingLabels.map(norm));
  const fileSet = new Set(fileHeaders.map(norm));
  return {
    added: fileHeaders.filter((h) => !existingSet.has(norm(h))),
    removed: existingLabels.filter((l) => !fileSet.has(norm(l)))
  };
}

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

  // Per-sheet source mapping (used when 2+ data sheets are selected)
  // Maps sheet name → sourceId ("" = create new, or an existing sourceId)
  const [sheetSourceMap, setSheetSourceMap] = useState<Record<string, string>>({});
  // Shared base name applied to all NEW datasources in multi-sheet mode (e.g. "Payments")
  const [multiSheetBaseName, setMultiSheetBaseName] = useState("");
  // Per-tab label appended after the base name (e.g. "Sheet1" → "Payments - Sheet1"), editable
  const [sheetTabLabels, setSheetTabLabels] = useState<Record<string, string>>({});

  // Key field(s) that uniquely identify a row — lets a re-import update rows in
  // place instead of a full replace. Single-target mode uses `keyFieldIds`;
  // multi-sheet mode tracks one selection per sheet.
  const [keyFieldIds, setKeyFieldIds] = useState<string[]>([]);
  const [sheetKeyFieldMap, setSheetKeyFieldMap] = useState<Record<string, string[]>>({});
  // When the chosen key field(s) don't actually produce unique values in this file
  // (e.g. a claim number that repeats across payers) — skip key-matching for this
  // import and just replace all data, instead of hard-blocking on the duplicate.
  const [allowDuplicates, setAllowDuplicates] = useState(false);
  const [sheetAllowDuplicates, setSheetAllowDuplicates] = useState<Record<string, boolean>>({});
  // Which row actually has the column headers (1-based) — some exported reports have
  // title/filter-summary rows above the real header row. Single-target mode uses
  // `headerRow`; multi-sheet mode tracks one per sheet. Saved per source and pre-filled
  // (from the saved value when updating, or auto-detected when brand new) on next import.
  const [headerRow, setHeaderRow] = useState(1);
  const [sheetHeaderRowMap, setSheetHeaderRowMap] = useState<Record<string, number>>({});
  const [diffAcknowledged, setDiffAcknowledged] = useState(false);
  // Cache of an existing source's current columns + saved key field(s), fetched
  // on demand so the modal can diff the new file's headers and pre-fill keys.
  const [existingFieldsCache, setExistingFieldsCache] = useState<Record<string, ExistingSourceFields>>({});

  // Re-peeks the file with the given sheet's header row pinned, so the shown
  // columns/preview reflect what the user just typed instead of only the
  // auto-detected row. Prunes any selected key field(s) that no longer exist
  // among the new headers, since they'd otherwise silently point at a stale
  // column name.
  async function refreshHeaderRowPreview(sheetName: string, newHeaderRow: number, sourceId?: string) {
    if (!file) return;
    try {
      const fresh = await peekXlsxFile(file, { sourceId, headerRowOverrides: { [sheetName]: newHeaderRow } });
      const freshSheet = fresh.sheets?.find((s) => s.name === sheetName);
      setPeek((prev) => prev ? { ...prev, headers: fresh.headers, rows: fresh.rows, rowCount: fresh.rowCount, sheets: fresh.sheets } : fresh);
      if (freshSheet) {
        const validLabels = new Set(freshSheet.headers);
        setKeyFieldIds((prev) => prev.filter((id) => validLabels.has(id)));
        setSheetKeyFieldMap((prev) => prev[sheetName] ? { ...prev, [sheetName]: prev[sheetName].filter((id) => validLabels.has(id)) } : prev);
      }
    } catch { /* non-blocking — keep showing the previous preview */ }
  }

  // Per-tab version: sends every currently-known header row (not just the one that
  // just changed) so switching tab B's row doesn't revert tab A's back to auto-detect.
  async function refreshSheetHeaderRowPreview(sheetName: string, newHeaderRow: number) {
    if (!file) return;
    const overrides = { ...sheetHeaderRowMap, [sheetName]: newHeaderRow };
    try {
      const fresh = await peekXlsxFile(file, { headerRowOverrides: overrides });
      setPeek((prev) => prev ? { ...prev, sheets: fresh.sheets } : prev);
      const freshSheet = fresh.sheets?.find((s) => s.name === sheetName);
      if (freshSheet) {
        const validLabels = new Set(freshSheet.headers);
        setSheetKeyFieldMap((prev) => prev[sheetName] ? { ...prev, [sheetName]: prev[sheetName].filter((id) => validLabels.has(id)) } : prev);
      }
    } catch { /* non-blocking — keep showing the previous preview */ }
  }

  function ensureExistingFields(sourceId: string) {
    if (!sourceId || existingFieldsCache[sourceId]) return;
    fetchSourceFields(sourceId)
      .then((res) => setExistingFieldsCache((prev) => ({ ...prev, [sourceId]: { fields: res.fields, keyFieldIds: res.keyFieldIds, headerSkipRows: res.headerSkipRows || 0 } })))
      .catch(() => { /* non-blocking */ });
  }

  // Fetch existing columns/keys for every distinct multi-sheet target, and pre-fill
  // that sheet's key-field picker and header-row field from the target's saved choice
  // once it arrives.
  useEffect(() => {
    setSheetKeyFieldMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [sheetName, sid] of Object.entries(sheetSourceMap)) {
        if (!sid) continue;
        ensureExistingFields(sid);
        const existing = existingFieldsCache[sid];
        if (existing && !(sheetName in prev)) {
          next[sheetName] = existing.keyFieldIds;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setSheetHeaderRowMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const [sheetName, sid] of Object.entries(sheetSourceMap)) {
        if (!sid) continue;
        const existing = existingFieldsCache[sid];
        if (existing && !(sheetName in prev)) {
          next[sheetName] = existing.headerSkipRows + 1;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [sheetSourceMap, existingFieldsCache]); // eslint-disable-line react-hooks/exhaustive-deps

  // New sheets with no target assigned yet (will become a brand-new source): default
  // each sheet's header-row field to what the auto-detect heuristic found for it.
  useEffect(() => {
    if (!peek?.sheets?.length) return;
    setSheetHeaderRowMap((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const sheet of peek.sheets) {
        if (sheetSourceMap[sheet.name]) continue; // has a target — handled above
        if (sheet.name in prev) continue;
        if (sheet.detectedHeaderRow) {
          next[sheet.name] = sheet.detectedHeaderRow;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [peek, sheetSourceMap]); // eslint-disable-line react-hooks/exhaustive-deps

  // Switching targets: fetch its columns/keys, reset the acknowledgment banner, and
  // pre-fill the key-field picker from whatever this target last had saved (falls
  // back to empty for "new" or before the fetch lands).
  useEffect(() => {
    setDiffAcknowledged(false);
    setAllowDuplicates(false);
    if (!selectedSourceId || selectedSourceId === "new") { setKeyFieldIds([]); setHeaderRow(1); return; }
    ensureExistingFields(selectedSourceId);
    const existing = existingFieldsCache[selectedSourceId];
    setKeyFieldIds(existing?.keyFieldIds || []);
    if (existing) setHeaderRow(existing.headerSkipRows + 1);
  }, [selectedSourceId, existingFieldsCache[selectedSourceId]]); // eslint-disable-line react-hooks/exhaustive-deps

  // New file peeked for a brand-new source (no saved header row to prefer): default
  // the "header row" field to whatever the auto-detect heuristic found, so files with
  // title/filter-summary rows above their real headers (e.g. "Filters: ALL Agencies...",
  // "Generated on...") don't get misread — still fully editable before importing.
  useEffect(() => {
    if (!peek || selectedSourceId === "" || selectedSourceId === undefined) return;
    if (selectedSourceId !== "new") return;
    const suggested = peek.sheets?.find((s) => s.looksLikeData)?.detectedHeaderRow || peek.sheets?.[0]?.detectedHeaderRow;
    if (suggested) setHeaderRow(suggested);
  }, [peek]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setSheetSourceMap({}); setMultiSheetBaseName(""); setSheetTabLabels({});
    setKeyFieldIds([]); setSheetKeyFieldMap({}); setDiffAcknowledged(false); setExistingFieldsCache({});
    setAllowDuplicates(false); setSheetAllowDuplicates({});
    setHeaderRow(1); setSheetHeaderRowMap({});
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
        const multiSheetMode = isMultiSheetMode;
        if (multiSheetMode) {
          // Build import groups: each unique target source gets its own API call.
          // Multiple sheets can share an existing sourceId (grouped); new sources are always one per tab.
          const groups: { sheets: string[]; sourceId?: string; sourceName?: string; keyFieldIds?: string[]; allowDuplicates?: boolean; headerSkipRows?: number }[] = [];
          const groupIndex = new Map<string, number>(); // existing sourceId → groups index
          const base = multiSheetBaseName.trim();
          for (const sheetName of dataSheets) {
            const sid = sheetSourceMap[sheetName] || "";
            const headerSkipRows = Math.max(0, (sheetHeaderRowMap[sheetName] ?? 1) - 1);
            if (sid) {
              // Updating an existing source — group by sourceId (name preserved via Postgres lookup)
              if (groupIndex.has(sid)) {
                groups[groupIndex.get(sid)!].sheets.push(sheetName);
              } else {
                groupIndex.set(sid, groups.length);
                groups.push({ sheets: [sheetName], sourceId: sid, sourceName: undefined, keyFieldIds: sheetKeyFieldMap[sheetName], allowDuplicates: sheetAllowDuplicates[sheetName], headerSkipRows });
              }
            } else {
              // Creating a new source — one group per tab, name = "BaseName - TabLabel"
              const tabLabel = (sheetTabLabels[sheetName] || sheetName).trim();
              const sourceName = base ? `${base} - ${tabLabel}` : tabLabel;
              groups.push({ sheets: [sheetName], sourceId: undefined, sourceName, keyFieldIds: sheetKeyFieldMap[sheetName], allowDuplicates: sheetAllowDuplicates[sheetName], headerSkipRows });
            }
          }
          // Import data tabs first (datasource creation) — all tabs can run in parallel
          // with each other since they write to separate Postgres tables.
          // Only start workbook analysis for the review AFTER all datasources are saved,
          // so the two heavy operations don't compete for memory at the same time.
          const sourceResults = await Promise.all(groups.map(({ sourceId, sourceName, sheets, keyFieldIds: groupKeyFieldIds, allowDuplicates: groupAllowDuplicates, headerSkipRows: groupHeaderSkipRows }) =>
            importStudioWorkbookSource(file, { sourceId, sourceName, dataSheets: sheets, keyFieldIds: groupKeyFieldIds, allowDuplicates: groupAllowDuplicates, headerSkipRows: groupHeaderSkipRows })
          ));
          const workbookResult = recreate
            ? await importStudioWorkbook(file, { maxRowsPerSheet: 500 })
            : undefined;
          // Save a profile per imported source group
          for (let i = 0; i < groups.length; i++) {
            const g = groups[i];
            const r = sourceResults[i];
            const profileId = r.sources?.[0]?.sourceId ?? g.sourceId ?? slugify(g.sourceName || g.sheets[0]);
            if (profileId) {
              void saveWorkbookProfile(profileId, {
                workbookName: g.sourceName || r.sources?.[0]?.sourceName || g.sheets[0],
                dataSheets: g.sheets,
                sourceIds: r.sources?.map((s: { sourceId: string }) => s.sourceId) || [],
                objectIds: [],
              }).catch(() => {});
            }
          }
          const allSources = sourceResults.flatMap((r) => r.sources || []);
          const merged = { ...sourceResults[0], sources: allSources } as typeof sourceResults[0] & { reports: unknown[]; dashboard: unknown | null };
          if (recreate && workbookResult) {
            onSuccess({ mode, recreated: true, sourceImport: merged, workbookImport: workbookResult });
          } else {
            onSuccess({ mode, recreated: false, sourceImport: merged });
          }
        } else {
          // Single-target mode (original behavior)
          const isNew = selectedSourceId === "new" || selectedSourceId === "";
          const sourceIdArg = isNew ? undefined : selectedSourceId;
          const sourceNameArg = isNew ? (newWorkbookName.trim() || file.name.replace(/\.xlsx$/i, "").trim()) : undefined;
          const multiSheet = (peek?.sheets?.length ?? 0) > 1;
          const dataSheetsArg = multiSheet && dataSheets.length > 0 ? dataSheets : undefined;
          const opts = { sourceId: sourceIdArg, sourceName: sourceNameArg, dataSheets: dataSheetsArg, keyFieldIds: keyFieldIds.length > 0 ? keyFieldIds : undefined, allowDuplicates, headerSkipRows: Math.max(0, headerRow - 1) };

          if (recreate) {
            const sourceResult = await importStudioWorkbookSource(file, opts);
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
            const profileId = sourceIdArg || profile?.id;
            if (profileId) {
              void saveWorkbookProfile(profileId, {
                dataSheets: dataSheetsArg || dataSheets,
                sourceIds: result.sources?.map((s: { sourceId: string }) => s.sourceId) || profile?.sourceIds || []
              }).catch(() => {});
            }
            onSuccess({ mode, recreated: false, sourceImport: result as typeof result & { reports: unknown[]; dashboard: unknown | null } });
          }
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
  // Multi-sheet mode: file is peeked, 2+ data sheets selected, in data-source mode
  const isMultiSheetMode = isData && Boolean(peek) && dataSheets.length >= 2;
  // Which sheet the single-target "Header row" field actually applies to.
  const targetSheetName = dataSheets.length === 1
    ? dataSheets[0]
    : (peek?.sheets?.find((s) => s.looksLikeData)?.name ?? peek?.sheetNames?.[0]);
  const anyTabCreatingNew = isMultiSheetMode && dataSheets.some((s) => !sheetSourceMap[s]);
  const multiSheetCanSubmit = isMultiSheetMode && (
    !anyTabCreatingNew || multiSheetBaseName.trim().length > 0
  );

  // Header diff: does this file's columns differ from what the target source already has?
  const singleTargetDiff = isData && !isMultiSheetMode && isUpdating
    ? diffHeaders(peek?.headers || [], existingFieldsCache[selectedSourceId])
    : null;
  const multiSheetDiffs = isMultiSheetMode
    ? dataSheets
      .map((sheetName) => {
        const sid = sheetSourceMap[sheetName] || "";
        if (!sid) return null;
        const sheet = peek?.sheets?.find((s) => s.name === sheetName);
        const diff = diffHeaders(sheet?.headers || [], existingFieldsCache[sid]);
        return diff && (diff.added.length || diff.removed.length) ? { sheetName, diff } : null;
      })
      .filter((v): v is { sheetName: string; diff: { added: string[]; removed: string[] } } => Boolean(v))
    : [];
  const hasHeaderDiff = Boolean(
    (singleTargetDiff && (singleTargetDiff.added.length || singleTargetDiff.removed.length)) ||
    multiSheetDiffs.length > 0
  );

  const canSubmit = Boolean(file) && !importing && !peeking && hasDataSheetSelection && (!hasHeaderDiff || diffAcknowledged) && (
    !isData ||
    (isMultiSheetMode ? multiSheetCanSubmit : (
      selectedSourceId === "" ||
      (selectedSourceId === "new" && newWorkbookName.trim().length > 0) ||
      isUpdating
    ))
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
      ? isMultiSheetMode
        ? `Import ${dataSheets.length} data tabs`
        : isUpdating
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

          {/* ── Workbook picker (data-source mode only, hidden in multi-sheet mode) ── */}
          {isData && !isMultiSheetMode && (
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
                    onChange={(e) => {
                      setNewWorkbookName(e.target.value);
                      // Auto-populate base datasource name when user hasn't manually edited it
                      setMultiSheetBaseName((prev) => prev === newWorkbookName || prev === "" ? e.target.value : prev);
                    }}
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
                  {keyFieldIds.length > 0 ? (
                    <><strong>Updating by key field.</strong> Rows in <strong>{selectedSource!.sourceName}</strong> matching {keyFieldIds.join(" + ")} will update in place and new rows will be added. Rows already in the table that aren't in this file are left as-is. All reports using this source will update automatically.</>
                  ) : (
                    <><strong>Replacing existing data.</strong> All rows in <strong>{selectedSource!.sourceName}</strong> will be replaced with the contents of this file. Columns added or removed in the file will be reflected immediately. All reports using this source will update automatically. Pick a key field below to update rows in place instead.</>
                  )}
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
                      {isMultiSheetMode ? "Map each data tab to its target datasource:" : "Which tabs contain raw data rows?"}
                    </p>
                  )}
                  {!profileApplied && !isMultiSheetMode && (
                    <p style={{ margin: "0 0 12px", fontSize: 12, color: T.textSoft, lineHeight: 1.5 }}>
                      Selected tabs become database tables. Unselected tabs (summaries, charts, pivot tables) will be recreated as reports and charts using the data tabs as their source.
                    </p>
                  )}
                  {/* Base name input — shown when creating new datasources in multi-sheet mode */}
                  {isMultiSheetMode && anyTabCreatingNew && (
                    <div style={{ marginBottom: 12 }}>
                      <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: T.brandDeep, marginBottom: 4 }}>
                        Base datasource name (applied to all new tabs)
                      </label>
                      <input
                        type="text"
                        value={multiSheetBaseName}
                        placeholder="e.g. Payments"
                        disabled={importing}
                        onChange={(e) => setMultiSheetBaseName(e.target.value)}
                        style={{
                          width: "100%", padding: "7px 10px", borderRadius: T.radiusSm,
                          border: `1px solid ${multiSheetBaseName.trim() ? T.brand : T.borderMd}`,
                          background: T.bg, fontSize: 13, fontFamily: T.font, color: T.text,
                          outline: "none", boxSizing: "border-box",
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = multiSheetBaseName.trim() ? T.brand : T.borderMd; }}
                      />
                      {!multiSheetBaseName.trim() && (
                        <p style={{ margin: "3px 0 0", fontSize: 11, color: T.errorText }}>
                          Enter a base name to continue.
                        </p>
                      )}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {peek.sheets.map((sheet) => {
                      const isChecked = dataSheets.includes(sheet.name);
                      const sheetSid = sheetSourceMap[sheet.name] || "";
                      const sheetSource = xlsxSources.find((s) => s.sourceId === sheetSid);
                      return (
                        <div key={sheet.name} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <label
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
                          {/* Per-sheet source picker — shown when this sheet is a data sheet and multi-sheet mode is active */}
                          {isChecked && isMultiSheetMode && (
                            <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 22 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ fontSize: 11, color: T.textSoft, flexShrink: 0 }}>→ Target:</span>
                                <select
                                  value={sheetSid}
                                  disabled={importing}
                                  onChange={(e) => setSheetSourceMap((prev) => ({ ...prev, [sheet.name]: e.target.value }))}
                                  style={{
                                    flex: 1, padding: "5px 8px", borderRadius: T.radiusSm,
                                    border: `1px solid ${sheetSid ? T.brand : T.borderMd}`,
                                    background: T.bg, color: T.text,
                                    fontSize: 12, fontFamily: T.font,
                                    outline: "none", cursor: "pointer",
                                  }}
                                >
                                  <option value="">Create new datasource</option>
                                  {xlsxSources.length > 0 && <option disabled>── Update existing ──</option>}
                                  {xlsxSources.map((source) => (
                                    <option key={source.sourceId} value={source.sourceId}>
                                      {source.sourceName} ({source.rowCount.toLocaleString()} rows)
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {/* Creating new — show editable tab label */}
                              {!sheetSid && (
                                <div style={{ paddingLeft: 52, display: "flex", alignItems: "center", gap: 6 }}>
                                  <span style={{ fontSize: 11, color: T.textSoft, flexShrink: 0 }}>
                                    {multiSheetBaseName.trim() ? `"${multiSheetBaseName.trim()} -` : "Name:"}
                                  </span>
                                  <input
                                    type="text"
                                    value={sheetTabLabels[sheet.name] ?? sheet.name}
                                    disabled={importing}
                                    onChange={(e) => setSheetTabLabels((prev) => ({ ...prev, [sheet.name]: e.target.value }))}
                                    style={{
                                      flex: 1, padding: "4px 7px", borderRadius: T.radiusSm,
                                      border: `1px solid ${T.borderMd}`, background: T.bg,
                                      fontSize: 12, fontFamily: T.font, color: T.text,
                                      outline: "none",
                                    }}
                                    onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; }}
                                    onBlur={(e) => { e.currentTarget.style.borderColor = T.borderMd; }}
                                  />
                                  {multiSheetBaseName.trim() && <span style={{ fontSize: 11, color: T.textSoft }}>"</span>}
                                </div>
                              )}
                              {/* Updating existing — show confirmation */}
                              {sheetSid && sheetSource && (
                                <p style={{ margin: 0, paddingLeft: 52, fontSize: 11, color: T.brandDeep }}>
                                  Will update <strong>{sheetSource.sourceName}</strong> (name preserved)
                                </p>
                              )}
                              {/* Header row for this tab — some files have title/filter rows above the real headers */}
                              <div style={{ paddingLeft: 52, display: "flex", alignItems: "center", gap: 6 }}>
                                <span style={{ fontSize: 11, color: T.textSoft, flexShrink: 0 }}>Header row:</span>
                                <input
                                  type="number" min={1} max={sheet.rowCount + 20} disabled={importing}
                                  value={sheetHeaderRowMap[sheet.name] ?? 1}
                                  onChange={(e) => setSheetHeaderRowMap((prev) => ({ ...prev, [sheet.name]: Math.max(1, Number(e.target.value) || 1) }))}
                                  onBlur={() => { void refreshSheetHeaderRowPreview(sheet.name, sheetHeaderRowMap[sheet.name] ?? 1); }}
                                  style={{
                                    width: 60, padding: "3px 6px", borderRadius: T.radiusSm,
                                    border: `1px solid ${T.borderMd}`, background: T.bg, color: T.text,
                                    fontSize: 12, fontFamily: T.font, outline: "none",
                                  }}
                                />
                                <span style={{ fontSize: 10.5, color: T.textSoft }}>rows above it are skipped</span>
                              </div>
                              {/* Key field(s) for this tab — optional, matches rows across re-imports */}
                              <div style={{ paddingLeft: 52, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 5 }}>
                                <span style={{ fontSize: 11, color: T.textSoft, flexShrink: 0 }}>Key field(s):</span>
                                {sheet.headers.map((h) => {
                                  const checked = (sheetKeyFieldMap[sheet.name] || []).includes(h);
                                  return (
                                    <button
                                      key={h} type="button" disabled={importing}
                                      onClick={() => setSheetKeyFieldMap((prev) => {
                                        const current = prev[sheet.name] || [];
                                        return { ...prev, [sheet.name]: current.includes(h) ? current.filter((v) => v !== h) : [...current, h] };
                                      })}
                                      style={{
                                        padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600,
                                        border: `1px solid ${checked ? T.brand : T.borderMd}`,
                                        background: checked ? T.brandLight : T.bg,
                                        color: checked ? T.brandDeep : T.textSecondary,
                                        cursor: importing ? "not-allowed" : "pointer", fontFamily: T.font,
                                      }}
                                    >{checked ? "✓ " : ""}{h}</button>
                                  );
                                })}
                              </div>
                              {(sheetKeyFieldMap[sheet.name] || []).length > 0 && (
                                <label style={{ paddingLeft: 52, display: "flex", alignItems: "flex-start", gap: 6, cursor: "pointer" }}>
                                  <input
                                    type="checkbox" checked={Boolean(sheetAllowDuplicates[sheet.name])} disabled={importing}
                                    onChange={(e) => setSheetAllowDuplicates((prev) => ({ ...prev, [sheet.name]: e.target.checked }))}
                                    style={{ marginTop: 2 }}
                                  />
                                  <span style={{ fontSize: 11, color: T.textSecondary, lineHeight: 1.5 }}>
                                    <strong>Allow duplicates</strong> — these field(s) aren't actually unique per row here; replace all data instead of matching by key.
                                  </span>
                                </label>
                              )}
                            </div>
                          )}
                        </div>
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

              {/* Header row — single-target mode. Some exported reports have title/filter-
                  summary rows above the real headers; auto-detected but editable. */}
              {isData && !isMultiSheetMode && (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary }}>Header row</label>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number" min={1} max={(peek.rowCount || 0) + 20} disabled={importing}
                      value={headerRow}
                      onChange={(e) => setHeaderRow(Math.max(1, Number(e.target.value) || 1))}
                      onBlur={() => {
                        if (!targetSheetName) return;
                        void refreshHeaderRowPreview(targetSheetName, headerRow, selectedSourceId && selectedSourceId !== "new" ? selectedSourceId : undefined);
                      }}
                      style={{
                        width: 70, padding: "6px 8px", borderRadius: T.radiusSm,
                        border: `1px solid ${T.borderMd}`, background: T.bg, color: T.text,
                        fontSize: 13, fontFamily: T.font, outline: "none",
                      }}
                    />
                    <span style={{ fontSize: 11, color: T.textSoft, lineHeight: 1.4 }}>
                      Row that has your column names — rows above it are skipped. Auto-detected, but change it if
                      the columns below look wrong. Remembered for next time.
                    </span>
                  </div>
                </div>
              )}

              {/* Key field picker — single-target mode. Lets a re-import match rows
                  by identity (update in place) instead of replacing the whole table. */}
              {isData && !isMultiSheetMode && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary }}>
                    Key field(s) <span style={{ fontWeight: 400, color: T.textSoft }}>— optional, recommended for re-imports</span>
                  </label>
                  <p style={{ margin: 0, fontSize: 11, color: T.textSoft, lineHeight: 1.5 }}>
                    Pick the column(s) that uniquely identify each row (e.g. an ID or SKU). Future imports of this
                    same workbook will use it to update existing rows in place and add new ones — instead of
                    replacing everything. Rows already in the table that aren't in a later file are left as-is,
                    never deleted. Remembered for next time.
                  </p>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {peek.headers.map((h) => {
                      const checked = keyFieldIds.includes(h);
                      return (
                        <button
                          key={h} type="button" disabled={importing}
                          onClick={() => setKeyFieldIds((prev) => prev.includes(h) ? prev.filter((v) => v !== h) : [...prev, h])}
                          style={{
                            padding: "5px 10px", borderRadius: 99, fontSize: 12, fontWeight: 600,
                            border: `1px solid ${checked ? T.brand : T.borderMd}`,
                            background: checked ? T.brandLight : T.bg,
                            color: checked ? T.brandDeep : T.textSecondary,
                            cursor: importing ? "not-allowed" : "pointer", fontFamily: T.font,
                          }}
                        >{checked ? "✓ " : ""}{h}</button>
                      );
                    })}
                  </div>
                  {keyFieldIds.length > 0 && (
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 2, cursor: "pointer" }}>
                      <input
                        type="checkbox" checked={allowDuplicates} disabled={importing}
                        onChange={(e) => setAllowDuplicates(e.target.checked)}
                        style={{ marginTop: 2 }}
                      />
                      <span style={{ fontSize: 12, color: T.textSecondary, lineHeight: 1.5 }}>
                        <strong>Allow duplicates</strong> — the field(s) above don't actually give a unique value for every
                        row in this file (e.g. a claim number that repeats). Instead of matching rows by key, this import
                        will just replace all data in the table. Your key field choice is still remembered for next time.
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Header diff warning — this file's columns differ from what's already
                  stored for the target(s). Requires explicit acknowledgment since an
                  update replaces/re-maps data by these columns. */}
              {hasHeaderDiff && (
                <div style={{ padding: "10px 14px", borderRadius: T.radius, border: `1px solid ${T.errorBorder}`, background: T.errorBg }}>
                  <p style={{ margin: "0 0 8px", fontSize: 12, fontWeight: 700, color: T.errorText }}>
                    ⚠ This file's columns don't exactly match what's already stored — double-check before continuing.
                  </p>
                  {singleTargetDiff && (
                    <div style={{ fontSize: 12, color: T.errorText, lineHeight: 1.6 }}>
                      {singleTargetDiff.added.length > 0 && (
                        <div><strong>New columns:</strong> {singleTargetDiff.added.join(", ")}</div>
                      )}
                      {singleTargetDiff.removed.length > 0 && (
                        <div><strong>Missing columns (were there before, not in this file):</strong> {singleTargetDiff.removed.join(", ")}</div>
                      )}
                    </div>
                  )}
                  {multiSheetDiffs.map(({ sheetName, diff }) => (
                    <div key={sheetName} style={{ fontSize: 12, color: T.errorText, lineHeight: 1.6, marginTop: 4 }}>
                      <strong>{sheetName}:</strong>{" "}
                      {diff.added.length > 0 ? `new — ${diff.added.join(", ")}` : ""}
                      {diff.added.length > 0 && diff.removed.length > 0 ? "; " : ""}
                      {diff.removed.length > 0 ? `missing — ${diff.removed.join(", ")}` : ""}
                    </div>
                  ))}
                  <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 10, cursor: "pointer" }}>
                    <input
                      type="checkbox" checked={diffAcknowledged}
                      onChange={(e) => setDiffAcknowledged(e.target.checked)}
                      style={{ marginTop: 2 }}
                    />
                    <span style={{ fontSize: 12, color: T.errorText, fontWeight: 600 }}>
                      I understand this may affect reports and charts that use these columns — continue anyway.
                    </span>
                  </label>
                </div>
              )}
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
