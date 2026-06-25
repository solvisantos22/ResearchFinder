export type WorkerStatusKey = "online" | "offline" | "needs_auth" | "unknown";
export type SignalStatusKey = "pass" | "warning" | "fail";
export type ScoreToneKey = "neutral" | "strong" | "warning";
export type NoveltyLabelKey =
  | "likely_novel"
  | "unclear"
  | "crowded"
  | "near_duplicate"
  | "not_checked";

export const workerStatusStyles: Record<WorkerStatusKey, string> = {
  online: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  offline: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger",
  needs_auth: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  unknown: "border-rf-border bg-rf-surface text-rf-muted"
};

export const signalStatusStyles: Record<SignalStatusKey, string> = {
  pass: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  warning: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  fail: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger"
};

export const scoreToneStyles: Record<ScoreToneKey, string> = {
  neutral: "border-rf-border bg-rf-surface text-rf-white",
  strong: "border-rf-violetSoft/50 bg-rf-violet/15 text-rf-white",
  warning: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning"
};

export const noveltyLabelStyles: Record<NoveltyLabelKey, string> = {
  likely_novel: "border-rf-success/40 bg-rf-success/10 text-rf-success",
  unclear: "border-rf-border bg-rf-surface text-rf-muted",
  crowded: "border-rf-warning/40 bg-rf-warning/10 text-rf-warning",
  near_duplicate: "border-rf-danger/40 bg-rf-danger/10 text-rf-danger",
  not_checked: "border-rf-border bg-rf-surface text-rf-muted"
};
