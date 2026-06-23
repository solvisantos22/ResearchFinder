import { prisma } from "@/lib/db";
import {
  buildPresetProfileData,
  type FieldPresetKey
} from "@/lib/profiles/field-presets";

export async function ensureProfileForUser(userId: string, presetKey: FieldPresetKey) {
  return prisma.researchProfile.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      ...buildPresetProfileData(presetKey)
    }
  });
}

export async function updateOwnProfile(input: {
  currentUserId: string;
  targetUserId: string;
  arxivQuery: string;
  keywords: string[];
  constraints: string[];
  preferredOutputs: string[];
}) {
  if (input.currentUserId !== input.targetUserId) {
    throw new Error("Cannot edit another user's profile");
  }

  const keywordsJson = JSON.stringify(input.keywords);

  return prisma.researchProfile.update({
    where: { userId: input.targetUserId },
    data: {
      arxivQuery: input.arxivQuery,
      keywordsJson,
      interestsJson: keywordsJson,
      constraintsJson: JSON.stringify(input.constraints),
      preferredOutputsJson: JSON.stringify(input.preferredOutputs)
    }
  });
}
