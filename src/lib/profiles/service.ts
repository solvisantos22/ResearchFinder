import type { ResearchProfile } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  buildPresetProfileData,
  isFieldPresetKey,
  type FieldPresetKey
} from "@/lib/profiles/field-presets";

export type EditableProfileData = {
  fieldPresetKey: FieldPresetKey;
  keywords: string[];
  preferredOutputs: string[];
  constraints: string[];
  arxivQuery: string;
  normalDailyRuntimeMin: number;
  maxDailyRuntimeMin: number;
  maxPapersScreened: number;
  maxPapersDeepRead: number;
  allowPdfFetch: boolean;
  allowRelatedWorkSearch: boolean;
};

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function toEditableProfile(profile: ResearchProfile): EditableProfileData {
  return {
    fieldPresetKey: isFieldPresetKey(profile.fieldPresetKey) ? profile.fieldPresetKey : "ai_ml",
    keywords: parseJsonList(profile.keywordsJson || profile.interestsJson),
    preferredOutputs: parseJsonList(profile.preferredOutputsJson),
    constraints: parseJsonList(profile.constraintsJson),
    arxivQuery: profile.arxivQuery,
    normalDailyRuntimeMin: profile.normalDailyRuntimeMin,
    maxDailyRuntimeMin: profile.maxDailyRuntimeMin,
    maxPapersScreened: profile.maxPapersScreened,
    maxPapersDeepRead: profile.maxPapersDeepRead,
    allowPdfFetch: profile.allowPdfFetch,
    allowRelatedWorkSearch: profile.allowRelatedWorkSearch
  };
}

export async function ensureProfileForUser(userId: string, presetKey: FieldPresetKey) {
  const existing = await prisma.researchProfile.findUnique({ where: { userId } });
  if (existing) return existing;

  return prisma.researchProfile.create({
    data: {
      userId,
      ...buildPresetProfileData(presetKey)
    }
  });
}

export async function updateOwnProfile(input: {
  currentUserId: string;
  targetUserId: string;
} & EditableProfileData) {
  if (input.currentUserId !== input.targetUserId) {
    throw new Error("Cannot edit another user's profile");
  }

  return prisma.researchProfile.update({
    where: { userId: input.targetUserId },
    data: {
      fieldPresetKey: input.fieldPresetKey,
      arxivQuery: input.arxivQuery,
      keywordsJson: JSON.stringify(input.keywords),
      interestsJson: JSON.stringify(input.keywords),
      constraintsJson: JSON.stringify(input.constraints),
      preferredOutputsJson: JSON.stringify(input.preferredOutputs),
      normalDailyRuntimeMin: input.normalDailyRuntimeMin,
      maxDailyRuntimeMin: input.maxDailyRuntimeMin,
      maxPapersScreened: input.maxPapersScreened,
      maxPapersDeepRead: input.maxPapersDeepRead,
      allowPdfFetch: input.allowPdfFetch,
      allowRelatedWorkSearch: input.allowRelatedWorkSearch
    }
  });
}
