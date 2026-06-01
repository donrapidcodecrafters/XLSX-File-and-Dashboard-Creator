import { useRef, useState } from "react";
import { importStudioWorkbook, importStudioWorkbookSource, peekXlsxFile, recreateWorkbookFromDataSource } from "../lib/studioApi";
import type { StudioWorkbookImportResult, StudioWorkbookSourceImportResult } from "../lib/studioApi";

type UploadMode = "data-source" | "template";

export interface WorkbookUploadResult {
  mode: UploadMode;
  recreated: boolean;
  workbookImport?: StudioWorkbookImportResult;
  sourceImport?: StudioWorkbookSourceImportResult & { reports: unknown[]; dashboard: unknown | null };
}

interface FilePeek {
  sheetNames: string[];
  headers: string[];
  rows: Record<string, unknown>[];
  rowCount: number;
}

interface WorkbookUploadModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess: (result: WorkbookUploadResult) => void;
}

// ─── Design tokens (inline to avoid CSS inheritance conflicts) ─────────────
const T = {
  bg:        "var(--surface, #fff)",
  bgAlt:     "var(--surface-alt, #F9FAFB)",
  border:    "var(--border, #E5E7EB)",
  borderMd:  "var(--border-md, #D1D5DB)",
  brand:     "var(--brand, #0d7c66)",
  brandDeep: "var(--brand-deep, #065F46)",
  brandLight:"var(--brand-light, #ECFDF5)",
  brandBorder:"var(--brand-border, #A7F3D0)",
  text:      "var(--text, #111827)",
  textSoft:  "var(--text-soft, #6B7280)",
  textSecondary:"var(--text-secondary, #374151)",
  radius:    "10px",
  radiusSm:  "6px",
  shadow:    "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
  shadowXl:  "0 20px 25px rgba(0,0,0,0.12), 0 8px 10px rgba(0,0,0,0.06)",
  font:      "'Inter', 'Segoe UI', system-ui, sans-serif",
};

export function WorkbookUploadModal({ open, onClose, onSuccess }: WorkbookUploadModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<UploadMode>("data-source");
  const [recreate, setRecreate] = useState(true);
  const [sourceName, setSourceName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [peek, setPeek] = useState<FilePeek | null>(null);
  const [peeking, setPeeking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");

  function reset() {
    setFile(null); setPeek(null); setSourceName(""); setError("");
    setImporting(false); setDragging(false);
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
    if (!sourceName) setSourceName(f.name.replace(/\.xlsx$/i, "").replace(/[-_]/g, " ").trim());
    setPeeking(true);
    try { const r = await peekXlsxFile(f); setPeek(r); } catch {}
    finally { setPeeking(false); }
  }

  async function handleSubmit() {
    if (!file || importing) return;
    setImporting(true); setError("");
    try {
      const nameForId = sourceName.trim() || file.name.replace(/\.xlsx$/i, "").trim();
      if (mode === "data-source") {
        if (recreate) {
          const result = await recreateWorkbookFromDataSource(file, { sourceName: nameForId });
          onSuccess({ mode, recreated: true, sourceImport: result });
        } else {
          const result = await importStudioWorkbookSource(file, { sourceName: nameForId });
          onSuccess({ mode, recreated: false, sourceImport: result as typeof result & { reports: unknown[]; dashboard: unknown | null } });
        }
      } else {
        const result = await importStudioWorkbook(file);
        onSuccess({ mode, recreated: recreate, workbookImport: result });
      }
      reset(); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Something went wrong. Please try again."); }
    finally { setImporting(false); }
  }

  if (!open) return null;

  const isData = mode === "data-source";

  const submitLabel = importing
    ? (recreate ? "Importing…" : "Importing…")
    : isData
      ? recreate ? "Import file and create reports & dashboard" : "Import as data source"
      : "Import report layouts";

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: "24px",
      }}
    >
      <div style={{
        width: "100%", maxWidth: 520,
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
                    key={opt.id}
                    type="button"
                    onClick={() => setMode(opt.id as UploadMode)}
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
            {/* Custom pill toggle */}
            <div style={{
              flexShrink: 0, marginTop: 2,
              width: 34, height: 18, borderRadius: 9,
              background: recreate ? T.brand : "#D1D5DB",
              position: "relative", transition: "background 150ms",
              cursor: importing ? "not-allowed" : "pointer",
            }}>
              <div style={{
                position: "absolute", width: 14, height: 14, borderRadius: "50%",
                background: "#fff", top: 2,
                left: recreate ? 18 : 2,
                transition: "left 150ms",
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

          {/* Source name */}
          {isData ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.textSecondary, letterSpacing: "0.01em" }}>
                Name this data source
              </label>
              <input
                type="text"
                value={sourceName}
                onChange={(e) => setSourceName(e.target.value)}
                placeholder="e.g. Sales Q1 2025"
                disabled={importing}
                style={{
                  width: "100%", padding: "8px 12px", borderRadius: T.radiusSm,
                  border: `1px solid ${T.borderMd}`, background: T.bg,
                  fontSize: 13, fontFamily: T.font, color: T.text,
                  outline: "none", boxSizing: "border-box",
                }}
                onFocus={(e) => { e.currentTarget.style.borderColor = T.brand; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
                onBlur={(e) => { e.currentTarget.style.borderColor = T.borderMd; e.currentTarget.style.boxShadow = "none"; }}
              />
              <p style={{ margin: 0, fontSize: 11, color: T.textSoft, lineHeight: 1.5, fontWeight: 400 }}>
                Use the same name each time you upload an updated version — the platform will automatically replace the old data and update all reports instantly.
              </p>
            </div>
          ) : null}

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

          {/* Peek preview */}
          {peeking ? (
            <div style={{ fontSize: 12, color: T.textSoft }}>Reading file contents…</div>
          ) : peek ? (
            <div style={{ border: `1px solid ${T.border}`, borderRadius: T.radius, padding: "12px 14px", background: T.bgAlt }}>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
                {peek.sheetNames.map((n) => (
                  <span key={n} style={{ background: T.bg, border: `1px solid ${T.border}`, borderRadius: 5, padding: "1px 8px", fontSize: 11, fontWeight: 600, color: T.textSoft }}>{n}</span>
                ))}
                <span style={{ background: T.brandLight, border: `1px solid ${T.brandBorder}`, borderRadius: 5, padding: "1px 8px", fontSize: 11, fontWeight: 700, color: T.brandDeep }}>
                  {peek.rowCount.toLocaleString()} rows
                </span>
              </div>
              <div style={{ fontSize: 11, color: T.textSoft, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Columns: {peek.headers.slice(0, 8).join(", ")}{peek.headers.length > 8 ? ` +${peek.headers.length - 8} more` : ""}
              </div>
            </div>
          ) : null}

          {/* Error */}
          {error ? (
            <div style={{ padding: "10px 14px", borderRadius: T.radius, border: "1px solid #FECACA", background: "#FEF2F2", color: "#991B1B", fontSize: 13 }}>
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
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleSubmit(); }}
              disabled={!file || importing}
              style={{
                padding: "0 16px", minHeight: 36, borderRadius: T.radiusSm,
                border: "none", background: !file || importing ? T.borderMd : T.brand,
                color: "#fff", fontSize: 13, fontWeight: 700, cursor: !file || importing ? "not-allowed" : "pointer",
                fontFamily: T.font, transition: "background 100ms",
                opacity: !file || importing ? 0.65 : 1,
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
