import { NextResponse } from "next/server";

import { findAllowedWorkerByToken } from "@/lib/auth/worker-token";
import { prisma } from "@/lib/db";
import { claimNextInboxGenerationJob } from "@/lib/jobs/inbox-generation";
import { claimNextNoveltyScanJob } from "@/lib/jobs/novelty-scan";
import { claimNextViabilityJob } from "@/lib/jobs/viability";
import { readBearerToken } from "@/lib/jobs/worker-auth";
import { claimNextResearchStageJob, failResearchStageJob, buildViabilityContextFromArtifactContent } from "@/lib/jobs/research";
import { laneClaimsJobType } from "@/lib/workers/lanes";
import { MAX_DAILY_IDEAS, MAX_IDEAS_PER_PAPER } from "@/lib/v2/domain";
import {
  type InboxGenerationJobInput,
  InboxGenerationJobInputSchema,
  type NoveltyScanJobInput,
  NoveltyScanJobInputSchema,
  ResearchPlanJobInputSchema,
  type ResearchPlanJobInput,
  LiteratureJobInputSchema,
  type LiteratureJobInput,
  ResearchPlanSchema,
  LiteratureReviewSchema,
  ExperimentJobInputSchema,
  type ExperimentJobInput,
  ExperimentResultSchema,
  AnalysisJobInputSchema,
  type AnalysisJobInput
} from "@/lib/v2/schemas";

export async function POST(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const worker = await findAllowedWorkerByToken(token);
  if (!worker) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await prisma.workerRegistration.update({
    where: { id: worker.id },
    data: { lastSeenAt: new Date() }
  });

  const lane = worker.lane;

  if (laneClaimsJobType(lane, "inbox_generation")) {
    const job = await claimNextInboxGenerationJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (job) {
      try {
        if (!job.user.profile) {
          throw new Error("Worker user has no research profile");
        }

        const input: InboxGenerationJobInput = InboxGenerationJobInputSchema.parse({
          jobId: job.id,
          userId: job.userId,
          inboxDate: job.inboxDate,
          profile: {
            fieldPreset: job.user.profile.fieldPresetKey,
            keywords: parseJsonArray(job.user.profile.keywordsJson, "keywordsJson"),
            constraints: parseJsonArray(job.user.profile.constraintsJson, "constraintsJson"),
            preferredOutputs: parseJsonArray(
              job.user.profile.preferredOutputsJson,
              "preferredOutputsJson"
            ),
            arxivQuery: job.user.profile.arxivQuery,
            maxIdeas: MAX_DAILY_IDEAS,
            maxIdeasPerPaper: MAX_IDEAS_PER_PAPER
          },
          candidatePapers: job.candidateBatch.candidates.map((candidate) => ({
            sourceId: candidate.arxivId,
            title: candidate.title,
            abstract: candidate.abstract,
            url: candidate.url,
            authors: parseJsonArray(candidate.authorsJson, "authorsJson"),
            categories: parseJsonArray(candidate.categoriesJson, "categoriesJson"),
            publishedAt: candidate.publishedAt.toISOString()
          }))
        });

        return NextResponse.json({ job: { type: "inbox_generation", id: job.id, input } });
      } catch (error) {
        await prisma.inboxGenerationJob.update({
          where: { id: job.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (laneClaimsJobType(lane, "novelty_scan")) {
    const noveltyJob = await claimNextNoveltyScanJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (noveltyJob) {
      try {
        return NextResponse.json({
          job: { type: "novelty_scan", id: noveltyJob.id, input: buildNoveltyScanJobInput(noveltyJob) }
        });
      } catch (error) {
        await prisma.inboxNoveltyScanJob.update({
          where: { id: noveltyJob.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (laneClaimsJobType(lane, "viability_check")) {
    const viabilityJob = await claimNextViabilityJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (viabilityJob) {
      try {
        return NextResponse.json({
          job: { type: "viability_check", id: viabilityJob.id, input: buildViabilityJobInput(viabilityJob) }
        });
      } catch (error) {
        await prisma.viabilityJob.update({
          where: { id: viabilityJob.id },
          data: { status: "failed", errorMessage: formatErrorMessage(error), completedAt: new Date() }
        });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  if (
    laneClaimsJobType(lane, "research_plan") ||
    laneClaimsJobType(lane, "research_literature") ||
    laneClaimsJobType(lane, "research_experiment") ||
    laneClaimsJobType(lane, "research_analysis") ||
    laneClaimsJobType(lane, "research_plan_critic") ||
    laneClaimsJobType(lane, "research_literature_critic") ||
    laneClaimsJobType(lane, "research_experiment_critic") ||
    laneClaimsJobType(lane, "research_analysis_critic")
  ) {
    const stageJob = await claimNextResearchStageJob({
      userId: worker.userId,
      workerId: worker.id
    });

    if (stageJob) {
      try {
        if (stageJob.kind === "critic") {
          const input = buildStageCriticJobInput(stageJob);
          return NextResponse.json({
            job: { type: `research_${stageJob.stageType}_critic`, id: stageJob.id, input }
          });
        }

        const input =
          stageJob.stageType === "analysis"
            ? await buildAnalysisJobInput(stageJob)
            : stageJob.stageType === "experiment"
              ? await buildExperimentJobInput(stageJob)
              : stageJob.stageType === "literature"
                ? await buildLiteratureJobInput(stageJob)
                : await buildResearchPlanJobInput(stageJob);
        return NextResponse.json({
          job: { type: `research_${stageJob.stageType}`, id: stageJob.id, input }
        });
      } catch (error) {
        await failResearchStageJob({ jobId: stageJob.id, errorMessage: formatErrorMessage(error) });
        return NextResponse.json({ error: "Claimed job payload could not be built" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ job: null });
}

function parseJsonArray(json: string, fieldName: string) {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON array`);
  }

  return value;
}

function formatErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown worker payload error";
}

type ClaimedNoveltyScanJob = NonNullable<Awaited<ReturnType<typeof claimNextNoveltyScanJob>>>;

function buildNoveltyScanJobInput(job: ClaimedNoveltyScanJob): NoveltyScanJobInput {
  if (!job.user.profile) {
    throw new Error("Worker user has no research profile");
  }

  return NoveltyScanJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    inboxDate: job.inboxDate,
    profile: {
      fieldPreset: job.user.profile.fieldPresetKey,
      keywords: parseJsonArray(job.user.profile.keywordsJson, "keywordsJson"),
      constraints: parseJsonArray(job.user.profile.constraintsJson, "constraintsJson"),
      preferredOutputs: parseJsonArray(
        job.user.profile.preferredOutputsJson,
        "preferredOutputsJson"
      ),
      allowRelatedWorkSearch: job.user.profile.allowRelatedWorkSearch
    },
    ideas: job.inboxGenerationJob.generatedIdeas.map((idea) => ({
      id: idea.id,
      title: idea.title,
      summary: idea.summary,
      expandedExplanation: idea.expandedExplanation,
      trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint,
      paper: {
        id: idea.paper.id,
        arxivId: idea.paper.arxivId,
        title: idea.paper.title,
        abstract: idea.paper.abstract,
        url: idea.paper.url,
        authors: parseJsonArray(idea.paper.authorsJson, "authorsJson"),
        categories: parseJsonArray(idea.paper.categoriesJson, "categoriesJson"),
        publishedAt: idea.paper.publishedAt.toISOString()
      }
    }))
  });
}

type ClaimedResearchStageJob = NonNullable<Awaited<ReturnType<typeof claimNextResearchStageJob>>>;

function findLiveArtifact(job: ClaimedResearchStageJob, stage: string) {
  return job.researchProject.stageArtifacts
    .filter((a) => a.stageType === stage && a.supersededAt === null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
}

async function buildResearchPlanJobInput(job: ClaimedResearchStageJob): Promise<ResearchPlanJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  let viability: ResearchPlanJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return ResearchPlanJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}

async function buildLiteratureJobInput(job: ClaimedResearchStageJob): Promise<LiteratureJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = findLiveArtifact(job, "plan");
  if (!planArtifact) {
    throw new Error("Literature stage requires a completed plan artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));

  return LiteratureJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    plan: {
      relationToSourcePaper: plan.relationToSourcePaper,
      hypotheses: plan.hypotheses,
      experimentalDesign: plan.experimentalDesign,
      metrics: plan.metrics
    },
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}

async function buildExperimentJobInput(job: ClaimedResearchStageJob): Promise<ExperimentJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = findLiveArtifact(job, "plan");
  if (!planArtifact) {
    throw new Error("Experiment stage requires a completed plan artifact");
  }
  const litArtifact = findLiveArtifact(job, "literature");
  if (!litArtifact) {
    throw new Error("Experiment stage requires a completed literature artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));
  const literature = LiteratureReviewSchema.parse(JSON.parse(litArtifact.artifactJson));

  let viability: ExperimentJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return ExperimentJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    plan: {
      relationToSourcePaper: plan.relationToSourcePaper,
      hypotheses: plan.hypotheses,
      experimentalDesign: plan.experimentalDesign,
      protocolSteps: plan.protocolSteps,
      datasets: plan.datasets,
      baselines: plan.baselines,
      metrics: plan.metrics,
      successCriteria: plan.successCriteria
    },
    literature: {
      positioning: literature.positioning,
      gaps: literature.gaps
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}

async function buildAnalysisJobInput(job: ClaimedResearchStageJob): Promise<AnalysisJobInput> {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;

  const planArtifact = findLiveArtifact(job, "plan");
  if (!planArtifact) {
    throw new Error("Analysis stage requires a completed plan artifact");
  }
  const litArtifact = findLiveArtifact(job, "literature");
  if (!litArtifact) {
    throw new Error("Analysis stage requires a completed literature artifact");
  }
  const expArtifact = findLiveArtifact(job, "experiment");
  if (!expArtifact) {
    throw new Error("Analysis stage requires a completed experiment artifact");
  }
  const plan = ResearchPlanSchema.parse(JSON.parse(planArtifact.artifactJson));
  const literature = LiteratureReviewSchema.parse(JSON.parse(litArtifact.artifactJson));
  const experiment = ExperimentResultSchema.parse(JSON.parse(expArtifact.artifactJson));

  let viability: AnalysisJobInput["viability"] = null;
  if (job.researchProject.sourceViabilityJobId) {
    const artifact = await prisma.artifact.findFirst({
      where: { jobId: job.researchProject.sourceViabilityJobId, kind: "viability-report" },
      orderBy: { createdAt: "desc" }
    });
    if (artifact) {
      viability = buildViabilityContextFromArtifactContent(artifact.content);
    }
  }

  return AnalysisJobInputSchema.parse({
    jobId: job.id,
    userId: job.userId,
    researchProjectId: job.researchProjectId,
    idea: {
      id: idea.id, title: idea.title, summary: idea.summary,
      expandedExplanation: idea.expandedExplanation, trajectory: idea.trajectory,
      smallestSprint: idea.smallestSprint
    },
    paper: {
      id: paper.id, arxivId: paper.arxivId, title: paper.title, abstract: paper.abstract, url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    plan: {
      relationToSourcePaper: plan.relationToSourcePaper,
      hypotheses: plan.hypotheses,
      successCriteria: plan.successCriteria,
      metrics: plan.metrics,
      baselines: plan.baselines,
      experimentalDesign: plan.experimentalDesign
    },
    literature: {
      positioning: literature.positioning,
      gaps: literature.gaps
    },
    experiment: {
      hypothesisOutcomes: experiment.hypothesisOutcomes,
      metrics: experiment.metrics,
      findings: experiment.findings,
      limitations: experiment.limitations,
      verdict: experiment.verdict,
      environment: experiment.environment,
      reproductionSteps: experiment.reproductionSteps,
      artifacts: experiment.artifacts,
      logsExcerpt: experiment.logsExcerpt,
      summary: experiment.summary
    },
    viability,
    citations: idea.citations.map((citation) => ({
      sourceType: citation.sourceType, title: citation.title, url: citation.url,
      sourceId: citation.sourceId ?? undefined, claim: citation.claim, confidence: citation.confidence
    }))
  });
}

function buildStageCriticJobInput(job: ClaimedResearchStageJob) {
  const idea = job.researchProject.generatedIdea;
  const paper = idea.paper;
  const stage = job.stageType;

  const liveArtifact = findLiveArtifact(job, stage);
  if (!liveArtifact) {
    throw new Error(`Critic stage requires a live ${stage} artifact to judge`);
  }

  return {
    researchProjectId: job.researchProjectId,
    stageType: stage,
    artifactToJudge: JSON.parse(liveArtifact.artifactJson) as unknown,
    sourcePaper: {
      id: paper.id,
      arxivId: paper.arxivId,
      title: paper.title,
      abstract: paper.abstract,
      url: paper.url,
      authors: parseJsonArray(paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(paper.categoriesJson, "categoriesJson"),
      publishedAt: paper.publishedAt.toISOString()
    },
    criteria: `${stage} criteria placeholder — Phase 2 fills this in`
  };
}

type ClaimedViabilityJob = NonNullable<Awaited<ReturnType<typeof claimNextViabilityJob>>>;

function buildViabilityJobInput(job: ClaimedViabilityJob) {
  const sourceIdea = job.generatedIdea ?? job.idea;

  if (!sourceIdea) {
    throw new Error("Viability job is missing an idea reference");
  }

  return {
    jobId: job.id,
    userId: job.userId,
    sprintDepth: job.sprintDepth,
    autonomyLevel: job.autonomyLevel,
    idea: {
      id: sourceIdea.id,
      source: job.generatedIdea ? "generated_inbox" : "legacy_inbox",
      title: sourceIdea.title,
      summary: sourceIdea.summary,
      details:
        "expandedExplanation" in sourceIdea
          ? sourceIdea.expandedExplanation
          : sourceIdea.rationale,
      smallestSprint:
        "smallestSprint" in sourceIdea ? sourceIdea.smallestSprint : sourceIdea.approach
    },
    paper: {
      id: sourceIdea.paper.id,
      title: sourceIdea.paper.title,
      abstract: sourceIdea.paper.abstract,
      url: sourceIdea.paper.url,
      authors: parseJsonArray(sourceIdea.paper.authorsJson, "authorsJson"),
      categories: parseJsonArray(sourceIdea.paper.categoriesJson, "categoriesJson"),
      publishedAt: sourceIdea.paper.publishedAt.toISOString()
    },
    citations:
      "citations" in sourceIdea
        ? sourceIdea.citations.map((citation) => ({
            sourceType: citation.sourceType,
            title: citation.title,
            url: citation.url,
            sourceId: citation.sourceId,
            claim: citation.claim,
            confidence: citation.confidence
          }))
        : []
  };
}
