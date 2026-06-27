import React from "react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/PageShell";
import { requireCurrentUser } from "@/lib/auth/session";
import { abortResearchProjectAction } from "@/app/research/actions";
import { getResearchProjectDetail } from "@/lib/jobs/research";
import { ExperimentResultSchema, LiteratureReviewSchema, ResearchPlanSchema } from "@/lib/v2/schemas";
import { RESEARCH_STAGES } from "@/lib/research/stages";

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-block rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs font-bold uppercase tracking-[0.16em] text-rf-white">
      {status.replaceAll("_", " ")}
    </span>
  );
}

export default async function ResearchProjectPage({
  params
}: {
  params: Promise<{ projectId: string }>;
}) {
  const currentUser = await requireCurrentUser();
  const { projectId } = await params;
  const project = await getResearchProjectDetail({ currentUserId: currentUser.id, projectId });

  if (!project) notFound();

  const artifactByStage = new Map(project.stageArtifacts.map((a) => [a.stageType, a]));
  const jobByStage = new Map(project.stageJobs.map((j) => [j.stageType, j]));

  const planArtifact = artifactByStage.get("plan");
  const plan = planArtifact
    ? (() => {
        const r = ResearchPlanSchema.safeParse(JSON.parse(planArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;

  const litArtifact = artifactByStage.get("literature");
  const literature = litArtifact
    ? (() => {
        const r = LiteratureReviewSchema.safeParse(JSON.parse(litArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;

  const expArtifact = artifactByStage.get("experiment");
  const experiment = expArtifact
    ? (() => {
        const r = ExperimentResultSchema.safeParse(JSON.parse(expArtifact.artifactJson));
        return r.success ? r.data : null;
      })()
    : null;

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="research"
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">Research project</p>
            <h1 className="text-3xl font-semibold text-rf-white">{project.generatedIdea.title}</h1>
            <p className="mt-2 text-sm text-rf-muted">
              Stage {project.currentStage} · <StatusBadge status={project.status} />
            </p>
            <p className="mt-1 text-sm text-rf-muted">
              Source paper:{" "}
              <a
                className="text-rf-violetSoft"
                href={project.generatedIdea.paper.url}
                target="_blank"
                rel="noreferrer"
              >
                {project.generatedIdea.paper.title}
              </a>
            </p>
          </div>
          {project.status === "running" ? (
            <form action={abortResearchProjectAction}>
              <input type="hidden" name="researchProjectId" value={project.id} />
              <button
                type="submit"
                className="rounded-md border border-rf-danger/50 bg-rf-surface px-4 py-2 text-sm font-semibold text-rf-danger"
              >
                Abort
              </button>
            </form>
          ) : null}
        </header>

        <section className="mb-4 flex flex-wrap gap-2">
          {RESEARCH_STAGES.map((stage) => {
            const status = jobByStage.get(stage)?.status ?? (artifactByStage.has(stage) ? "completed" : "not started");
            return (
              <span key={stage} className="rounded border border-rf-border bg-rf-surface px-2 py-0.5 text-xs text-rf-muted">
                {stage}: <span className="text-rf-white">{status.replaceAll("_", " ")}</span>
              </span>
            );
          })}
        </section>

        {plan ? (
          <section className="grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">How this extends the source paper</h2>
              <p className="mt-1">{plan.relationToSourcePaper}</p>
            </div>
            <PlanList title="Hypotheses" items={plan.hypotheses} />
            <div>
              <h3 className="font-semibold text-rf-white">Experimental design</h3>
              <p className="mt-1">{plan.experimentalDesign}</p>
            </div>
            <PlanList title="Protocol" items={plan.protocolSteps} ordered />
            <PlanList title="Datasets" items={plan.datasets} />
            <PlanList title="Baselines" items={plan.baselines} />
            <PlanList title="Metrics" items={plan.metrics} />
            <PlanList title="Success criteria" items={plan.successCriteria} />
            <div>
              <h3 className="font-semibold text-rf-white">Compute estimate</h3>
              <p className="mt-1">{plan.computeEstimate}</p>
            </div>
            <PlanList title="Risks" items={plan.risks} />
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {plan.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a
                        className="text-rf-violetSoft"
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {citation.title}
                      </a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {literature ? (
          <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">Literature review</h2>
              <p className="mt-1">{literature.relationToSourcePaper}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Positioning</h3>
              <p className="mt-1">{literature.positioning}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Related work</h3>
              <ul className="mt-1 grid gap-2">
                {literature.relatedWorks.map((work, index) => (
                  <li key={`${work.title}-${index}`}>
                    <span className="text-rf-white">{work.title}</span> — {work.summary}{" "}
                    <span className="text-rf-muted">({work.relationToProposed})</span>
                  </li>
                ))}
              </ul>
            </div>
            <PlanList title="Themes" items={literature.themes} />
            <PlanList title="Gaps" items={literature.gaps} />
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {literature.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a className="text-rf-violetSoft" href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {experiment ? (
          <section className="mt-4 grid gap-4 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            <div>
              <h2 className="text-lg font-semibold text-rf-white">Experiment</h2>
              <p className="mt-1">
                <StatusBadge status={experiment.verdict} /> {experiment.summary}
              </p>
              <p className="mt-1">{experiment.relationToSourcePaper}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Implementation</h3>
              <p className="mt-1">{experiment.implementationSummary}</p>
              <p className="mt-1 text-rf-muted">Environment: {experiment.environment}</p>
            </div>
            <div>
              <h3 className="font-semibold text-rf-white">Hypothesis outcomes</h3>
              <ul className="mt-1 grid gap-2">
                {experiment.hypothesisOutcomes.map((outcome, index) => (
                  <li key={`${outcome.hypothesis}-${index}`}>
                    <span className="text-rf-white">{outcome.hypothesis}</span> —{" "}
                    <span className="uppercase">{outcome.outcome}</span>: {outcome.evidence}
                  </li>
                ))}
              </ul>
            </div>
            {experiment.metrics.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Metrics</h3>
                <ul className="mt-1 grid gap-1">
                  {experiment.metrics.map((metric, index) => (
                    <li key={`${metric.name}-${index}`}>
                      <span className="text-rf-white">{metric.name}</span>: {metric.value}
                      {metric.unit ? ` ${metric.unit}` : ""}
                      {metric.baseline ? ` (baseline ${metric.baseline})` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <PlanList title="Findings" items={experiment.findings} />
            <PlanList title="Limitations" items={experiment.limitations} />
            <PlanList title="Reproduction steps" items={experiment.reproductionSteps} ordered />
            {experiment.artifacts.length > 0 ? (
              <div>
                <h3 className="font-semibold text-rf-white">Artifacts</h3>
                <ul className="mt-1 grid gap-1">
                  {experiment.artifacts.map((artifact, index) => (
                    <li key={`${artifact.path}-${index}`}>
                      <span className="text-rf-white">{artifact.path}</span>
                      {artifact.description ? ` — ${artifact.description}` : ""}{" "}
                      <span className="text-rf-muted">({artifact.bytes} bytes)</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div>
              <h3 className="font-semibold text-rf-white">Citations</h3>
              <ul className="mt-1 grid gap-1">
                {experiment.citations.map((citation, index) => (
                  <li key={`${citation.title}-${index}`}>
                    {citation.url ? (
                      <a className="text-rf-violetSoft" href={citation.url} target="_blank" rel="noreferrer">{citation.title}</a>
                    ) : (
                      <span className="text-rf-white">{citation.title}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        {!plan && !literature && !experiment ? (
          <section className="rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            {project.status === "failed"
              ? `Stage failed${jobByStage.get(project.currentStage)?.errorMessage ? `: ${jobByStage.get(project.currentStage)?.errorMessage}` : "."}`
              : project.status === "aborted"
                ? "This project was aborted."
                : "Work is in progress. Refresh shortly."}
          </section>
        ) : null}
      </div>
    </PageShell>
  );
}

function PlanList({
  title,
  items,
  ordered = false
}: {
  title: string;
  items: string[];
  ordered?: boolean;
}) {
  if (items.length === 0) return null;
  const List = ordered ? "ol" : "ul";
  return (
    <div>
      <h3 className="font-semibold text-rf-white">{title}</h3>
      <List className={`mt-1 grid gap-1 ${ordered ? "list-decimal pl-5" : ""}`}>
        {items.map((item, index) => (
          <li key={`${title}-${index}`}>{item}</li>
        ))}
      </List>
    </div>
  );
}
