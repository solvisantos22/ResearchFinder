"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { createViabilityJobForCurrentUser } from "@/lib/dispatch/service";

function requireFormString(formData: FormData, name: string) {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing ${name}`);
  }

  return value.trim();
}

export async function startDispatch(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const ideaId = requireFormString(formData, "ideaId");
  const sprintDepth = requireFormString(formData, "sprintDepth");
  const autonomyLevel = requireFormString(formData, "autonomyLevel");

  const job = await createViabilityJobForCurrentUser({
    currentUserId: currentUser.id,
    ideaId,
    sprintDepth,
    autonomyLevel
  });

  redirect(`/jobs/${job.id}` as Route);
}
