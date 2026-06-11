import { useEffect, useRef, useState } from "react";
import {
  fetchStudioSources,
  renameSource,
  deleteSource,
  clearSourceData,
  type StudioSourceSummary,
} from "../lib/studioApi";
import { WorkbookUploadModal } from "./WorkbookUploadModal";

// ── Design tokens ──────────────────────────────────────────────────────────────

const FONT = "'Inter', 'Segoe UI', system-ui, sans-serif";
const PRIMARY = "#0d7c66";
const PRIMARY_DARK = "#065F46";
const PRIMARY_BG = "#ECFDF5";
const PRIMARY_BORDER = "#A7F3D0";

// ── Types ──────────────────────────────────────────────────────────────────────

type SortField = "sourceName" | "updatedAt" | "rowCount";
type SortDir = "asc" | "desc";

interface ConfirmDialog {
  kind: "delete" | "clear";
  source: StudioSourceSummary;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function estimateSizeLabel(source: StudioSourceSummary): string {
  // Rough heuristic: avg 200 bytes per cell
  const cells = source.rowCount * source.fieldCount;
  const bytes = cells * 200;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sourceTypeLabel(type: StudioSourceSummary["sourceType"]): string {
  if (type === "xlsx") return "XLSX";
  if (type === "quickbase") return "Quickbase";
  if (type === "manual") return "Manual";
  return type;
}

function sourceTypeBadgeStyle(type: StudioSourceSummary["sourceType"]): React.CSSProperties {
  if (type === "xlsx") {
    return { background: "#EFF6FF", color: "#1D4ED8", border: "1px solid #BFDBFE" };
  }
  if (type === "quickbase") {
    return { background: "#F5F3FF", color: "#6D28D9", border: "1px solid #DDD6FE" };
  }
  return { background: "var(--surface-alt, #F9FAFB)", color: "var(--text-soft, #6B7280)", border: "1px solid var(--border, #E5E7EB)" };
}

function sortSources(
  sources: StudioSourceSummary[],
  field: SortField,
  dir: SortDir
): StudioSourceSummary[] {
  return [...sources].sort((a, b) => {
    let cmp = 0;
    if (field === "sourceName") {
      cmp = a.sourceName.localeCompare(b.sourceName);
    } else if (field === "updatedAt") {
      const aDate = a.updatedAt || a.refreshedAt || "";
      const bDate = b.updatedAt || b.refreshedAt || "";
      cmp = aDate.localeCompare(bDate);
    } else if (field === "rowCount") {
      cmp = a.rowCount - b.rowCount;
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: StudioSourceSummary["sourceType"] }) {
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 8px",
      borderRadius: 99,
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: "0.04em",
      fontFamily: FONT,
      whiteSpace: "nowrap",
      ...sourceTypeBadgeStyle(type),
    }}>
      {sourceTypeLabel(type)}
    </span>
  );
}

function SortButton({
  label,
  field,
  sortField,
  sortDir,
  onSort,
}: {
  label: string;
  field: SortField;
  sortField: SortField;
  sortDir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const active = sortField === field;
  return (
    <button
      type="button"
      onClick={() => onSort(field)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
        fontFamily: FONT,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.06em",
        textTransform: "uppercase",
        color: active ? PRIMARY_DARK : "#9CA3AF",
        userSelect: "none",
      }}
    >
      {label}
      <span style={{ fontSize: 9, opacity: active ? 1 : 0.4 }}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "▼"}
      </span>
    </button>
  );
}

// ── Inline rename cell ─────────────────────────────────────────────────────────

interface RenameCellProps {
  source: StudioSourceSummary;
  canEdit: boolean;
  onRenamed: (sourceId: string, newName: string) => void;
  onError: (msg: string) => void;
}

function RenameCell({ source, canEdit, onRenamed, onError }: RenameCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(source.sourceName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function startEdit() {
    if (!canEdit) return;
    setDraft(source.sourceName);
    setEditing(true);
    window.setTimeout(() => inputRef.current?.select(), 30);
  }

  async function commitRename() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === source.sourceName) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await renameSource(source.sourceId, trimmed);
      onRenamed(source.sourceId, trimmed);
      setEditing(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to rename source.");
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { void commitRename(); }
    if (e.key === "Escape") { setEditing(false); }
  }

  if (editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => { void commitRename(); }}
          disabled={saving}
          autoFocus
          style={{
            padding: "4px 8px",
            borderRadius: 6,
            border: `1px solid ${PRIMARY}`,
            boxShadow: `0 0 0 3px rgba(13,124,102,0.12)`,
            fontSize: 13,
            fontFamily: FONT,
            color: "var(--text, #111827)",
            outline: "none",
            minWidth: 140,
            maxWidth: 260,
          }}
        />
        {saving && (
          <span style={{ fontSize: 11, color: "var(--text-muted, #9CA3AF)" }}>Saving…</span>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontWeight: 600, color: "var(--text, #111827)", fontSize: 13 }}>
        {source.sourceName}
      </span>
      {canEdit && (
        <button
          type="button"
          title="Click to rename"
          onClick={startEdit}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--text-muted, #9CA3AF)",
            fontSize: 13,
            padding: "2px 5px",
            borderRadius: 4,
            lineHeight: 1,
            opacity: 0.45,
            transition: "opacity 120ms, color 120ms",
          }}
          className="rename-btn"
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.color = PRIMARY; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "0.45"; e.currentTarget.style.color = "var(--text-muted, #9CA3AF)"; }}
        >
          ✏
        </button>
      )}
    </div>
  );
}

// ── Confirm dialog ─────────────────────────────────────────────────────────────

function ConfirmDialogModal({
  dialog,
  working,
  onConfirm,
  onCancel,
}: {
  dialog: ConfirmDialog;
  working: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isDelete = dialog.kind === "delete";
  const title = isDelete
    ? `Delete "${dialog.source.sourceName}"?`
    : `Clear data for "${dialog.source.sourceName}"?`;
  const description = isDelete
    ? `This will permanently remove the source and all ${formatNumber(dialog.source.rowCount)} cached records. This action cannot be undone.`
    : `This will delete all ${formatNumber(dialog.source.rowCount)} cached records but keep the source entity. You can re-import data afterwards.`;
  const confirmLabel = isDelete ? "Delete source" : "Clear data";
  const confirmBg = "#DC2626";
  const confirmHover = "#B91C1C";

  return (
    <div style={{
      position: "fixed",
      inset: 0,
      zIndex: 2000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.45)",
    }}>
      <div style={{
        background: "var(--surface, #fff)",
        borderRadius: 14,
        border: "1px solid var(--border, #E5E7EB)",
        boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
        padding: "28px 32px",
        maxWidth: 440,
        width: "calc(100% - 40px)",
        fontFamily: FONT,
      }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text, #111827)", marginBottom: 8 }}>
          {title}
        </div>
        <div style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", marginBottom: 22, lineHeight: 1.6 }}>
          {description}
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={working}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "1px solid var(--border, #E5E7EB)",
              background: "var(--surface-alt, #F9FAFB)",
              color: "var(--text-secondary, #374151)",
              fontSize: 13,
              fontWeight: 600,
              fontFamily: FONT,
              cursor: working ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(e) => { if (!working) e.currentTarget.style.background = "#F3F4F6"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "#F9FAFB"; }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={working}
            style={{
              padding: "8px 18px",
              borderRadius: 8,
              border: "none",
              background: confirmBg,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: FONT,
              cursor: working ? "not-allowed" : "pointer",
              opacity: working ? 0.7 : 1,
            }}
            onMouseEnter={(e) => { if (!working) e.currentTarget.style.background = confirmHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = confirmBg; }}
          >
            {working ? (isDelete ? "Deleting…" : "Clearing…") : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface DataManagementPageProps {
  canDelete?: boolean; // corresponds to data.delete permission
  canImport?: boolean; // corresponds to data.import permission
}

export function DataManagementPage({ canDelete = false, canImport = true }: DataManagementPageProps) {
  const [sources, setSources] = useState<StudioSourceSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<StudioSourceSummary["sourceType"] | "all">("all");
  const [sortField, setSortField] = useState<SortField>("updatedAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<ConfirmDialog | null>(null);
  const [working, setWorking] = useState(false);
  const [banner, setBanner] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    void loadSources();
  }, []);

  async function loadSources() {
    setLoading(true);
    setLoadError("");
    try {
      const result = await fetchStudioSources();
      setSources(result.sources);
      setSelected(new Set());
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load sources.");
    } finally {
      setLoading(false);
    }
  }

  function showBanner(type: "success" | "error", message: string) {
    setBanner({ type, message });
    window.setTimeout(() => setBanner(null), 5000);
  }

  // ── Filtering + sorting ──────────────────────────────────────────────────────

  const filtered = sortSources(
    sources.filter((s) => {
      const matchesSearch =
        !search.trim() ||
        s.sourceName.toLowerCase().includes(search.trim().toLowerCase()) ||
        s.sourceType.toLowerCase().includes(search.trim().toLowerCase());
      const matchesType = typeFilter === "all" || s.sourceType === typeFilter;
      return matchesSearch && matchesType;
    }),
    sortField,
    sortDir
  );

  // ── Sort toggle ──────────────────────────────────────────────────────────────

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir(field === "updatedAt" ? "desc" : "asc");
    }
  }

  // ── Selection ────────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length && filtered.length > 0) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((s) => s.sourceId)));
    }
  }

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const someSelected = selected.size > 0 && !allSelected;

  // ── Rename ───────────────────────────────────────────────────────────────────

  function handleRenamed(sourceId: string, newName: string) {
    setSources((prev) =>
      prev.map((s) => s.sourceId === sourceId ? { ...s, sourceName: newName } : s)
    );
    showBanner("success", `Source renamed to "${newName}".`);
  }

  // ── Delete single ────────────────────────────────────────────────────────────

  async function handleDeleteConfirm() {
    if (!confirm) return;
    setWorking(true);
    try {
      if (confirm.kind === "delete") {
        await deleteSource(confirm.source.sourceId);
        setSources((prev) => prev.filter((s) => s.sourceId !== confirm.source.sourceId));
        setSelected((prev) => { const next = new Set(prev); next.delete(confirm.source.sourceId); return next; });
        showBanner("success", `"${confirm.source.sourceName}" has been deleted.`);
      } else {
        await clearSourceData(confirm.source.sourceId);
        setSources((prev) =>
          prev.map((s) => s.sourceId === confirm.source.sourceId ? { ...s, rowCount: 0 } : s)
        );
        showBanner("success", `Data cleared for "${confirm.source.sourceName}".`);
      }
      setConfirm(null);
    } catch (err) {
      showBanner("error", err instanceof Error ? err.message : "Operation failed.");
    } finally {
      setWorking(false);
    }
  }

  // ── Bulk delete ──────────────────────────────────────────────────────────────

  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ids = Array.from(selected);
    let deleted = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await deleteSource(id);
        deleted++;
      } catch {
        failed++;
      }
    }
    setSources((prev) => prev.filter((s) => !selected.has(s.sourceId)));
    setSelected(new Set());
    setShowBulkConfirm(false);
    setBulkDeleting(false);
    if (failed === 0) {
      showBanner("success", `${deleted} source${deleted !== 1 ? "s" : ""} deleted.`);
    } else {
      showBanner("error", `${deleted} deleted, ${failed} failed. Refresh to see current state.`);
    }
  }

  // ── Unique source types for filter ────────────────────────────────────────────

  const availableTypes = Array.from(new Set(sources.map((s) => s.sourceType)));

  const cellStyle: React.CSSProperties = {
    padding: "11px 14px",
    borderBottom: "1px solid #F3F4F6",
    verticalAlign: "middle",
    fontSize: 13,
    color: "var(--text-secondary, #374151)",
    fontFamily: FONT,
  };

  const thStyle: React.CSSProperties = {
    padding: "9px 14px",
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted, #9CA3AF)",
    textTransform: "uppercase",
    borderBottom: "1px solid var(--border, #E5E7EB)",
    whiteSpace: "nowrap",
    background: "var(--surface-alt, #F9FAFB)",
  };

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="data-mgmt-page" style={{ fontFamily: FONT, minHeight: "100dvh", background: "var(--bg, #F8FAFC)" }}>
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 24px" }}>

        {/* Page header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16 }}>
          <div>
            <h1 style={{ margin: "0 0 4px", fontSize: "1.5rem", fontWeight: 800, color: "var(--text, #111827)", letterSpacing: "-0.025em" }}>
              Data Management
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "var(--text-soft, #6B7280)" }}>
              View, rename, and manage imported sources and their cached records.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            {canImport && (
              <button
                type="button"
                onClick={() => setShowUpload(true)}
                style={{
                  padding: "9px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: PRIMARY,
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: FONT,
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = PRIMARY_DARK; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = PRIMARY; }}
              >
                + Import XLSX
              </button>
            )}
            <button
              type="button"
              onClick={() => { void loadSources(); }}
              disabled={loading}
              style={{
                padding: "9px 18px",
                borderRadius: 8,
                border: "1px solid var(--border, #E5E7EB)",
                background: "var(--surface, #fff)",
                color: "var(--text-secondary, #374151)",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: loading ? "not-allowed" : "pointer",
                opacity: loading ? 0.6 : 1,
              }}
              onMouseEnter={(e) => { if (!loading) e.currentTarget.style.background = "#F9FAFB"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#fff"; }}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
        </div>

        {/* Banner */}
        {banner && (
          <div style={{
            padding: "11px 16px",
            borderRadius: 10,
            marginBottom: 18,
            display: "flex",
            alignItems: "center",
            gap: 10,
            fontSize: 13,
            fontWeight: 500,
            background: banner.type === "success" ? "#ECFDF5" : "#FEF2F2",
            border: `1px solid ${banner.type === "success" ? "#A7F3D0" : "#FECACA"}`,
            color: banner.type === "success" ? "#065F46" : "#991B1B",
          }}>
            <span>{banner.type === "success" ? "✓" : "⚠"}</span>
            {banner.message}
            <button
              type="button"
              onClick={() => setBanner(null)}
              style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: "inherit", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        )}

        {/* Toolbar: search, filter, bulk actions */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
          flexWrap: "wrap",
        }}>
          {/* Search */}
          <div style={{ position: "relative", flex: "1 1 220px", minWidth: 180 }}>
            <span style={{
              position: "absolute",
              left: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "var(--text-muted, #9CA3AF)",
              fontSize: 14,
              pointerEvents: "none",
            }}>
              ⌕
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by name or type…"
              style={{
                width: "100%",
                padding: "8px 11px 8px 30px",
                borderRadius: 8,
                border: "1px solid var(--border-md, #D1D5DB)",
                fontSize: 13,
                fontFamily: FONT,
                outline: "none",
                background: "var(--surface, #fff)",
                color: "var(--text, #111827)",
                boxSizing: "border-box",
              }}
              onFocus={(e) => { e.currentTarget.style.borderColor = PRIMARY; e.currentTarget.style.boxShadow = "0 0 0 3px rgba(13,124,102,0.12)"; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = "#D1D5DB"; e.currentTarget.style.boxShadow = "none"; }}
            />
          </div>

          {/* Type filter */}
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as StudioSourceSummary["sourceType"] | "all")}
            style={{
              padding: "8px 11px",
              borderRadius: 8,
              border: "1px solid var(--border-md, #D1D5DB)",
              fontSize: 13,
              fontFamily: FONT,
              background: "var(--surface, #fff)",
              color: "var(--text-secondary, #374151)",
              cursor: "pointer",
              outline: "none",
              minWidth: 130,
            }}
            onFocus={(e) => { e.currentTarget.style.borderColor = PRIMARY; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = "#D1D5DB"; }}
          >
            <option value="all">All types</option>
            {availableTypes.map((t) => (
              <option key={t} value={t}>{sourceTypeLabel(t)}</option>
            ))}
          </select>

          {/* Bulk delete button */}
          {canDelete && selected.size > 0 && (
            <button
              type="button"
              onClick={() => setShowBulkConfirm(true)}
              style={{
                padding: "8px 16px",
                borderRadius: 8,
                border: "1px solid #FECACA",
                background: "#FEF2F2",
                color: "#B91C1C",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: FONT,
                cursor: "pointer",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
            >
              Delete {selected.size} selected
            </button>
          )}

          {/* Result count */}
          <span style={{ fontSize: 12, color: "var(--text-muted, #9CA3AF)", marginLeft: "auto", whiteSpace: "nowrap" }}>
            {filtered.length} {filtered.length === 1 ? "source" : "sources"}
          </span>
        </div>

        {/* Main card */}
        <div style={{
          background: "var(--surface, #fff)",
          borderRadius: 16,
          border: "1px solid var(--border, #E5E7EB)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 8px rgba(0,0,0,0.03)",
          overflow: "hidden",
        }}>

          {/* Loading state */}
          {loading && (
            <div style={{ padding: "56px 20px", textAlign: "center", color: "var(--text-muted, #9CA3AF)", fontSize: 14 }}>
              Loading sources…
            </div>
          )}

          {/* Error state */}
          {!loading && loadError && (
            <div style={{ padding: "40px 20px", textAlign: "center" }}>
              <div style={{
                display: "inline-block",
                padding: "12px 20px",
                borderRadius: 10,
                background: "#FEF2F2",
                border: "1px solid #FECACA",
                color: "#991B1B",
                fontSize: 13,
              }}>
                {loadError}
                <button
                  type="button"
                  onClick={() => { void loadSources(); }}
                  style={{ marginLeft: 10, background: "none", border: "none", cursor: "pointer", color: "#B91C1C", fontWeight: 700, fontFamily: FONT, fontSize: 13 }}
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Empty state */}
          {!loading && !loadError && sources.length === 0 && (
            <div style={{ padding: "56px 20px", textAlign: "center" }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-secondary, #374151)", marginBottom: 6 }}>
                No data sources yet
              </div>
              <div style={{ fontSize: 13, color: "var(--text-muted, #9CA3AF)" }}>
                Import an XLSX file or connect a Quickbase source to get started.
              </div>
            </div>
          )}

          {/* No results after filtering */}
          {!loading && !loadError && sources.length > 0 && filtered.length === 0 && (
            <div style={{ padding: "40px 20px", textAlign: "center", color: "var(--text-muted, #9CA3AF)", fontSize: 14 }}>
              No sources match your search or filter.
            </div>
          )}

          {/* Table */}
          {!loading && !loadError && filtered.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {/* Checkbox */}
                    {canDelete && (
                      <th style={{ ...thStyle, width: 40, paddingLeft: 18, paddingRight: 8 }}>
                        <input
                          type="checkbox"
                          className="check-native"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected;
                          }}
                          onChange={toggleSelectAll}
                          aria-label="Select all"
                        />
                      </th>
                    )}
                    <th style={{ ...thStyle, paddingLeft: canDelete ? 8 : 20 }}>
                      <SortButton
                        label="Name"
                        field="sourceName"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    </th>
                    <th style={thStyle}>Type</th>
                    <th style={{ ...thStyle, textAlign: "right" }}>
                      <SortButton
                        label="Rows"
                        field="rowCount"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Fields</th>
                    <th style={thStyle}>
                      <SortButton
                        label="Last Updated"
                        field="updatedAt"
                        sortField={sortField}
                        sortDir={sortDir}
                        onSort={handleSort}
                      />
                    </th>
                    <th style={{ ...thStyle, textAlign: "right" }}>Est. Size</th>
                    <th style={{ ...thStyle, paddingRight: 20, textAlign: "right" }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((source) => {
                    const isSelected = selected.has(source.sourceId);
                    return (
                      <tr
                        key={source.sourceId}
                        style={{
                          transition: "background 80ms",
                          background: isSelected ? "var(--brand-light, #F0FDF9)" : undefined,
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.background = "var(--surface-hover, #FAFAFA)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLTableRowElement).style.background = isSelected ? "var(--brand-light, #F0FDF9)" : "";
                        }}
                      >
                        {/* Checkbox */}
                        {canDelete && (
                          <td style={{ ...cellStyle, width: 40, paddingLeft: 18, paddingRight: 8 }}>
                            <input
                              type="checkbox"
                              className="check-native"
                              checked={isSelected}
                              onChange={() => toggleSelect(source.sourceId)}
                              aria-label={`Select ${source.sourceName}`}
                            />
                          </td>
                        )}

                        {/* Name (inline rename) */}
                        <td style={{ ...cellStyle, paddingLeft: canDelete ? 8 : 20, maxWidth: 280 }}>
                          <RenameCell
                            source={source}
                            canEdit={true}
                            onRenamed={handleRenamed}
                            onError={(msg) => showBanner("error", msg)}
                          />
                          {source.table?.name && (
                            <div style={{ fontSize: 11, color: "var(--text-muted, #9CA3AF)", marginTop: 2 }}>
                              Table: {source.table.name}
                            </div>
                          )}
                        </td>

                        {/* Type */}
                        <td style={cellStyle}>
                          <TypeBadge type={source.sourceType} />
                        </td>

                        {/* Row count */}
                        <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {source.rowCount === 0 ? (
                            <span style={{ color: "var(--text-muted, #9CA3AF)" }}>0</span>
                          ) : (
                            formatNumber(source.rowCount)
                          )}
                        </td>

                        {/* Field count */}
                        <td style={{ ...cellStyle, textAlign: "right", fontVariantNumeric: "tabular-nums", color: "var(--text-soft, #6B7280)" }}>
                          {formatNumber(source.fieldCount)}
                        </td>

                        {/* Last updated */}
                        <td style={{ ...cellStyle, color: "var(--text-soft, #6B7280)", fontSize: 12, whiteSpace: "nowrap" }}>
                          {formatDate(source.updatedAt || source.refreshedAt)}
                        </td>

                        {/* Size estimate */}
                        <td style={{ ...cellStyle, textAlign: "right", color: "var(--text-soft, #6B7280)", fontSize: 12, whiteSpace: "nowrap" }}>
                          {source.rowCount > 0 ? estimateSizeLabel(source) : "—"}
                        </td>

                        {/* Actions */}
                        <td style={{ ...cellStyle, paddingRight: 20, textAlign: "right" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                            {canDelete && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setConfirm({ kind: "clear", source })}
                                  disabled={source.rowCount === 0}
                                  title={source.rowCount === 0 ? "No data to clear" : "Clear cached records"}
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    border: "1px solid #FDE68A",
                                    background: "#FFFBEB",
                                    color: "#92400E",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    fontFamily: FONT,
                                    cursor: source.rowCount === 0 ? "not-allowed" : "pointer",
                                    opacity: source.rowCount === 0 ? 0.45 : 1,
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => { if (source.rowCount > 0) e.currentTarget.style.background = "#FEF3C7"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#FFFBEB"; }}
                                >
                                  Clear data
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirm({ kind: "delete", source })}
                                  title="Delete source and all its records"
                                  style={{
                                    padding: "4px 10px",
                                    borderRadius: 6,
                                    border: "1px solid #FECACA",
                                    background: "#FEF2F2",
                                    color: "#B91C1C",
                                    fontSize: 12,
                                    fontWeight: 600,
                                    fontFamily: FONT,
                                    cursor: "pointer",
                                    whiteSpace: "nowrap",
                                  }}
                                  onMouseEnter={(e) => { e.currentTarget.style.background = "#FEE2E2"; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.background = "#FEF2F2"; }}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                            {!canDelete && (
                              <span style={{ fontSize: 11, color: "#D1D5DB" }}>
                                Read-only
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Footer hint */}
        {!loading && !loadError && (
          <p style={{ margin: "16px 0 0", fontSize: 12, color: "var(--text-muted, #9CA3AF)", textAlign: "center" }}>
            {canDelete
              ? "Clear data removes cached records while keeping the source entity. Delete removes the source entirely."
              : "You have read-only access to data sources. Contact an admin to manage or delete sources."}
          </p>
        )}
      </div>

      {/* Single-source confirm dialog */}
      {confirm && (
        <ConfirmDialogModal
          dialog={confirm}
          working={working}
          onConfirm={() => { void handleDeleteConfirm(); }}
          onCancel={() => { if (!working) setConfirm(null); }}
        />
      )}

      {/* Bulk delete confirm dialog */}
      {showBulkConfirm && (
        <div style={{
          position: "fixed",
          inset: 0,
          zIndex: 2000,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.45)",
        }}>
          <div style={{
            background: "var(--surface, #fff)",
            borderRadius: 14,
            border: "1px solid var(--border, #E5E7EB)",
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
            padding: "28px 32px",
            maxWidth: 440,
            width: "calc(100% - 40px)",
            fontFamily: FONT,
          }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: "var(--text, #111827)", marginBottom: 8 }}>
              Delete {selected.size} source{selected.size !== 1 ? "s" : ""}?
            </div>
            <div style={{ fontSize: 13, color: "var(--text-soft, #6B7280)", marginBottom: 22, lineHeight: 1.6 }}>
              This will permanently remove the selected sources and all their cached records.
              This action cannot be undone.
            </div>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setShowBulkConfirm(false)}
                disabled={bulkDeleting}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "1px solid var(--border, #E5E7EB)",
                  background: "var(--surface-alt, #F9FAFB)",
                  color: "var(--text-secondary, #374151)",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: FONT,
                  cursor: bulkDeleting ? "not-allowed" : "pointer",
                }}
                onMouseEnter={(e) => { if (!bulkDeleting) e.currentTarget.style.background = "#F3F4F6"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#F9FAFB"; }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { void handleBulkDelete(); }}
                disabled={bulkDeleting}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  border: "none",
                  background: "#DC2626",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 700,
                  fontFamily: FONT,
                  cursor: bulkDeleting ? "not-allowed" : "pointer",
                  opacity: bulkDeleting ? 0.7 : 1,
                }}
                onMouseEnter={(e) => { if (!bulkDeleting) e.currentTarget.style.background = "#B91C1C"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "#DC2626"; }}
              >
                {bulkDeleting ? "Deleting…" : `Delete ${selected.size} source${selected.size !== 1 ? "s" : ""}`}
              </button>
            </div>
          </div>
        </div>
      )}

      <WorkbookUploadModal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        onSuccess={() => { setShowUpload(false); void loadSources(); }}
      />
    </div>
  );
}
