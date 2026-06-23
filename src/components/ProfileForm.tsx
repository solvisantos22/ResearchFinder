import React from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";
import type { EditableProfileData } from "@/lib/profiles/service";

type ProfileFormProps = {
  profile: EditableProfileData;
  saveAction: (formData: FormData) => void | Promise<void>;
};

function lines(values: string[]) {
  return values.join("\n");
}

export function ProfileForm({ profile, saveAction }: ProfileFormProps) {
  return (
    <form action={saveAction} className="grid gap-5 rounded-lg border border-line bg-white p-5">
      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Field preset
        <select
          name="fieldPresetKey"
          defaultValue={profile.fieldPresetKey}
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
        >
          {(Object.entries(fieldPresets) as [FieldPresetKey, (typeof fieldPresets)[FieldPresetKey]][]).map(([key, preset]) => (
            <option key={key} value={key}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>

      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Keywords
        <textarea
          name="keywords"
          defaultValue={lines(profile.keywords)}
          rows={5}
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Preferred outputs
        <textarea
          name="preferredOutputs"
          defaultValue={lines(profile.preferredOutputs)}
          rows={4}
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-slate-700">
        Constraints
        <textarea
          name="constraints"
          defaultValue={lines(profile.constraints)}
          rows={4}
          className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
        />
      </label>

      <label className="grid gap-2 text-sm font-medium text-slate-700">
        arXiv query
        <textarea
          name="arxivQuery"
          defaultValue={profile.arxivQuery}
          rows={4}
          className="rounded-md border border-slate-300 px-3 py-2 font-mono text-sm text-slate-950"
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Normal daily runtime minutes
          <input
            name="normalDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.normalDailyRuntimeMin}
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Maximum daily runtime minutes
          <input
            name="maxDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.maxDailyRuntimeMin}
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Maximum papers screened
          <input
            name="maxPapersScreened"
            type="number"
            min={0}
            defaultValue={profile.maxPapersScreened}
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
          />
        </label>
        <label className="grid gap-2 text-sm font-medium text-slate-700">
          Maximum papers deep read
          <input
            name="maxPapersDeepRead"
            type="number"
            min={0}
            defaultValue={profile.maxPapersDeepRead}
            className="rounded-md border border-slate-300 px-3 py-2 text-slate-950"
          />
        </label>
      </div>

      <div className="grid gap-3">
        <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
          <input name="allowPdfFetch" type="checkbox" defaultChecked={profile.allowPdfFetch} />
          Allow PDF fetch
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-slate-700">
          <input
            name="allowRelatedWorkSearch"
            type="checkbox"
            defaultChecked={profile.allowRelatedWorkSearch}
          />
          Allow related-work search
        </label>
      </div>

      <button
        type="submit"
        className="w-fit rounded-md bg-slate-950 px-4 py-2 text-sm font-semibold text-white"
      >
        Save profile
      </button>
    </form>
  );
}
