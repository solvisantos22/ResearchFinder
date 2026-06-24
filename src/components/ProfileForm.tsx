import React from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";
import type { EditableProfileData } from "@/lib/profiles/service";

type ProfileFormProps = {
  profile: EditableProfileData;
  saveAction: (formData: FormData) => void | Promise<void>;
};

type ProfileReadOnlyProps = {
  profile: EditableProfileData;
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

function ListValue({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <p className="text-slate-500">None configured</p>;
  }

  return (
    <ul className="grid gap-1">
      {values.map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}

export function ProfileReadOnly({ profile }: ProfileReadOnlyProps) {
  return (
    <section className="grid gap-5 rounded-lg border border-line bg-white p-5 text-sm text-slate-700">
      <div>
        <h2 className="font-semibold text-slate-900">Field preset</h2>
        <p className="mt-1">{fieldPresets[profile.fieldPresetKey].label}</p>
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">Keywords</h2>
        <div className="mt-1">
          <ListValue values={profile.keywords} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">Preferred outputs</h2>
        <div className="mt-1">
          <ListValue values={profile.preferredOutputs} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">Constraints</h2>
        <div className="mt-1">
          <ListValue values={profile.constraints} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-slate-900">arXiv query</h2>
        <p className="mt-1 whitespace-pre-wrap font-mono text-slate-950">{profile.arxivQuery}</p>
      </div>
      <dl className="grid gap-4 md:grid-cols-2">
        <div>
          <dt className="font-semibold text-slate-900">Normal daily runtime minutes</dt>
          <dd className="mt-1">{profile.normalDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">Maximum daily runtime minutes</dt>
          <dd className="mt-1">{profile.maxDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">Maximum papers screened</dt>
          <dd className="mt-1">{profile.maxPapersScreened}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">Maximum papers deep read</dt>
          <dd className="mt-1">{profile.maxPapersDeepRead}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">PDF fetch</dt>
          <dd className="mt-1">{profile.allowPdfFetch ? "Allowed" : "Disabled"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-900">Related-work search</dt>
          <dd className="mt-1">{profile.allowRelatedWorkSearch ? "Allowed" : "Disabled"}</dd>
        </div>
      </dl>
    </section>
  );
}
