import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
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
});
