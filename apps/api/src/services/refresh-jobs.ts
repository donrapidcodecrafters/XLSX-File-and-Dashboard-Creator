import type { RefreshJobStatus } from "@studio/shared";
import { randomUUID } from "node:crypto";
import { getJobQueue } from "./job-queue.js";

class RefreshCancelledError extends Error {
  constructor(message = "Refresh cancelled.") {
    super(message);
    this.name = "RefreshCancelledError";
  }
}

type RefreshJobRunner = (helpers: {
  jobId: string;
  update: (progress: number, message: string, extras?: Partial<RefreshJobStatus>) => void;
}) => Promise<Partial<RefreshJobStatus> | void>;

// pg-boss queue name for refresh jobs.
// Using 'exclusive' policy: only one job (queued OR active) allowed at a time.
const REFRESH_QUEUE = "quickbase-refresh";

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
    const id = randomUUID();
    const now = new Date().toISOString();
    const job: RefreshJobStatus = {
      id,
      status: "queued",
      progress: 0,
      message: "Queued",
      reason,
      createdAt: now,
      updatedAt: now
    };
    this.jobs.set(id, job);
    this.runningJobId = id;

    // Also track in pg-boss for singleton enforcement across restarts.
    // If pg-boss is running and an exclusive-policy job is already active,
    // send() returns null — the in-memory job will still run (already started),
    // and the pg-boss record gives us durability on the next boot.
    const boss = getJobQueue();
    if (boss) {
      boss.send(REFRESH_QUEUE, { jobId: id, reason }, {
        id  // use our jobId as the pg-boss job ID for correlation
      }).catch(() => {
        // pg-boss send is best-effort; in-memory job continues regardless
      });
    }

    void this.runJob(job, runner);
    return job;
  }

  cancelJob(id: string, message = "Refresh cancelled.") {
    const current = this.jobs.get(id);
    if (!current) return null;
    if (current.status === "complete" || current.status === "failed" || current.status === "cancelled") {
      return current;
    }
    this.update(id, current.progress || 0, message, {
      status: "cancelled",
      error: undefined,
      completedAt: new Date().toISOString(),
      estimatedSecondsRemaining: 0
    });
    if (this.runningJobId === id) {
      this.runningJobId = null;
    }
    // Complete the pg-boss record so it doesn't stall
    const boss = getJobQueue();
    if (boss) {
      boss.cancel(REFRESH_QUEUE, id).catch(() => {});
    }
    return this.jobs.get(id) || null;
  }

  private async runJob(job: RefreshJobStatus, runner: RefreshJobRunner) {
    this.update(job.id, 1, "Starting refresh", { status: "running", startedAt: new Date().toISOString() });
    try {
      const extras = await runner({
        jobId: job.id,
        update: (progress, message, partial) =>
          this.update(job.id, progress, message, { status: "running", ...(partial || {}) })
      });
      this.update(job.id, 100, "Refresh complete", {
        status: "complete",
        completedAt: new Date().toISOString(),
        ...(extras || {})
      });
    } catch (error) {
      if (error instanceof RefreshCancelledError) {
        this.update(
          job.id,
          Math.max(this.jobs.get(job.id)?.progress || 0, 1),
          error.message || "Refresh cancelled.",
          { status: "cancelled", completedAt: new Date().toISOString(), estimatedSecondsRemaining: 0 }
        );
        return;
      }
      this.update(
        job.id,
        Math.max(this.jobs.get(job.id)?.progress || 0, 1),
        error instanceof Error ? error.message : "Refresh failed.",
        {
          status: "failed",
          error: error instanceof Error ? error.message : "Refresh failed.",
          completedAt: new Date().toISOString()
        }
      );
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
export { RefreshCancelledError };
