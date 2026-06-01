import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportJobStatus } from "@studio/shared";
import { pgQuery } from "../db/postgres.js";
import { isPostgresEnabled } from "../config/env.js";

type ExportJobRunner = (helpers: {
  jobId: string;
  filePath: string;
  update: (progress: number, message: string) => void;
}) => Promise<void>;

type PersistedStatus = ExportJobStatus["status"];

// ── Postgres persistence helpers ─────────────────────────────────────────────

async function dbUpsertJob(job: ExportJobStatus & { filePath?: string }) {
  if (!isPostgresEnabled()) return;
  await pgQuery(
    `INSERT INTO export_jobs (id, object_id, object_type, format, status, progress, message, filename, error, file_path, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status, progress = EXCLUDED.progress,
       message = EXCLUDED.message, error = EXCLUDED.error,
       file_path = EXCLUDED.file_path, updated_at = now()`,
    [
      job.id, job.objectId, job.objectType, job.format,
      job.status, job.progress, job.message,
      job.filename || "", job.error || "",
      ("filePath" in job ? String((job as { filePath?: unknown }).filePath || "") : "")
    ]
  ).catch(() => {});
}

async function dbGetJob(id: string): Promise<(ExportJobStatus & { filePath?: string }) | null> {
  if (!isPostgresEnabled()) return null;
  const result = await pgQuery<{
    id: string; object_id: string; object_type: string; format: string;
    status: PersistedStatus; progress: number; message: string;
    filename: string; error: string; file_path: string;
    created_at: Date; updated_at: Date;
  }>(`SELECT * FROM export_jobs WHERE id = $1`, [id]).catch(() => null);
  const row = result?.rows[0];
  if (!row) return null;
  return {
    id: row.id, objectId: row.object_id,
    objectType: row.object_type as ExportJobStatus["objectType"],
    format: "xlsx", status: row.status, progress: row.progress,
    message: row.message, filename: row.filename, error: row.error || undefined,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
    filePath: row.file_path || undefined
  };
}

/** On startup: mark any jobs that were running/queued as failed (server restarted). */
export async function recoverExportJobsOnStartup() {
  if (!isPostgresEnabled()) return;
  await pgQuery(
    `UPDATE export_jobs SET status = 'failed', message = 'Server restarted — please retry the export.', updated_at = now()
     WHERE status IN ('queued', 'running') AND created_at > now() - interval '24 hours'`
  ).catch(() => {});
}

// ── In-process job store ──────────────────────────────────────────────────────

export class ExportJobStore {
  private jobs = new Map<string, ExportJobStatus & { filePath?: string }>();

  private cleanup() {
    const cutoff = Date.now() - 1000 * 60 * 30;
    for (const [id, job] of this.jobs.entries()) {
      if (new Date(job.updatedAt).getTime() >= cutoff) continue;
      if (job.filePath && existsSync(job.filePath)) {
        try { unlinkSync(job.filePath); } catch {}
      }
      this.jobs.delete(id);
    }
  }

  createJob(
    objectId: string,
    objectType: "report" | "dashboard",
    filename: string,
    runner: ExportJobRunner
  ) {
    this.cleanup();
    const id = randomUUID();
    const filePath = join(tmpdir(), `studio-export-${id}.xlsx`);
    const now = new Date().toISOString();
    const job: ExportJobStatus & { filePath?: string } = {
      id, objectId, objectType, format: "xlsx",
      status: "queued", progress: 0, message: "Queued",
      filename, createdAt: now, updatedAt: now, filePath
    };
    this.jobs.set(id, job);
    void dbUpsertJob(job);
    void this.runJob(job, runner);
    return job;
  }

  private async runJob(job: ExportJobStatus & { filePath?: string }, runner: ExportJobRunner) {
    this.update(job.id, 2, "Starting export", "running");
    try {
      await runner({
        jobId: job.id,
        filePath: job.filePath || "",
        update: (progress, message) => this.update(job.id, progress, message, "running")
      });
      this.update(job.id, 100, "Download ready", "complete");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Export failed.";
      const current = this.jobs.get(job.id);
      if (current) {
        current.status = "failed";
        current.error = message;
        current.message = message;
        current.updatedAt = new Date().toISOString();
        this.jobs.set(job.id, current);
        void dbUpsertJob(current);
      }
    }
  }

  private update(id: string, progress: number, message: string, status: ExportJobStatus["status"]) {
    const job = this.jobs.get(id);
    if (!job) return;
    job.progress = Math.max(0, Math.min(100, progress));
    job.message = message;
    job.status = status;
    job.updatedAt = new Date().toISOString();
    this.jobs.set(id, job);
    void dbUpsertJob(job);
  }

  async getJob(id: string) {
    this.cleanup();
    // Check in-memory first (fast path for running jobs)
    const inMemory = this.jobs.get(id);
    if (inMemory) return inMemory;
    // Fall back to Postgres for jobs that survived a restart
    const persisted = await dbGetJob(id);
    if (persisted) {
      // If it was running when server died, message was already updated by recoverExportJobsOnStartup
      return persisted;
    }
    return undefined;
  }

  listJobs() {
    this.cleanup();
    return Array.from(this.jobs.values())
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  createFileStream(id: string) {
    const job = this.jobs.get(id);
    if (!job?.filePath) return null;
    return createWriteStream(job.filePath);
  }
}

export const exportJobStore = new ExportJobStore();
