import { afterEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  developIdea: vi.fn(),
  redirect: vi.fn(),
  abortResearchProject: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/jobs/research", () => ({
  developIdea: mocked.developIdea,
  abortResearchProject: mocked.abortResearchProject
}));
vi.mock("next/navigation", () => ({ redirect: mocked.redirect }));

afterEach(() => vi.clearAllMocks());

describe("developIdeaAction", () => {
  it("develops the idea and redirects to the project page", async () => {
    mocked.requireCurrentUser.mockResolvedValue({ id: "user-1" });
    mocked.developIdea.mockResolvedValue({ id: "proj-9" });
    const { developIdeaAction } = await import("@/app/research/actions");

    const form = new FormData();
    form.set("generatedIdeaId", "idea-1");
    await developIdeaAction(form);

    expect(mocked.developIdea).toHaveBeenCalledWith({ currentUserId: "user-1", generatedIdeaId: "idea-1" });
    expect(mocked.redirect).toHaveBeenCalledWith("/research/proj-9");
  });
});

describe("abortResearchProjectAction", () => {
  it("aborts the project and redirects to the project page", async () => {
    mocked.requireCurrentUser.mockResolvedValue({ id: "user-1" });
    mocked.abortResearchProject.mockResolvedValue(undefined);
    const { abortResearchProjectAction } = await import("@/app/research/actions");

    const form = new FormData();
    form.set("researchProjectId", "proj-9");
    await abortResearchProjectAction(form);

    expect(mocked.abortResearchProject).toHaveBeenCalledWith({
      currentUserId: "user-1",
      researchProjectId: "proj-9"
    });
    expect(mocked.redirect).toHaveBeenCalledWith("/research/proj-9");
  });
});
