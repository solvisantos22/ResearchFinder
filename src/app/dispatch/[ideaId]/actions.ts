"use server";

import { redirect } from "next/navigation";
import type { Route } from "next";

import { createViabilityJob } from "@/lib/dispatch/service";

export async function startDispatch(formData: FormData) {
  const userId = String(formData.get("userId"));
  const ideaId = String(formData.get("ideaId"));
  const sprintDepth = String(formData.get("sprintDepth"));
  const autonomyLevel = String(formData.get("autonomyLevel"));

  const job = await createViabilityJob({
    userId,
    ideaId,
    sprintDepth,
    autonomyLevel
  });

  redirect(`/jobs/${job.id}` as Route);
}
