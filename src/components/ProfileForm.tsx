"use client";

import React, { useState } from "react";

import { fieldPresets, type FieldPresetKey } from "@/lib/profiles/field-presets";
import type { EditableProfileData } from "@/lib/profiles/service";

type ProfileFormProps = {
  profile: EditableProfileData;
  saveAction: (formData: FormData) => void | Promise<void>;
};

type ProfileReadOnlyProps = {
  profile: EditableProfileData;
};

function lines(values: readonly string[]) {
  return values.join("\n");
}

const labelClass = "grid gap-2 text-sm font-medium text-rf-muted";
const fieldClass =
  "rounded-md border border-rf-border bg-rf-surface px-3 py-2 text-rf-white placeholder:text-rf-muted focus:border-rf-violetSoft focus:outline-none";

export function ProfileForm({ profile, saveAction }: ProfileFormProps) {
  const [fieldPresetKey, setFieldPresetKey] = useState<FieldPresetKey>(profile.fieldPresetKey);
  const [keywords, setKeywords] = useState(lines(profile.keywords));
  const [preferredOutputs, setPreferredOutputs] = useState(lines(profile.preferredOutputs));
  const [constraints, setConstraints] = useState(lines(profile.constraints));
  const [arxivQuery, setArxivQuery] = useState(profile.arxivQuery);
  // Interests are not edited directly; they track the chosen field preset so they
  // stay distinct from user-edited keywords and never go stale on a preset switch.
  const [interests, setInterests] = useState(lines(fieldPresets[profile.fieldPresetKey].interests));

  function applyPreset(key: FieldPresetKey) {
    setFieldPresetKey(key);
    const preset = fieldPresets[key];
    setKeywords(lines(preset.keywords));
    setPreferredOutputs(lines(preset.preferredOutputs));
    setConstraints(lines(preset.constraints));
    setArxivQuery(preset.defaultArxivQuery);
    setInterests(lines(preset.interests));
  }

  return (
    <form action={saveAction} className="grid gap-5 rounded-md border border-rf-border bg-rf-panel p-5">
      <input type="hidden" name="interests" value={interests} />
      <label className={labelClass}>
        Field preset
        <select
          name="fieldPresetKey"
          value={fieldPresetKey}
          onChange={(event) => applyPreset(event.target.value as FieldPresetKey)}
          className={fieldClass}
        >
          {(Object.entries(fieldPresets) as [FieldPresetKey, (typeof fieldPresets)[FieldPresetKey]][]).map(
            ([key, preset]) => (
              <option key={key} value={key}>
                {preset.label}
              </option>
            )
          )}
        </select>
      </label>

      <label className={labelClass}>
        Keywords
        <textarea
          name="keywords"
          value={keywords}
          onChange={(event) => setKeywords(event.target.value)}
          rows={5}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Preferred outputs
        <textarea
          name="preferredOutputs"
          value={preferredOutputs}
          onChange={(event) => setPreferredOutputs(event.target.value)}
          rows={4}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        Constraints
        <textarea
          name="constraints"
          value={constraints}
          onChange={(event) => setConstraints(event.target.value)}
          rows={4}
          className={fieldClass}
        />
      </label>

      <label className={labelClass}>
        arXiv query
        <textarea
          name="arxivQuery"
          value={arxivQuery}
          onChange={(event) => setArxivQuery(event.target.value)}
          rows={4}
          className={`${fieldClass} font-mono text-sm`}
        />
      </label>

      <div className="grid gap-4 md:grid-cols-2">
        <label className={labelClass}>
          Normal daily runtime minutes
          <input
            name="normalDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.normalDailyRuntimeMin}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum daily runtime minutes
          <input
            name="maxDailyRuntimeMin"
            type="number"
            min={0}
            defaultValue={profile.maxDailyRuntimeMin}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum papers screened
          <input
            name="maxPapersScreened"
            type="number"
            min={0}
            defaultValue={profile.maxPapersScreened}
            className={fieldClass}
          />
        </label>
        <label className={labelClass}>
          Maximum papers deep read
          <input
            name="maxPapersDeepRead"
            type="number"
            min={0}
            defaultValue={profile.maxPapersDeepRead}
            className={fieldClass}
          />
        </label>
      </div>

      <div className="grid gap-3">
        <label className="flex items-center gap-3 text-sm font-medium text-rf-muted">
          <input name="allowPdfFetch" type="checkbox" defaultChecked={profile.allowPdfFetch} />
          Allow PDF fetch
        </label>
        <label className="flex items-center gap-3 text-sm font-medium text-rf-muted">
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
        className="w-fit rounded-md bg-rf-violet px-4 py-2 text-sm font-semibold text-rf-white transition-colors hover:bg-rf-violetSoft"
      >
        Save profile
      </button>
    </form>
  );
}

function ListValue({ values }: { values: string[] }) {
  if (values.length === 0) {
    return <p className="text-rf-muted">None configured</p>;
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
    <section className="grid gap-5 rounded-md border border-rf-border bg-rf-panel p-5 text-sm text-rf-muted">
      <div>
        <h2 className="font-semibold text-rf-white">Field preset</h2>
        <p className="mt-1">{fieldPresets[profile.fieldPresetKey].label}</p>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Keywords</h2>
        <div className="mt-1">
          <ListValue values={profile.keywords} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Preferred outputs</h2>
        <div className="mt-1">
          <ListValue values={profile.preferredOutputs} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">Constraints</h2>
        <div className="mt-1">
          <ListValue values={profile.constraints} />
        </div>
      </div>
      <div>
        <h2 className="font-semibold text-rf-white">arXiv query</h2>
        <p className="mt-1 whitespace-pre-wrap font-mono text-rf-white">{profile.arxivQuery}</p>
      </div>
      <dl className="grid gap-4 md:grid-cols-2">
        <div>
          <dt className="font-semibold text-rf-white">Normal daily runtime minutes</dt>
          <dd className="mt-1">{profile.normalDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum daily runtime minutes</dt>
          <dd className="mt-1">{profile.maxDailyRuntimeMin}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum papers screened</dt>
          <dd className="mt-1">{profile.maxPapersScreened}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Maximum papers deep read</dt>
          <dd className="mt-1">{profile.maxPapersDeepRead}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">PDF fetch</dt>
          <dd className="mt-1">{profile.allowPdfFetch ? "Allowed" : "Disabled"}</dd>
        </div>
        <div>
          <dt className="font-semibold text-rf-white">Related-work search</dt>
          <dd className="mt-1">{profile.allowRelatedWorkSearch ? "Allowed" : "Disabled"}</dd>
        </div>
      </dl>
    </section>
  );
}
