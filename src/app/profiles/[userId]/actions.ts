"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";

import { canEditProfile } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { isFieldPresetKey } from "@/lib/profiles/field-presets";
import { updateOwnProfile } from "@/lib/profiles/service";

const PROFILE_LIMITS = {
  normalDailyRuntimeMin: { label: "Normal daily runtime", min: 1, max: 240 },
  maxDailyRuntimeMin: { label: "Max daily runtime", min: 1, max: 480 },
  maxPapersScreened: { label: "Max papers screened", min: 1, max: 200 },
  maxPapersDeepRead: { label: "Max papers deep read", min: 1, max: 50 }
} as const;

function parseList(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return [];

  const trimmed = value.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean);
      }
    } catch {
      return [];
    }
  }

  return trimmed
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRequiredStringField(value: FormDataEntryValue | null, label: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }

  return trimmed;
}

function parseBoundedIntField(
  value: FormDataEntryValue | null,
  field: (typeof PROFILE_LIMITS)[keyof typeof PROFILE_LIMITS]
) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const parsed = Number.parseInt(trimmed, 10);
  const isIntegerString = /^\d+$/.test(trimmed);

  if (!isIntegerString || parsed < field.min || parsed > field.max) {
    throw new Error(`${field.label} must be between ${field.min} and ${field.max}`);
  }

  return parsed;
}

export async function saveProfile(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const targetUserId = String(formData.get("userId") || "");

  if (!targetUserId || !canEditProfile({ currentUserId: currentUser.id, targetUserId })) {
    notFound();
  }

  const submittedPreset = String(formData.get("fieldPresetKey") || "");
  const arxivQuery = parseRequiredStringField(formData.get("arxivQuery"), "arXiv query");
  const normalDailyRuntimeMin = parseBoundedIntField(
    formData.get("normalDailyRuntimeMin"),
    PROFILE_LIMITS.normalDailyRuntimeMin
  );
  const maxDailyRuntimeMin = parseBoundedIntField(
    formData.get("maxDailyRuntimeMin"),
    PROFILE_LIMITS.maxDailyRuntimeMin
  );
  const maxPapersScreened = parseBoundedIntField(
    formData.get("maxPapersScreened"),
    PROFILE_LIMITS.maxPapersScreened
  );
  const maxPapersDeepRead = parseBoundedIntField(
    formData.get("maxPapersDeepRead"),
    PROFILE_LIMITS.maxPapersDeepRead
  );

  if (maxDailyRuntimeMin < normalDailyRuntimeMin) {
    throw new Error("Max daily runtime must be at least normal daily runtime");
  }

  if (maxPapersDeepRead > maxPapersScreened) {
    throw new Error("Max papers deep read must be no more than max papers screened");
  }

  await updateOwnProfile({
    currentUserId: currentUser.id,
    targetUserId,
    fieldPresetKey: isFieldPresetKey(submittedPreset) ? submittedPreset : "ai_ml",
    keywords: parseList(formData.get("keywords")),
    interests: parseList(formData.get("interests")),
    preferredOutputs: parseList(formData.get("preferredOutputs")),
    constraints: parseList(formData.get("constraints")),
    arxivQuery,
    normalDailyRuntimeMin,
    maxDailyRuntimeMin,
    maxPapersScreened,
    maxPapersDeepRead,
    allowPdfFetch: formData.get("allowPdfFetch") === "on",
    allowRelatedWorkSearch: formData.get("allowRelatedWorkSearch") === "on"
  });

  revalidatePath(`/profiles/${targetUserId}`);
  redirect(`/profiles/${targetUserId}` as Route);
}
