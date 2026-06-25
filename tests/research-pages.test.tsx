import React from "react";
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  getResearchProjectDetail: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/jobs/research", () => ({
  getResearchProjectDetail: mocked.getResearchProjectDetail,
  listResearchProjectsForUser: vi.fn()
}));
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("notFound"); } }));

beforeEach(() => {
  mocked.requireCurrentUser.mockResolvedValue({ id: "user-1", name: "Researcher" });
});
afterEach(() => vi.clearAllMocks());

describe("research project detail page", () => {
  it("renders the plan and source-paper grounding when plan_ready", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue({
      id: "proj-1",
      status: "plan_ready",
      currentStage: "plan",
      generatedIdea: { title: "Idea title", paper: { title: "Source paper", url: "https://arxiv.org/abs/2501.00001" } },
      planJob: { status: "completed" },
      plan: {
        planJson: JSON.stringify({
          researchProjectId: "proj-1",
          relationToSourcePaper: "Extends the source paper.",
          hypotheses: ["H1"], experimentalDesign: "D", protocolSteps: ["S1"],
          datasets: [], baselines: [], metrics: ["m"], successCriteria: ["win"],
          computeEstimate: "1 GPU-day", risks: [],
          citations: [{ sourceType: "paper", url: "https://arxiv.org/abs/2501.00001", title: "Source paper", claim: "c", confidence: 0.9 }]
        })
      }
    });
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    render(await ResearchProjectPage({ params: Promise.resolve({ projectId: "proj-1" }) }));

    expect(screen.getByText("Idea title")).toBeInTheDocument();
    expect(screen.getByText("Extends the source paper.")).toBeInTheDocument();
    // "Source paper" appears twice (source-paper link + its citation), so use getAllByText.
    expect(screen.getAllByText("Source paper").length).toBeGreaterThan(0);
  });

  it("calls notFound for a missing/forbidden project", async () => {
    mocked.getResearchProjectDetail.mockResolvedValue(null);
    const ResearchProjectPage = (await import("@/app/research/[projectId]/page")).default;
    await expect(ResearchProjectPage({ params: Promise.resolve({ projectId: "nope" }) })).rejects.toThrow("notFound");
  });
});
