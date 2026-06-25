"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { abortResearchProject, developIdea } from "@/lib/jobs/research";

function requireFormString(formData: FormData, name: string) {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }
  return value.trim();
}

export async function developIdeaAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const generatedIdeaId = requireFormString(formData, "generatedIdeaId");
  const project = await developIdea({ currentUserId: currentUser.id, generatedIdeaId });
  redirect(`/research/${project.id}` as Route);
}

export async function abortResearchProjectAction(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const researchProjectId = requireFormString(formData, "researchProjectId");
  await abortResearchProject({ currentUserId: currentUser.id, researchProjectId });
  redirect(`/research/${researchProjectId}` as Route);
}
