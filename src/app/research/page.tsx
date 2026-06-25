import React from "react";
import Link from "next/link";
import type { Route } from "next";

import { PageShell } from "@/components/PageShell";
import { requireCurrentUser } from "@/lib/auth/session";
import { listResearchProjectsForUser } from "@/lib/jobs/research";

export default async function ResearchListPage() {
  const currentUser = await requireCurrentUser();
  const projects = await listResearchProjectsForUser(currentUser.id);

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="research"
    >
      <div className="mx-auto max-w-5xl px-6 py-8">
        <h1 className="text-3xl font-semibold text-rf-white">Research projects</h1>
        <div className="mt-6 grid gap-2">
          {projects.length === 0 ? (
            <p className="text-sm text-rf-muted">
              No research projects yet. Use &ldquo;Develop this&rdquo; on an idea to start one.
            </p>
          ) : (
            projects.map((project) => (
              <Link
                key={project.id}
                href={`/research/${project.id}` as Route}
                className="flex items-center justify-between rounded-md border border-rf-border bg-rf-panel px-4 py-3 text-sm text-rf-white hover:bg-rf-surface"
              >
                <span>{project.generatedIdea.title}</span>
                <span className="text-rf-muted">
                  {project.currentStage} · {project.status.replaceAll("_", " ")}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>
    </PageShell>
  );
}
