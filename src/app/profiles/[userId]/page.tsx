import React from "react";
import { notFound } from "next/navigation";

import { ProfileForm, ProfileReadOnly } from "@/components/ProfileForm";
import { PageShell } from "@/components/PageShell";
import { canEditProfile, canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ensureProfileForUser, toEditableProfile } from "@/lib/profiles/service";

import { saveProfile } from "./actions";

export default async function ProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  const [{ userId }, currentUser] = await Promise.all([params, requireCurrentUser()]);

  if (!canViewUserResearch({ currentUserId: currentUser.id, targetUserId: userId })) {
    notFound();
  }

  const targetUser = await prisma.user.findUnique({ where: { id: userId } });

  if (!targetUser) {
    notFound();
  }

  const editable = canEditProfile({ currentUserId: currentUser.id, targetUserId: userId });
  const profileRecord = editable
    ? await ensureProfileForUser(userId, "ai_ml")
    : await prisma.researchProfile.findUnique({ where: { userId } });
  const profile = profileRecord ? toEditableProfile(profileRecord) : null;

  return (
    <PageShell
      currentUserId={currentUser.id}
      currentUserName={currentUser.name ?? "Researcher"}
      activeSection="profiles"
    >
      <div className="mx-auto max-w-5xl">
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-wide text-rf-muted">
            Research profile
          </p>
          <h1 className="text-3xl font-semibold text-rf-white">{targetUser.name}</h1>
          <p className="mt-2 text-rf-muted">
            Tune source discovery, runtime limits, and worker research behavior.
          </p>
        </header>

        {editable && profile ? (
          <ProfileForm
            profile={profile}
            saveAction={async (formData) => {
              "use server";
              formData.set("userId", userId);
              await saveProfile(formData);
            }}
          />
        ) : profile ? (
          <ProfileReadOnly profile={profile} />
        ) : (
          <div className="rounded-md border border-rf-border bg-rf-panel p-5 text-rf-muted">
            No research profile has been configured yet.
          </div>
        )}
      </div>
    </PageShell>
  );
}
