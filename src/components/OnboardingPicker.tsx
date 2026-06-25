import React from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";

type OnboardingPickerProps = {
  chooseAction: (formData: FormData) => void | Promise<void>;
};

export function OnboardingPicker({ chooseAction }: OnboardingPickerProps) {
  const presets = Object.entries(fieldPresets) as [
    FieldPresetKey,
    (typeof fieldPresets)[FieldPresetKey]
  ][];

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-rf-muted">Research Finder</p>
        <h1 className="mt-1 text-3xl font-semibold text-rf-white">Choose your research field</h1>
        <p className="mt-2 text-rf-muted">
          This sets your default arXiv categories and keywords. You can fine-tune everything later in
          your profile.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        {presets.map(([key, preset]) => (
          <form action={chooseAction} key={key}>
            <input type="hidden" name="fieldPresetKey" value={key} />
            <button
              type="submit"
              className="w-full rounded-md border border-rf-border bg-rf-panel p-5 text-left transition-colors hover:border-rf-violetSoft hover:bg-rf-surface"
            >
              <span className="block text-lg font-semibold text-rf-white">{preset.label}</span>
              <span className="mt-2 block text-sm text-rf-muted">
                {preset.categories.join(", ")}
              </span>
            </button>
          </form>
        ))}
      </div>
    </div>
  );
}
