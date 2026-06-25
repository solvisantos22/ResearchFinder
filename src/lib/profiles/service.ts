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

export type ProfileUpdateData = {
  fieldPresetKey?: FieldPresetKey;
  keywords: string[];
  interests?: string[];
  preferredOutputs: string[];
  constraints: string[];
  arxivQuery: string;
  normalDailyRuntimeMin?: number;
  maxDailyRuntimeMin?: number;
  maxPapersScreened?: number;
  maxPapersDeepRead?: number;
  allowPdfFetch?: boolean;
  allowRelatedWorkSearch?: boolean;
};

function parseJsonList(value: string | null | undefined): string[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function toEditableProfile(profile: ResearchProfile): EditableProfileData {
  const keywords = parseJsonList(profile.keywordsJson);
  const interests = parseJsonList(profile.interestsJson);

  return {
    fieldPresetKey: isFieldPresetKey(profile.fieldPresetKey) ? profile.fieldPresetKey : "ai_ml",
    keywords: keywords.length > 0 ? keywords : interests,
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
} & ProfileUpdateData) {
  if (input.currentUserId !== input.targetUserId) {
    throw new Error("Cannot edit another user's profile");
  }

  return prisma.researchProfile.update({
    where: { userId: input.targetUserId },
    data: {
      arxivQuery: input.arxivQuery,
      keywordsJson: JSON.stringify(input.keywords),
      interestsJson: JSON.stringify(
        input.interests && input.interests.length > 0 ? input.interests : input.keywords
      ),
      constraintsJson: JSON.stringify(input.constraints),
      preferredOutputsJson: JSON.stringify(input.preferredOutputs),
      ...(input.fieldPresetKey !== undefined ? { fieldPresetKey: input.fieldPresetKey } : {}),
      ...(input.normalDailyRuntimeMin !== undefined
        ? { normalDailyRuntimeMin: input.normalDailyRuntimeMin }
        : {}),
      ...(input.maxDailyRuntimeMin !== undefined
        ? { maxDailyRuntimeMin: input.maxDailyRuntimeMin }
        : {}),
      ...(input.maxPapersScreened !== undefined
        ? { maxPapersScreened: input.maxPapersScreened }
        : {}),
      ...(input.maxPapersDeepRead !== undefined
        ? { maxPapersDeepRead: input.maxPapersDeepRead }
        : {}),
      ...(input.allowPdfFetch !== undefined ? { allowPdfFetch: input.allowPdfFetch } : {}),
      ...(input.allowRelatedWorkSearch !== undefined
        ? { allowRelatedWorkSearch: input.allowRelatedWorkSearch }
        : {})
    }
  });
}
