import type { WorkerStatus } from "@/components/WorkerStatusPanel";
import { prisma } from "@/lib/db";
import type { WorkerJobType } from "@/lib/workers/lanes";
import { ONLINE_WINDOW_MS } from "@/lib/workers/status";

export type WorkerCurrentJob = {
  jobType: WorkerJobType;
  jobId: string;
  targetLabel: string;
  startedAt: Date | null;
};

export type WorkerActivityLog = {
  id: string;
  jobType: string;
  level: string;
  message: string;
  createdAt: Date;
};

export type WorkerOverviewRow = {
  id: string;
  label: string;
  lane: string;
  status: WorkerStatus;
  lastSeenAt: Date | null;
  createdAt: Date;
  currentJobs: WorkerCurrentJob[];
  recentLogs: WorkerActivityLog[];
};

export function deriveWorkerStatus(worker: { status: string; lastSeenAt: Date | null }): WorkerStatus {
  if (worker.status === "needs_auth") return "needs_auth";
  if (worker.lastSeenAt && Date.now() - worker.lastSeenAt.getTime() <= ONLINE_WINDOW_MS) {
    return "online";
  }
  return "offline";
}

export async function buildWorkerJobTargetLabel(jobType: WorkerJobType, jobId: string): Promise<string> {
  if (jobType === "inbox_generation") {
    const job = await prisma.inboxGenerationJob.findUnique({
      where: { id: jobId },
      select: { inboxDate: true }
    });
    return job?.inboxDate ?? jobId;
  }

  if (jobType === "novelty_scan") {
    const job = await prisma.inboxNoveltyScanJob.findUnique({
      where: { id: jobId },
      select: { inboxDate: true }
    });
    return job?.inboxDate ?? jobId;
  }

  if (jobType === "viability_check") {
    const job = await prisma.viabilityJob.findUnique({
      where: { id: jobId },
      select: { generatedIdea: { select: { title: true } }, idea: { select: { title: true } } }
    });
    return job?.generatedIdea?.title ?? job?.idea?.title ?? jobId;
  }

  const job = await prisma.researchStageJob.findUnique({
    where: { id: jobId },
    select: { researchProject: { select: { generatedIdea: { select: { title: true } } } } }
  });
  return job?.researchProject?.generatedIdea?.title ?? jobId;
}

async function getRunningJobsForWorker(workerId: string): Promise<WorkerCurrentJob[]> {
  const [inbox, novelty, viability, research] = await Promise.all([
    prisma.inboxGenerationJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.inboxNoveltyScanJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.viabilityJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true }
    }),
    prisma.researchStageJob.findMany({
      where: { claimedByWorkerId: workerId, status: "running" },
      select: { id: true, startedAt: true, stageType: true }
    })
  ]);

  const rows: { jobType: WorkerJobType; id: string; startedAt: Date | null }[] = [
    ...inbox.map((j) => ({ jobType: "inbox_generation" as const, id: j.id, startedAt: j.startedAt })),
    ...novelty.map((j) => ({ jobType: "novelty_scan" as const, id: j.id, startedAt: j.startedAt })),
    ...viability.map((j) => ({ jobType: "viability_check" as const, id: j.id, startedAt: j.startedAt })),
    ...research.map((j) => ({ jobType: `research_${j.stageType}` as WorkerJobType, id: j.id, startedAt: j.startedAt }))
  ];

  return Promise.all(
    rows.map(async (r) => ({
      jobType: r.jobType,
      jobId: r.id,
      startedAt: r.startedAt,
      targetLabel: await buildWorkerJobTargetLabel(r.jobType, r.id)
    }))
  );
}

export async function getWorkersOverviewForUser(userId: string): Promise<WorkerOverviewRow[]> {
  const workers = await prisma.workerRegistration.findMany({
    where: { userId, revokedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, label: true, lane: true, status: true, lastSeenAt: true, createdAt: true }
  });

  return Promise.all(
    workers.map(async (worker) => {
      const [currentJobs, recentLogs] = await Promise.all([
        getRunningJobsForWorker(worker.id),
        prisma.workerJobLog.findMany({
          where: { workerId: worker.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: { id: true, jobType: true, level: true, message: true, createdAt: true }
        })
      ]);

      return {
        id: worker.id,
        label: worker.label,
        lane: worker.lane,
        status: deriveWorkerStatus(worker),
        lastSeenAt: worker.lastSeenAt,
        createdAt: worker.createdAt,
        currentJobs,
        recentLogs
      };
    })
  );
}
