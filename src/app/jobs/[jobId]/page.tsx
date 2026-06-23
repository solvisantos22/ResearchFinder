import React from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignalPanel, type SignalStatus } from "@/components/SignalPanel";
import { canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ViabilityResultSchema, type ViabilityResult } from "@/lib/v2/schemas";

type SignalPanelData = {
  title: string;
  status: SignalStatus;
  summary: string;
  evidence: string;
};

const signalTitles = ["Prototype signal", "Research signal", "Novelty signal"] as const;
const verdictLabels: Record<string, string> = {
  expand: "Expand",
  needs_novelty_check: "Needs novelty check",
  revise: "Revise",
  reject: "Reject"
};

function formatViabilityVerdict(verdict: string | null): string {
  if (!verdict) return "No verdict";
  return verdictLabels[verdict] ?? verdict;
}

function statusFromText(value: string): SignalStatus {
  const normalized = value.toLowerCase();

  if (normalized === "pass" || normalized === "warning" || normalized === "fail") {
    return normalized;
  }

  return "warning";
}

function extractSection(content: string, heading: string): string {
  const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingPattern = new RegExp(`^#{1,6}\\s+${escapedHeading}\\s*$`, "i");
  const lines = content.split(/\r?\n/);
  const sectionStart = lines.findIndex((line) => headingPattern.test(line.trim()));

  if (sectionStart === -1) {
    return "";
  }

  const sectionLines = [];

  for (const line of lines.slice(sectionStart + 1)) {
    if (/^#{1,6}\s+/.test(line.trim())) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines.join("\n").trim();
}

function deriveSignalPanel(content: string, title: (typeof signalTitles)[number]): SignalPanelData {
  const section = extractSection(content, title);
  const lines = section
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const statusLine = lines[0] ?? "";
  const statusMatch = statusLine.match(/^(pass|warning|fail)\s*:\s*(.*)$/i);
  const evidenceLines = lines
    .slice(statusMatch ? 1 : 0)
    .map((line) => line.replace(/^[-*]\s+/, ""))
    .filter(Boolean);

  return {
    title,
    status: statusFromText(statusMatch?.[1] ?? "warning"),
    summary: statusMatch?.[2] || "No signal summary was generated.",
    evidence: evidenceLines.join("\n") || "No supporting evidence was generated."
  };
}

function deriveSignalPanels(content: string): SignalPanelData[] {
  return signalTitles.map((title) => deriveSignalPanel(content, title));
}

function parseViabilityReport(content: string): ViabilityResult | null {
  try {
    const parsed = ViabilityResultSchema.safeParse(JSON.parse(content));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export default async function JobPage({ params }: { params: Promise<{ jobId: string }> }) {
  const currentUser = await requireCurrentUser();
  const { jobId } = await params;
  const job = await prisma.viabilityJob.findUnique({
    where: { id: jobId },
    include: {
      idea: {
        include: {
          paper: true
        }
      },
      generatedIdea: {
        include: {
          paper: true
        }
      },
      artifacts: {
        orderBy: { createdAt: "asc" }
      },
      evidence: {
        orderBy: { createdAt: "asc" }
      }
    }
  });

  // Job pages are read-only in this milestone, so shared research visibility applies here.
  if (
    !job ||
    !canViewUserResearch({ currentUserId: currentUser.id, targetUserId: job.userId })
  ) {
    notFound();
  }

  const sourceIdea = job.generatedIdea ?? job.idea;

  if (!sourceIdea) {
    notFound();
  }

  const v2Report =
    job.artifacts
      .filter((artifact) => artifact.kind === "viability-report")
      .map((artifact) => parseViabilityReport(artifact.content))
      .find((report): report is ViabilityResult => report !== null) ?? null;
  const decisionArtifact = job.artifacts.find((artifact) => artifact.kind === "decision-report");
  const signalPanels = decisionArtifact ? deriveSignalPanels(decisionArtifact.content) : [];
  const inboxHref = `/inbox/${job.userId}` as Route;
  const verdictLabel = formatViabilityVerdict(v2Report?.verdict ?? job.verdict);

  return (
    <main className="min-h-screen bg-paper text-ink [color-scheme:light]">
      <div className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Viability decision
        </p>
        <h1 className="break-words text-3xl font-semibold text-slate-900 [overflow-wrap:anywhere]">
          {sourceIdea.title}
        </h1>
        <p className="mt-2 break-words text-slate-600">Status: {job.status}</p>
      </header>

      {job.status !== "completed" ? (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
          <h2 className="text-xl font-semibold">Sprint is not complete</h2>
          <p className="mt-2 text-sm leading-6">
            Run <code>npm run worker:once</code> to process the queued viability sprint, then
            return here to review the generated decision.
          </p>
        </section>
      ) : (
        <div className="grid gap-6">
          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <h2 className="break-words text-xl font-semibold text-slate-900">
              Verdict: {verdictLabel}
            </h2>
            <p className="mt-2 break-words text-slate-600">
              {v2Report?.summary ??
                "Review the generated evidence before expanding this idea into a full agent team."}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(verdictLabels).map(([value, label]) => (
                <span
                  key={value}
                  className={
                    value === (v2Report?.verdict ?? job.verdict)
                      ? "rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800"
                      : "rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-600"
                  }
                >
                  {label}
                </span>
              ))}
            </div>
          </section>

          {v2Report ? (
            <section className="rounded-lg border border-slate-200 bg-white p-6">
              <h2 className="text-xl font-semibold text-slate-900">Viability report</h2>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                {[
                  ["Feasibility", v2Report.feasibility],
                  ["Novelty risk", v2Report.noveltyRisk],
                  ["Minimum experiment", v2Report.minimumExperiment]
                ].map(([label, value]) => (
                  <article key={label} className="min-w-0 rounded-lg border border-slate-200 p-4">
                    <h3 className="break-words text-sm font-semibold uppercase tracking-wide text-slate-500">
                      {label}
                    </h3>
                    <p className="mt-2 break-words text-sm leading-6 text-slate-700">{value}</p>
                  </article>
                ))}
              </div>

              {v2Report.blockers.length > 0 ? (
                <div className="mt-5">
                  <h3 className="font-semibold text-slate-900">Blockers</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700">
                    {v2Report.blockers.map((blocker) => (
                      <li key={blocker} className="break-words">
                        {blocker}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-5">
                <h3 className="font-semibold text-slate-900">Citations used</h3>
                <div className="mt-2 grid gap-3">
                  {v2Report.citations.map((citation) => (
                    <article
                      key={`${citation.sourceType}-${citation.title}-${citation.claim}`}
                      className="min-w-0 rounded-lg border border-slate-200 p-4"
                    >
                      <h4 className="break-words text-sm font-semibold text-slate-900">
                        {citation.title}
                      </h4>
                      <p className="mt-2 break-words text-sm leading-6 text-slate-700">
                        {citation.claim}
                      </p>
                      <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Confidence {citation.confidence.toFixed(2)}
                      </p>
                      {citation.url ? (
                        <a
                          className="mt-3 inline-flex break-words text-sm font-medium text-slate-700 underline [overflow-wrap:anywhere]"
                          href={citation.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          View source
                        </a>
                      ) : null}
                    </article>
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {signalPanels.length > 0 ? (
            <div className="grid gap-4 lg:grid-cols-3">
              {signalPanels.map((panel) => (
                <SignalPanel
                  key={panel.title}
                  title={panel.title}
                  status={panel.status}
                  summary={panel.summary}
                  evidence={panel.evidence}
                />
              ))}
            </div>
          ) : null}

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Artifacts</h2>
            <div className="mt-3 grid gap-4">
              {job.artifacts.map((artifact) => (
                <article
                  key={artifact.id}
                  className="min-w-0 rounded-lg border border-slate-200 bg-white p-5"
                >
                  <h3 className="break-words font-semibold text-slate-900 [overflow-wrap:anywhere]">
                    {artifact.title}
                  </h3>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-slate-50 p-4 text-sm leading-6 text-slate-700 [overflow-wrap:anywhere]">
                    {artifact.content}
                  </pre>
                </article>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-semibold text-slate-900">Generated evidence</h2>
            <div className="mt-3 grid gap-4">
              {job.evidence.map((item) => (
                <article
                  key={item.id}
                  className="min-w-0 rounded-lg border border-slate-200 bg-white p-5"
                >
                  <h3 className="break-words font-semibold text-slate-900 [overflow-wrap:anywhere]">
                    {item.sourceTitle}
                  </h3>
                  <p className="mt-2 break-words text-sm text-slate-700 [overflow-wrap:anywhere]">
                    {item.claim}
                  </p>
                  <p className="mt-2 break-words text-sm text-slate-600 [overflow-wrap:anywhere]">
                    {item.support}
                  </p>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Confidence {item.confidence.toFixed(2)}
                  </p>
                  {item.sourceUrl ? (
                    <a
                      className="mt-3 inline-flex break-words text-sm font-medium text-slate-700 underline [overflow-wrap:anywhere]"
                      href={item.sourceUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      View source
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-6">
            <div className="flex flex-wrap gap-3">
              {["Expand to full agent team", "Revise idea", "Save for later", "Discard"].map(
                (label) => (
                  <button
                    key={label}
                    className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled
                    type="button"
                  >
                    {label}
                  </button>
                )
              )}
            </div>
            <p className="mt-3 break-words text-sm text-slate-600">
              These actions are display-only in this milestone except viewing generated evidence.
            </p>
          </section>
        </div>
      )}

      <Link className="mt-8 inline-flex text-sm font-medium text-slate-700 underline" href={inboxHref}>
        Back to inbox
      </Link>
      </div>
    </main>
  );
}
