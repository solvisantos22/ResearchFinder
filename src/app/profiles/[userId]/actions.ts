"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import type { Route } from "next";

import { canEditProfile } from "@/lib/auth/permissions";
import { requireCurrentUser } from "@/lib/auth/session";
import { isFieldPresetKey } from "@/lib/profiles/field-presets";
import { updateOwnProfile } from "@/lib/profiles/service";

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

function parseIntField(value: FormDataEntryValue | null) {
  const parsed = Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function saveProfile(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const targetUserId = String(formData.get("userId") || "");

  if (!targetUserId || !canEditProfile({ currentUserId: currentUser.id, targetUserId })) {
    notFound();
  }

  const submittedPreset = String(formData.get("fieldPresetKey") || "");

  await updateOwnProfile({
    currentUserId: currentUser.id,
    targetUserId,
    fieldPresetKey: isFieldPresetKey(submittedPreset) ? submittedPreset : "ai_ml",
    keywords: parseList(formData.get("keywords")),
    preferredOutputs: parseList(formData.get("preferredOutputs")),
    constraints: parseList(formData.get("constraints")),
    arxivQuery: String(formData.get("arxivQuery") || ""),
    normalDailyRuntimeMin: parseIntField(formData.get("normalDailyRuntimeMin")),
    maxDailyRuntimeMin: parseIntField(formData.get("maxDailyRuntimeMin")),
    maxPapersScreened: parseIntField(formData.get("maxPapersScreened")),
    maxPapersDeepRead: parseIntField(formData.get("maxPapersDeepRead")),
    allowPdfFetch: formData.get("allowPdfFetch") === "on",
    allowRelatedWorkSearch: formData.get("allowRelatedWorkSearch") === "on"
  });

  revalidatePath(`/profiles/${targetUserId}`);
  redirect(`/profiles/${targetUserId}` as Route);
}
