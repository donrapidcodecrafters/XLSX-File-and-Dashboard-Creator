import type { RefreshJobStatus } from "@studio/shared";
import { randomUUID } from "node:crypto";

type RefreshJobRunner = (helpers: {
  jobId: string;
  update: (progress: number, message: string, extras?: Partial<RefreshJobStatus>) => void;
}) => Promise<Partial<RefreshJobStatus> | void>;

export class RefreshJobStore {
  private jobs = new Map<string, RefreshJobStatus>();
  private runningJobId: string | null = null;

  getActiveJob() {
    if (!this.runningJobId) return null;
    return this.jobs.get(this.runningJobId) || null;
  }

  createJob(reason: "manual" | "scheduled", runner: RefreshJobRunner) {
    const active = this.getActiveJob();
    if (active && (active.status === "queued" || active.status === "running")) {
      return active;
    }
    const now = new Date().toISOString();
    const job: RefreshJobStatus = {
      id: randomUUID(),
      status: "queued",
      progress: 0,
      message: "Queued",
      reason,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(job.id, job);
    this.runningJobId = job.id;
    void this.runJob(job, runner);
    return job;
  }

  private async runJob(job: RefreshJobStatus, runner: RefreshJobRunner) {
    this.update(job.id, 1, "Starting refresh", { status: "running", startedAt: new Date().toISOString() });
    try {
      const extras = await runner({
        jobId: job.id,
        update: (progress, message, partial) => this.update(job.id, progress, message, { status: "running", ...(partial || {}) })
      });
      this.update(job.id, 100, "Refresh complete", {
        status: "complete",
        completedAt: new Date().toISOString(),
        ...(extras || {})
      });
    } catch (error) {
      this.update(job.id, Math.max(this.jobs.get(job.id)?.progress || 0, 1), error instanceof Error ? error.message : "Refresh failed.", {
        status: "failed",
        error: error instanceof Error ? error.message : "Refresh failed.",
        completedAt: new Date().toISOString()
      });
    } finally {
      if (this.runningJobId === job.id) {
        this.runningJobId = null;
      }
    }
  }

  private update(id: string, progress: number, message: string, extras: Partial<RefreshJobStatus> = {}) {
    const current = this.jobs.get(id);
    if (!current) return;
    const now = Date.now();
    const startedAt = extras.startedAt || current.startedAt;
    let estimatedSecondsRemaining = extras.estimatedSecondsRemaining;
    if (estimatedSecondsRemaining === undefined && startedAt && progress >= 15 && progress < 100) {
      const elapsedSeconds = Math.max(1, Math.round((now - new Date(startedAt).getTime()) / 1000));
      estimatedSecondsRemaining = Math.max(0, Math.round((elapsedSeconds / progress) * (100 - progress)));
    }
    this.jobs.set(id, {
      ...current,
      ...extras,
      progress: Math.max(0, Math.min(100, progress)),
      message,
      updatedAt: new Date().toISOString(),
      estimatedSecondsRemaining
    });
  }

  getJob(id: string) {
    return this.jobs.get(id) || null;
  }
}

export const refreshJobStore = new RefreshJobStore();
