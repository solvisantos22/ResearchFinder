export const STALE_RUNNING_JOB_TIMEOUT_MS = 30 * 60 * 1000;

export function staleRunningJobStartedBefore(now = new Date()) {
  return new Date(now.getTime() - STALE_RUNNING_JOB_TIMEOUT_MS);
}
