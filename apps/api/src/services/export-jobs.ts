import { createWriteStream, existsSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExportJobStatus } from "@studio/shared";

type ExportJobRunner = (helpers: {
  jobId: string;
  filePath: string;
  update: (progress: number, message: string) => void;
}) => Promise<void>;

export class ExportJobStore {
  private jobs = new Map<string, ExportJobStatus & { filePath?: string }>();

  private cleanup() {
    const cutoff = Date.now() - 1000 * 60 * 30;
    for (const [id, job] of this.jobs.entries()) {
      if (new Date(job.updatedAt).getTime() >= cutoff) continue;
      if (job.filePath && existsSync(job.filePath)) {
        try {
          unlinkSync(job.filePath);
        } catch {}
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
      id,
      objectId,
      objectType,
      format: "xlsx",
      status: "queued",
      progress: 0,
      message: "Queued",
      filename,
      createdAt: now,
      updatedAt: now,
      filePath
    };
    this.jobs.set(id, job);
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
  }

  getJob(id: string) {
    this.cleanup();
    return this.jobs.get(id);
  }

  listJobs() {
    this.cleanup();
    return Array.from(this.jobs.values())
      .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime());
  }

  createFileStream(id: string) {
    const job = this.jobs.get(id);
    if (!job?.filePath) return null;
    return createWriteStream(job.filePath);
  }
}

export const exportJobStore = new ExportJobStore();
