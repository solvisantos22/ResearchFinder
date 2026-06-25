"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { requireCurrentUser } from "@/lib/auth/session";
import { ensureProfileForUser } from "@/lib/profiles/service";
import { isFieldPresetKey } from "@/lib/profiles/field-presets";

export async function chooseField(formData: FormData) {
  const currentUser = await requireCurrentUser();
  const submitted = String(formData.get("fieldPresetKey") || "");
  const presetKey = isFieldPresetKey(submitted) ? submitted : "ai_ml";

  await ensureProfileForUser(currentUser.id, presetKey);
  redirect(`/inbox/${currentUser.id}` as Route);
}
