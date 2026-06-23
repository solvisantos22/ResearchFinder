"use server";

import { notFound, redirect } from "next/navigation";
import type { Route } from "next";

import { createViabilityJob } from "@/lib/dispatch/service";
import { getRequestUserIdForPrivateAccess } from "@/lib/private-access-server";

export async function startDispatch(formData: FormData) {
  const submittedUserId = formData.get("userId");
  const userId = await getRequestUserIdForPrivateAccess(
    typeof submittedUserId === "string" ? submittedUserId : null
  );
  const ideaId = String(formData.get("ideaId"));
  const sprintDepth = String(formData.get("sprintDepth"));
  const autonomyLevel = String(formData.get("autonomyLevel"));

  if (!userId) {
    notFound();
  }

  const job = await createViabilityJob({
    userId,
    ideaId,
    sprintDepth,
    autonomyLevel
  });

  redirect(`/jobs/${job.id}` as Route);
}
