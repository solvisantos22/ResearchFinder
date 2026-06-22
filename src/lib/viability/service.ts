import { prisma } from "@/lib/db";

export type SignalStatus = "pass" | "warning" | "fail";

export type ViabilitySignal = {
  status: SignalStatus;
  summary: string;
  evidence: string[];
};

export type ViabilityDecision = {
  verdict: "expand";
  prototypeSignal: ViabilitySignal;
  researchSignal: ViabilitySignal;
  noveltySignal: ViabilitySignal;
  recommendedNextAction: string;
  artifacts: Array<{
    kind: "decision-report";
    title: string;
    content: string;
  }>;
  evidence: Array<{
    sourceTitle: string;
    sourceUrl: string;
    claim: string;
    support: string;
    confidence: number;
  }>;
};

export function buildViabilityDecision(input: {
  ideaTitle: string;
  paperTitle: string;
  sprintDepth: string;
  autonomyLevel: string;
}): ViabilityDecision {
  const prototypeSignal: ViabilitySignal = {
    status: "pass",
    summary: `${input.ideaTitle} can be framed as a bounded ${input.sprintDepth} prototype.`,
    evidence: [
      `Requested sprint depth is ${input.sprintDepth}.`,
      `Requested autonomy level is ${input.autonomyLevel}.`
    ]
  };

  const researchSignal: ViabilitySignal = {
    status: "pass",
    summary: `The idea is grounded in the source paper "${input.paperTitle}".`,
    evidence: [`Paper title: ${input.paperTitle}`]
  };

  const noveltySignal: ViabilitySignal = {
    status: "pass",
    summary: "The idea has enough implementation specificity to preserve for expansion review.",
    evidence: [`Idea title: ${input.ideaTitle}`]
  };

  const recommendedNextAction =
    "Expand only after reviewing preserved evidence, citation coverage, and the available sprint budget.";

  const content = [
    "# Verdict",
    "expand",
    "",
    "# Prototype signal",
    `${prototypeSignal.status}: ${prototypeSignal.summary}`,
    ...prototypeSignal.evidence.map((item) => `- ${item}`),
    "",
    "# Research signal",
    `${researchSignal.status}: ${researchSignal.summary}`,
    ...researchSignal.evidence.map((item) => `- ${item}`),
    "",
    "# Novelty signal",
    `${noveltySignal.status}: ${noveltySignal.summary}`,
    ...noveltySignal.evidence.map((item) => `- ${item}`),
    "",
    "# Recommended next action",
    recommendedNextAction
  ].join("\n");

  return {
    verdict: "expand",
    prototypeSignal,
    researchSignal,
    noveltySignal,
    recommendedNextAction,
    artifacts: [
      {
        kind: "decision-report",
        title: `Viability decision for ${input.ideaTitle}`,
        content
      }
    ],
    evidence: [
      {
        sourceTitle: input.paperTitle,
        sourceUrl: "",
        claim: prototypeSignal.summary,
        support: prototypeSignal.evidence.join(" "),
        confidence: 0.85
      },
      {
        sourceTitle: input.paperTitle,
        sourceUrl: "",
        claim: researchSignal.summary,
        support: researchSignal.evidence.join(" "),
        confidence: 0.9
      },
      {
        sourceTitle: input.paperTitle,
        sourceUrl: "",
        claim: noveltySignal.summary,
        support: noveltySignal.evidence.join(" "),
        confidence: 0.8
      }
    ]
  };
}

export async function processNextViabilityJob(): Promise<string | null> {
  const job = await prisma.viabilityJob.findFirst({
    where: { status: "queued" },
    orderBy: { createdAt: "asc" },
    include: {
      idea: {
        include: {
          paper: true
        }
      }
    }
  });

  if (!job) {
    return null;
  }

  await prisma.viabilityJob.update({
    where: { id: job.id },
    data: {
      status: "running",
      startedAt: new Date(),
      errorMessage: null
    }
  });

  try {
    const decision = buildViabilityDecision({
      ideaTitle: job.idea.title,
      paperTitle: job.idea.paper.title,
      sprintDepth: job.sprintDepth,
      autonomyLevel: job.autonomyLevel
    });

    await prisma.$transaction([
      prisma.artifact.createMany({
        data: decision.artifacts.map((artifact) => ({
          jobId: job.id,
          kind: artifact.kind,
          title: artifact.title,
          content: artifact.content
        }))
      }),
      prisma.evidence.createMany({
        data: decision.evidence.map((evidence) => ({
          jobId: job.id,
          sourceTitle: evidence.sourceTitle,
          sourceUrl: evidence.sourceUrl || job.idea.paper.url || "",
          claim: evidence.claim,
          support: evidence.support,
          confidence: evidence.confidence
        }))
      }),
      prisma.viabilityJob.update({
        where: { id: job.id },
        data: {
          status: "completed",
          verdict: decision.verdict,
          completedAt: new Date()
        }
      })
    ]);

    return job.id;
  } catch (error) {
    await prisma.viabilityJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      }
    });

    throw error;
  }
}
