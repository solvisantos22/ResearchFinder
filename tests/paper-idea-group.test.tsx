import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaperIdeaGroup } from "@/components/PaperIdeaGroup";

describe("PaperIdeaGroup", () => {
  it("groups multiple ideas under one paper and hides dispatch for read-only views", () => {
    render(
      <PaperIdeaGroup
        currentUserId="user-1"
        generatedForUserId="user-2"
        paper={{
          title: "Paper",
          abstract: "Abstract",
          url: "https://arxiv.org/abs/2606.00001",
          authors: ["Author"],
          categories: ["cs.AI"],
          publishedAt: "2026-06-23"
        }}
        ideas={[
          {
            id: "idea-1",
            title: "Idea one",
            summary: "Summary one",
            expandedExplanation: "Expanded",
            trajectory: "Trajectory",
            noveltyStatus: "needs_novelty_check",
            overallScore: 0.9,
            scoreExplanations: {
              relevance: "Relevant",
              significance: "Significant",
              originality: "Original",
              feasibility: "Feasible",
              overall: "Overall"
            }
          }
        ]}
      />
    );

    expect(screen.getByText("Paper")).toBeInTheDocument();
    expect(screen.getByText("Idea one")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dispatch/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Needs novelty check/i)).toBeInTheDocument();
  });
});
