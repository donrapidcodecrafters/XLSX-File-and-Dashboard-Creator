import { useEffect, useState } from "react";
import type { StudioDocument } from "@studio/shared";
import {
  createReportConfig,
  deleteReportConfig,
  listReportConfigs,
  testReportConfig,
  updateReportConfig,
  type ReportConfig
} from "../lib/studioApi";

// ── Friendly schedule builder ─────────────────────────────────────────────────

type Frequency = "daily" | "weekly" | "monthly" | "hourly";
type Weekday = "0" | "1" | "2" | "3" | "4" | "5" | "6";

interface ScheduleChoice {
  frequency: Frequency;
  hour: string;     // "7", "8", ..., "17"
  ampm: "AM" | "PM";
  weekday: Weekday; // for weekly
  monthDay: string; // "1".."28" for monthly
}

const WEEKDAY_LABELS: Record<Weekday, string> = {
  "0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
  "4": "Thursday", "5": "Friday", "6": "Saturday"
};

const HOUR_OPTIONS = Array.from({ length: 12 }, (_, i) => String(i + 1));
const MONTH_DAY_OPTIONS = Array.from({ length: 28 }, (_, i) => String(i + 1));

function scheduleChoiceToCron(s: ScheduleChoice): string {
  if (s.frequency === "hourly") return "0 * * * *";
  const hour24 = s.ampm === "AM"
    ? String(Number(s.hour) === 12 ? 0 : Number(s.hour))
    : String(Number(s.hour) === 12 ? 12 : Number(s.hour) + 12);
  if (s.frequency === "daily")   return `0 ${hour24} * * *`;
  if (s.frequency === "weekly")  return `0 ${hour24} * * ${s.weekday}`;
  if (s.frequency === "monthly") return `0 ${hour24} ${s.monthDay} * *`;
  return "0 8 * * *";
}

function cronToScheduleChoice(expr: string): ScheduleChoice {
  const defaults: ScheduleChoice = { frequency: "daily", hour: "8", ampm: "AM", weekday: "1", monthDay: "1" };
  if (!expr || expr === "0 * * * *") return { ...defaults, frequency: "hourly" };
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return defaults;
  const [, hourStr, domStr, , dowStr] = parts;
  const hour24 = Number(hourStr);
  const ampm: "AM" | "PM" = hour24 < 12 ? "AM" : "PM";
  const hour12 = hour24 === 0 ? "12" : hour24 > 12 ? String(hour24 - 12) : String(hour24);
  if (dowStr !== "*") return { frequency: "weekly", hour: hour12, ampm, weekday: dowStr as Weekday, monthDay: "1" };
  if (domStr !== "*") return { frequency: "monthly", hour: hour12, ampm, weekday: "1", monthDay: domStr };
  return { frequency: "daily", hour: hour12, ampm, weekday: "1", monthDay: "1" };
}

function describeSchedule(expr: string): string {
  const s = cronToScheduleChoice(expr);
  if (s.frequency === "hourly") return "Every hour";
  const timeLabel = `${s.hour} ${s.ampm}`;
  if (s.frequency === "daily")   return `Every day at ${timeLabel}`;
  if (s.frequency === "weekly")  return `Every ${WEEKDAY_LABELS[s.weekday]} at ${timeLabel}`;
  if (s.frequency === "monthly") {
    const suffix = ["th","st","nd","rd"][ Number(s.monthDay) <= 3 ? Number(s.monthDay) : 0 ] || "th";
    return `${s.monthDay}${suffix} of every month at ${timeLabel}`;
  }
  return expr;
}

const CITY_TIMEZONES = [
  { label: "New York (Eastern)",    value: "America/New_York" },
  { label: "Chicago (Central)",     value: "America/Chicago" },
  { label: "Denver (Mountain)",     value: "America/Denver" },
  { label: "Los Angeles (Pacific)", value: "America/Los_Angeles" },
  { label: "Phoenix (Arizona)",     value: "America/Phoenix" },
  { label: "Honolulu (Hawaii)",     value: "Pacific/Honolulu" },
  { label: "London",                value: "Europe/London" },
  { label: "Paris / Berlin",        value: "Europe/Paris" },
  { label: "Tokyo",                 value: "Asia/Tokyo" },
  { label: "Mumbai",                value: "Asia/Kolkata" },
  { label: "Sydney",                value: "Australia/Sydney" },
  { label: "UTC (no time zone)",    value: "UTC" }
];

function ScheduleBuilder({ value, onChange }: { value: string; onChange: (cron: string) => void }) {
  const [choice, setChoice] = useState<ScheduleChoice>(() => cronToScheduleChoice(value));
  function update(patch: Partial<ScheduleChoice>) {
    const next = { ...choice, ...patch };
    setChoice(next);
    onChange(scheduleChoiceToCron(next));
  }
  const sel = { padding: "0.35rem 0.5rem", borderRadius: 8, border: "1px solid var(--line)", fontFamily: "inherit", fontSize: "0.875rem", background: "rgba(255,255,255,0.9)" } as const;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      <label className="field">
        How often?
        <select style={sel} value={choice.frequency} onChange={(e) => update({ frequency: e.target.value as Frequency })}>
          <option value="hourly">Every hour</option>
          <option value="daily">Every day</option>
          <option value="weekly">Every week</option>
          <option value="monthly">Every month</option>
        </select>
      </label>

      {choice.frequency !== "hourly" && (
        <label className="field">
          What time?
          <div style={{ display: "flex", gap: "0.4rem" }}>
            <select style={{ ...sel, flex: 1 }} value={choice.hour} onChange={(e) => update({ hour: e.target.value })}>
              {HOUR_OPTIONS.map((h) => <option key={h} value={h}>{h} {choice.ampm}</option>)}
            </select>
            <select style={sel} value={choice.ampm} onChange={(e) => update({ ampm: e.target.value as "AM" | "PM" })}>
              <option value="AM">AM</option>
              <option value="PM">PM</option>
            </select>
          </div>
        </label>
      )}

      {choice.frequency === "weekly" && (
        <label className="field">
          Which day of the week?
          <select style={sel} value={choice.weekday} onChange={(e) => update({ weekday: e.target.value as Weekday })}>
            {(Object.entries(WEEKDAY_LABELS) as [Weekday, string][]).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
      )}

      {choice.frequency === "monthly" && (
        <label className="field">
          Which day of the month?
          <select style={sel} value={choice.monthDay} onChange={(e) => update({ monthDay: e.target.value })}>
            {MONTH_DAY_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(value: string | null) {
  if (!value) return "Never";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function getObjectName(doc: StudioDocument, objectId: string): string {
  return doc.bundle.objects[objectId]?.name || objectId;
}

function parseRecipients(raw: string): string[] {
  return raw.split(/[\n,;]+/).map((s) => s.trim()).filter((s) => s.includes("@")).slice(0, 50);
}

function recipientsToString(list: string[]): string {
  return list.join("\n");
}

// ── Form state ────────────────────────────────────────────────────────────────

interface ConfigFormState {
  objectId: string;
  objectType: "report" | "dashboard";
  cronExpression: string;
  timeZone: string;
  recipientsRaw: string;
  enabled: boolean;
}

function blankForm(doc: StudioDocument): ConfigFormState {
  const first = Object.values(doc.bundle.objects)[0];
  return {
    objectId: first?.id || "",
    objectType: first?.type === "dashboard" ? "dashboard" : "report",
    cronExpression: "0 8 * * 1",
    timeZone: "America/New_York",
    recipientsRaw: "",
    enabled: true
  };
}

function configToForm(c: ReportConfig): ConfigFormState {
  return {
    objectId: c.object_id,
    objectType: c.object_type,
    cronExpression: c.cron_expression,
    timeZone: c.time_zone,
    recipientsRaw: recipientsToString(c.send_to),
    enabled: c.enabled
  };
}

// ── Config form component ─────────────────────────────────────────────────────

function ConfigForm({
  form,
  setForm,
  doc,
  submitLabel,
  onSubmit,
  onCancel,
  saving,
  error
}: {
  form: ConfigFormState;
  setForm: (fn: (prev: ConfigFormState) => ConfigFormState) => void;
  doc: StudioDocument;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string;
}) {
  const allObjects = Object.values(doc.bundle.objects);
  const reports = allObjects.filter((o) => o.type === "report");
  const dashboards = allObjects.filter((o) => o.type === "dashboard");

  return (
    <div className="card" style={{ borderColor: "rgba(13,124,102,0.22)" }}>
      <div className="card-head">
        <strong>{submitLabel}</strong>
        <button type="button" className="ghost-button btn-neutral" style={{ minHeight: 30, padding: "0 8px", boxShadow: "none" }} onClick={onCancel}>Cancel</button>
      </div>
      {error ? <div className="sync-status sync-status-warn"><span>{error}</span></div> : null}

      <label className="field">
        Which report or dashboard should be emailed?
        <select value={form.objectId} onChange={(e) => {
          const obj = doc.bundle.objects[e.target.value];
          setForm((f) => ({ ...f, objectId: e.target.value, objectType: obj?.type === "dashboard" ? "dashboard" : "report" }));
        }}>
          {reports.length > 0 && <optgroup label="Reports">{reports.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>}
          {dashboards.length > 0 && <optgroup label="Dashboards">{dashboards.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</optgroup>}
        </select>
      </label>

      <label className="field">
        When should it be sent?
      </label>
      <ScheduleBuilder
        value={form.cronExpression}
        onChange={(cron) => setForm((f) => ({ ...f, cronExpression: cron }))}
      />

      <label className="field">
        Time zone
        <select value={form.timeZone} onChange={(e) => setForm((f) => ({ ...f, timeZone: e.target.value }))}>
          {CITY_TIMEZONES.map((tz) => <option key={tz.value} value={tz.value}>{tz.label}</option>)}
        </select>
      </label>

      <label className="field">
        Who should receive the email?
        <textarea
          value={form.recipientsRaw}
          onChange={(e) => setForm((f) => ({ ...f, recipientsRaw: e.target.value }))}
          placeholder={"alice@company.com\nbob@company.com"}
          rows={3}
        />
        <span className="micro">One email address per line. You can add up to 50 people.</span>
      </label>

      <label className="toggle-row">
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />
        Start sending right away
      </label>

      <button type="button" className="ghost-button btn-create" onClick={onSubmit} disabled={saving} style={{ width: "100%", justifyContent: "center" }}>
        {saving ? "Saving…" : submitLabel}
      </button>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

interface Props { documentState: StudioDocument; }

export function ScheduledEmailsPanel({ documentState }: Props) {
  const [configs, setConfigs] = useState<ReportConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState<ConfigFormState>(() => blankForm(documentState));
  const [createError, setCreateError] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<ConfigFormState>(() => blankForm(documentState));
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; message: string; ok: boolean } | null>(null);

  async function load() {
    setLoading(true); setError("");
    try { setConfigs((await listReportConfigs()).configs); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load scheduled emails."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function handleCreate() {
    const recipients = parseRecipients(createForm.recipientsRaw);
    if (!createForm.objectId) { setCreateError("Choose a report or dashboard to send."); return; }
    if (!recipients.length) { setCreateError("Enter at least one email address."); return; }
    setCreating(true); setCreateError("");
    try {
      await createReportConfig({
        object_id: createForm.objectId,
        object_type: createForm.objectType,
        enabled: createForm.enabled,
        cron_expression: createForm.cronExpression,
        time_zone: createForm.timeZone,
        send_to: recipients
      });
      setShowCreate(false);
      setCreateForm(blankForm(documentState));
      await load();
    } catch (err) { setCreateError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setCreating(false); }
  }

  async function handleEdit() {
    if (!editingId) return;
    const recipients = parseRecipients(editForm.recipientsRaw);
    if (!recipients.length) { setEditError("Enter at least one email address."); return; }
    setEditing(true); setEditError("");
    try {
      await updateReportConfig(editingId, {
        enabled: editForm.enabled,
        cron_expression: editForm.cronExpression,
        time_zone: editForm.timeZone,
        send_to: recipients
      });
      setEditingId(null);
      await load();
    } catch (err) { setEditError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setEditing(false); }
  }

  async function toggleEnabled(config: ReportConfig) {
    try {
      const updated = await updateReportConfig(config.id, {
        enabled: !config.enabled,
        cron_expression: config.cron_expression,
        time_zone: config.time_zone,
        send_to: config.send_to
      });
      setConfigs((prev) => prev.map((c) => c.id === config.id ? updated.config : c));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update."); }
  }

  async function handleDelete(id: string) {
    if (!window.confirm("Remove this scheduled email? This cannot be undone.")) return;
    try { await deleteReportConfig(id); setConfigs((prev) => prev.filter((c) => c.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete."); }
  }

  async function handleTest(id: string) {
    setTestingId(id); setTestResult(null);
    try {
      const result = await testReportConfig(id);
      setTestResult({ id, message: "Test email sent successfully! Check your inbox.", ok: true });
    } catch (err) {
      setTestResult({ id, message: err instanceof Error ? err.message : "Test failed — check the recipients and try again.", ok: false });
    } finally { setTestingId(null); }
    setTimeout(() => setTestResult(null), 10_000);
  }

  const btnSm = { minHeight: 30, padding: "0 10px", fontSize: "0.8rem", boxShadow: "none" } as const;

  return (
    <div className="stack-compact">
      <div className="card-head">
        <strong>Scheduled Email Reports</strong>
        <span className="micro">
          Automatically email reports and dashboards as Excel attachments on a schedule.
        </span>
      </div>

      {error ? <div className="sync-status sync-status-warn"><span>{error}</span></div> : null}
      {testResult ? (
        <div className={`sync-status ${testResult.ok ? "sync-status-ok" : "sync-status-warn"}`}>
          <span>{testResult.message}</span>
        </div>
      ) : null}

      {loading ? <div className="empty-hint">Loading…</div> : (
        <>
          {configs.length === 0 && !showCreate && (
            <div className="empty-hint">
              No scheduled emails set up yet. Click the button below to create your first one.
            </div>
          )}

          {configs.map((config) => (
            editingId === config.id ? (
              <ConfigForm
                key={config.id}
                form={editForm}
                setForm={setEditForm}
                doc={documentState}
                submitLabel="Save changes"
                onSubmit={() => { void handleEdit(); }}
                onCancel={() => { setEditingId(null); setEditError(""); }}
                saving={editing}
                error={editError}
              />
            ) : (
              <div key={config.id} className="picker-row" style={{ gridTemplateColumns: "1fr auto", alignItems: "start" }}>
                <div className="stack" style={{ gap: 4 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`badge${config.enabled ? " brand" : ""}`}>
                      {config.enabled ? "Active" : "Paused"}
                    </span>
                    <span className="badge">{config.object_type === "dashboard" ? "Dashboard" : "Report"}</span>
                    <strong>{getObjectName(documentState, config.object_id)}</strong>
                  </div>
                  <div className="micro">{describeSchedule(config.cron_expression)} · {CITY_TIMEZONES.find((t) => t.value === config.time_zone)?.label || config.time_zone}</div>
                  <div className="micro" style={{ color: "var(--text-soft)" }}>
                    To: {config.send_to.join(", ") || "No recipients set"}
                  </div>
                  <div className="micro" style={{ display: "flex", gap: 12, flexWrap: "wrap", color: "var(--text-soft)" }}>
                    <span>Last sent: {formatDate(config.last_run_at)}</span>
                    <span>Next: {formatDate(config.next_run_at)}</span>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", flexShrink: 0 }}>
                  <button type="button" className="ghost-button btn-system" style={btnSm}
                    onClick={() => { void handleTest(config.id); }}
                    disabled={testingId === config.id}
                    title="Send a test email right now to verify everything is set up correctly">
                    {testingId === config.id ? "Sending…" : "Send test"}
                  </button>
                  <button type="button" className="ghost-button btn-neutral" style={btnSm}
                    onClick={() => { setEditingId(config.id); setEditForm(configToForm(config)); setEditError(""); }}>
                    Edit
                  </button>
                  <button type="button" className="ghost-button btn-warning" style={btnSm}
                    onClick={() => { void toggleEnabled(config); }}>
                    {config.enabled ? "Pause" : "Resume"}
                  </button>
                  <button type="button" className="ghost-button btn-danger" style={btnSm}
                    onClick={() => { void handleDelete(config.id); }}>
                    Remove
                  </button>
                </div>
              </div>
            )
          ))}

          {showCreate ? (
            <ConfigForm
              form={createForm}
              setForm={setCreateForm}
              doc={documentState}
              submitLabel="Set up scheduled email"
              onSubmit={() => { void handleCreate(); }}
              onCancel={() => { setShowCreate(false); setCreateError(""); }}
              saving={creating}
              error={createError}
            />
          ) : (
            <button
              type="button"
              className="ghost-button btn-create"
              style={{ justifyContent: "flex-start" }}
              onClick={() => { setCreateForm(blankForm(documentState)); setShowCreate(true); }}
            >
              + Set up a new scheduled email
            </button>
          )}
        </>
      )}
    </div>
  );
}
