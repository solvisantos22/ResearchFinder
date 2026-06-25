import React from "react";
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ProfileForm } from "@/components/ProfileForm";

describe("ProfileForm", () => {
  it("renders profile fields, arXiv query, runtime limits, and related-work toggle", () => {
    render(
      <ProfileForm
        profile={{
          fieldPresetKey: "ai_ml",
          keywords: ["LLM evaluation", "agentic research workflows"],
          preferredOutputs: ["benchmark", "evaluation harness"],
          constraints: ["Avoid frontier-scale model training"],
          arxivQuery: "cat:cs.AI AND all:evaluation",
          normalDailyRuntimeMin: 45,
          maxDailyRuntimeMin: 120,
          maxPapersScreened: 40,
          maxPapersDeepRead: 6,
          allowPdfFetch: false,
          allowRelatedWorkSearch: true
        }}
        saveAction={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Field preset")).toHaveValue("ai_ml");
    expect(screen.getByLabelText("Keywords")).toHaveValue(
      "LLM evaluation\nagentic research workflows"
    );
    expect(screen.getByLabelText("Preferred outputs")).toHaveValue(
      "benchmark\nevaluation harness"
    );
    expect(screen.getByLabelText("Constraints")).toHaveValue(
      "Avoid frontier-scale model training"
    );
    expect(screen.getByLabelText("arXiv query")).toHaveValue("cat:cs.AI AND all:evaluation");
    expect(screen.getByLabelText("Normal daily runtime minutes")).toHaveValue(45);
    expect(screen.getByLabelText("Maximum daily runtime minutes")).toHaveValue(120);
    expect(screen.getByLabelText("Maximum papers screened")).toHaveValue(40);
    expect(screen.getByLabelText("Maximum papers deep read")).toHaveValue(6);
    expect(screen.getByLabelText("Allow related-work search")).toBeChecked();
  });

  it("repopulates query, keywords, outputs, and constraints when the field preset changes", () => {
    render(
      <ProfileForm
        profile={{
          fieldPresetKey: "ai_ml",
          keywords: ["LLM evaluation"],
          preferredOutputs: ["benchmark"],
          constraints: ["Avoid frontier-scale model training"],
          arxivQuery: "cat:cs.AI AND all:evaluation",
          normalDailyRuntimeMin: 45,
          maxDailyRuntimeMin: 120,
          maxPapersScreened: 40,
          maxPapersDeepRead: 6,
          allowPdfFetch: false,
          allowRelatedWorkSearch: true
        }}
        saveAction={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText("Field preset"), { target: { value: "chemistry" } });

    expect(screen.getByLabelText("Field preset")).toHaveValue("chemistry");
    expect(screen.getByLabelText("arXiv query")).toHaveValue(
      "(cat:physics.chem-ph OR cat:cond-mat.mtrl-sci OR cat:q-bio.BM) AND (all:catalysis OR all:synthesis OR all:materials OR all:molecule OR all:screening)"
    );
    expect(screen.getByLabelText("Keywords")).toHaveValue(
      "catalysis\nmolecular screening\nmaterials discovery\ncomputational chemistry\nbiomolecular modeling"
    );
    expect(screen.getByLabelText("Preferred outputs")).toHaveValue(
      "screening workflow\ncandidate ranking\nreproducible notebook\nexperimental validation plan"
    );
  });
});
