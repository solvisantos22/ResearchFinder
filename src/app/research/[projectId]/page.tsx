import React from "react";
import { notFound } from "next/navigation";

import { PageShell } from "@/components/PageShell";
import { requireCurrentUser } from "@/lib/auth/session";
import { abortResearchProjectAction } from "@/app/research/actions";
import { getResearchProjectDetail } from "@/lib/jobs/research";
import { ResearchPlanSchema } from "@/lib/v2/schemas";

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

  const parsedPlan = project.plan
    ? ResearchPlanSchema.safeParse(JSON.parse(project.plan.planJson))
    : null;
  const plan = parsedPlan && parsedPlan.success ? parsedPlan.data : null;

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
        ) : (
          <section className="rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
            {project.status === "failed"
              ? `Plan generation failed${project.planJob?.errorMessage ? `: ${project.planJob.errorMessage}` : "."}`
              : project.status === "aborted"
                ? "This project was aborted."
                : "The plan is being generated. Refresh shortly."}
          </section>
        )}
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
