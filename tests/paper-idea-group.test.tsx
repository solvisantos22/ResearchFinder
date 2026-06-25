import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PaperIdeaGroup } from "@/components/PaperIdeaGroup";

const paper = {
  title: "Paper",
  abstract: "Abstract",
  url: "https://arxiv.org/abs/2606.00001",
  authors: ["Author"],
  categories: ["cs.AI"],
  publishedAt: "2026-06-23"
};

const ideas = [
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
    },
    noveltyScan: {
      label: "crowded",
      confidence: 0.82,
      summary: "Several adjacent benchmark systems exist.",
      overlapExplanation: "The idea needs a sharper differentiator.",
      evidence: [
        {
          title: "Adjacent benchmark paper",
          url: "https://arxiv.org/abs/2606.00002",
          sourceType: "arxiv",
          overlapLevel: "adjacent",
          confidence: 0.8
        }
      ]
    }
  },
  {
    id: "idea-2",
    title: "Idea two",
    summary: "Summary two",
    expandedExplanation: "Expanded two",
    trajectory: "Trajectory two",
    noveltyStatus: "novel",
    overallScore: 0.82,
    scoreExplanations: {
      relevance: "Relevant two",
      significance: "Significant two",
      originality: "Original two",
      feasibility: "Feasible two",
      overall: "Overall two"
    },
    noveltyScan: null
  }
];

describe("PaperIdeaGroup", () => {
  it("groups multiple ideas under one paper and hides dispatch for read-only views", () => {
    render(
      <PaperIdeaGroup
        currentUserId="user-1"
        generatedForUserId="user-2"
        paper={paper}
        ideas={ideas}
      />
    );

    expect(screen.getByText("Paper")).toBeInTheDocument();
    expect(screen.getByText("Idea one")).toBeInTheDocument();
    expect(screen.getByText("Idea two")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /dispatch/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open source paper/i })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/2606.00001"
    );
    expect(screen.getByText(/Needs novelty check/i)).toBeInTheDocument();
    expect(screen.getByText("crowded")).toBeInTheDocument();
    expect(screen.getByText("82% confidence")).toBeInTheDocument();
    expect(screen.getByText("Several adjacent benchmark systems exist.")).toBeInTheDocument();
    expect(screen.getByText("Adjacent benchmark paper")).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/2606.00002"
    );
  });

  it("hides dispatch for the owner until generated dispatch is explicitly enabled", () => {
    render(
      <PaperIdeaGroup
        currentUserId="user-1"
        generatedForUserId="user-1"
        paper={paper}
        ideas={[ideas[0]]}
      />
    );

    expect(screen.queryByRole("link", { name: /dispatch/i })).not.toBeInTheDocument();
  });

  it("shows dispatch for the owner only when explicitly enabled", () => {
    render(
      <PaperIdeaGroup
        currentUserId="user-1"
        generatedForUserId="user-1"
        paper={paper}
        ideas={[ideas[0]]}
        enableDispatch
      />
    );

    expect(screen.getByRole("link", { name: /dispatch/i })).toHaveAttribute(
      "href",
      "/dispatch/idea-1"
    );
  });
});
