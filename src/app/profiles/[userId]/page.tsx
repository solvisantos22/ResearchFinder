import React from "react";
import { notFound } from "next/navigation";

import { ProfileForm } from "@/components/ProfileForm";
import { canEditProfile, canViewUserResearch } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/current-user";
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

  const profile = await ensureProfileForUser(userId, "ai_ml");
  const editable = canEditProfile({ currentUserId: currentUser.id, targetUserId: userId });

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500">
          Research profile
        </p>
        <h1 className="text-3xl font-semibold text-slate-900">{targetUser.name}</h1>
        <p className="mt-2 text-slate-600">
          Tune source discovery, runtime limits, and worker research behavior.
        </p>
      </header>

      {editable ? (
        <ProfileForm
          profile={toEditableProfile(profile)}
          saveAction={async (formData) => {
            "use server";
            formData.set("userId", userId);
            await saveProfile(formData);
          }}
        />
      ) : (
        <div className="rounded-lg border border-line bg-white p-5 text-slate-700">
          You can view this profile, but only {targetUser.name} can edit it.
        </div>
      )}
    </div>
  );
}
