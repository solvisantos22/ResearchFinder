import React from "react";
import type { Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SignalPanel, type SignalStatus } from "@/components/SignalPanel";
import { canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

type SignalPanelData = {
  title: string;
  status: SignalStatus;
  summary: string;
  evidence: string;
};

const signalTitles = ["Prototype signal", "Research signal", "Novelty signal"] as const;

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

  const decisionArtifact =
    job.artifacts.find((artifact) => artifact.kind === "decision-report") ?? job.artifacts[0];
  const signalPanels = deriveSignalPanels(decisionArtifact?.content ?? "");
  const inboxHref = `/inbox/${job.userId}` as Route;

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
              Verdict: {job.verdict}
            </h2>
            <p className="mt-2 break-words text-slate-600">
              Review the generated evidence before expanding this idea into a full agent team.
            </p>
          </section>

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
