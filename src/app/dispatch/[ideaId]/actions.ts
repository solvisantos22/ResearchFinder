"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { createViabilityJobForCurrentUser } from "@/lib/dispatch/service";
import { createV2ViabilityJob } from "@/lib/jobs/viability";

function requireFormString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }

  return value.trim();
}

export async function startDispatch(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const generatedIdeaId = optionalFormString(formData, "generatedIdeaId");
  const ideaId = optionalFormString(formData, "ideaId");
  const sprintDepth = requireFormString(formData, "sprintDepth");
  const autonomyLevel = requireFormString(formData, "autonomyLevel");

  const job = generatedIdeaId
    ? await createV2ViabilityJob({
        currentUserId: currentUser.id,
        generatedIdeaId,
        sprintDepth,
        autonomyLevel
      })
    : await createViabilityJobForCurrentUser({
        currentUserId: currentUser.id,
        ideaId: ideaId ?? requireFormString(formData, "ideaId"),
        sprintDepth,
        autonomyLevel
      });

  redirect(`/jobs/${job.id}` as Route);
}

function optionalFormString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  return value.trim();
}
