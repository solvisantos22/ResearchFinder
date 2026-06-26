import { prisma } from "@/lib/db";
import type { WorkerJobType } from "@/lib/workers/lanes";
import { buildWorkerJobTargetLabel } from "@/lib/workers/overview";

export async function recordWorkerJobLog(input: {
  workerId: string;
  jobType: WorkerJobType;
  jobId: string;
  level: "completed" | "failed";
  errorMessage?: string;
}): Promise<void> {
  try {
    const targetLabel = await buildWorkerJobTargetLabel(input.jobType, input.jobId);
    const verb = input.level === "completed" ? "Completed" : "Failed";
    const suffix = input.level === "failed" && input.errorMessage ? ` — ${input.errorMessage}` : "";
    const message = `${verb} ${input.jobType} for "${targetLabel}"${suffix}`;

    await prisma.workerJobLog.create({
      data: {
        workerId: input.workerId,
        jobType: input.jobType,
        jobId: input.jobId,
        level: input.level,
        message
      }
    });
  } catch {
    // Best-effort: activity logging must never break job completion/failure handling.
  }
}
