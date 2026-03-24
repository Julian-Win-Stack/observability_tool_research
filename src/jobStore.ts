import { randomUUID } from "node:crypto";
import type { OutputRow } from "./csvWriter.js";

export type JobStatus = "pending" | "processing" | "cancelled" | "done" | "error";

export type JobState = {
  status: JobStatus;
  message?: string;
  totalRows?: number;
  currentRow?: number;
  warnings: string[];
  batchRows?: OutputRow[];
  csvBase64?: string;
  singleResult?: string;
  error?: string;
  createdAtMs: number;
  updatedAtMs: number;
};

const jobs = new Map<string, JobState>();

// Guardrails: this is in-memory, so we must keep it from growing forever.
const MAX_JOB_AGE_MS = 60 * 60 * 1000; // 1 hour
const MAX_JOBS = 20;
let lastCleanupAtMs = 0;

function cleanup(nowMs: number): void {
  // Run cleanup occasionally (cheap, but avoid doing it on every tiny update).
  if (nowMs - lastCleanupAtMs < 10_000) return;
  lastCleanupAtMs = nowMs;

  for (const [jobId, job] of jobs) {
    if (nowMs - job.createdAtMs > MAX_JOB_AGE_MS) {
      jobs.delete(jobId);
    }
  }

  // If we still have too many jobs, drop the oldest ones.
  if (jobs.size <= MAX_JOBS) return;
  const sorted = [...jobs.entries()].sort((a, b) => a[1].createdAtMs - b[1].createdAtMs);
  const toDelete = sorted.length - MAX_JOBS;
  for (let i = 0; i < toDelete; i += 1) {
    jobs.delete(sorted[i][0]);
  }
}

export function createJob(): string {
  const nowMs = Date.now();
  cleanup(nowMs);

  const jobId = randomUUID();
  jobs.set(jobId, {
    status: "pending",
    warnings: [],
    createdAtMs: nowMs,
    updatedAtMs: nowMs
  });
  return jobId;
}

export function getJob(jobId: string): JobState | undefined {
  const nowMs = Date.now();
  cleanup(nowMs);
  return jobs.get(jobId);
}

export function setJobStatus(jobId: string, status: JobStatus): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = status;
  job.updatedAtMs = Date.now();
}

export function setJobMessage(jobId: string, message: string | undefined): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.message = message;
  job.updatedAtMs = Date.now();
}

export function setJobProgress(jobId: string, opts: { currentRow?: number; totalRows?: number }): void {
  const job = jobs.get(jobId);
  if (!job) return;
  if (typeof opts.currentRow === "number") job.currentRow = opts.currentRow;
  if (typeof opts.totalRows === "number") job.totalRows = opts.totalRows;
  job.updatedAtMs = Date.now();
}

export function addJobWarning(jobId: string, warning: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.warnings.push(warning);
  job.updatedAtMs = Date.now();
}

export function markJobDone(jobId: string, csvBase64: string, batchRows: OutputRow[]): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "done";
  job.batchRows = batchRows;
  job.csvBase64 = csvBase64;
  job.singleResult = undefined;
  job.error = undefined;
  job.updatedAtMs = Date.now();
}

export function markSingleJobDone(jobId: string, singleResult: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "done";
  job.batchRows = undefined;
  job.singleResult = singleResult;
  job.csvBase64 = undefined;
  job.error = undefined;
  job.updatedAtMs = Date.now();
}

export function markJobError(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "error";
  job.error = error;
  job.batchRows = undefined;
  job.singleResult = undefined;
  job.updatedAtMs = Date.now();
}

export function markJobCancelled(jobId: string, message = "Job cancelled by user"): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = "cancelled";
  job.message = message;
  job.updatedAtMs = Date.now();
}

