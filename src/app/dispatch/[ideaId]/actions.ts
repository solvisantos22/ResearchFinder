"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { requireCurrentUser } from "@/lib/auth/session";
import { createViabilityJobForCurrentUser } from "@/lib/dispatch/service";

export async function startDispatch(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const ideaId = String(formData.get("ideaId"));
  const sprintDepth = String(formData.get("sprintDepth"));
  const autonomyLevel = String(formData.get("autonomyLevel"));

  const job = await createViabilityJobForCurrentUser({
    currentUserId: currentUser.id,
    ideaId,
    sprintDepth,
    autonomyLevel
  });

  redirect(`/jobs/${job.id}` as Route);
}
