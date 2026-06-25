import type { Route } from "next";
import { redirect } from "next/navigation";

import { OnboardingPicker } from "@/components/OnboardingPicker";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";

import { chooseField } from "./actions";

export default async function OnboardingPage() {
  const currentUser = await requireCurrentUser();
  const profile = await prisma.researchProfile.findUnique({ where: { userId: currentUser.id } });

  if (profile) {
    redirect(`/inbox/${currentUser.id}` as Route);
  }

  return <OnboardingPicker chooseAction={chooseField} />;
}
