import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createV2ViabilityJob: vi.fn(),
  createViabilityJobForCurrentUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireCurrentUser: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/dispatch/service", () => ({
  createViabilityJobForCurrentUser: mocked.createViabilityJobForCurrentUser
}));

vi.mock("@/lib/jobs/viability", () => ({
  createV2ViabilityJob: mocked.createV2ViabilityJob
}));

vi.mock("next/navigation", () => ({
  redirect: mocked.redirect
}));

describe("startDispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects missing required form fields before creating a job", async () => {
    const { startDispatch } = await import("@/app/dispatch/[ideaId]/actions");

    mocked.requireCurrentUser.mockResolvedValue({ id: "signed-in-user" });

    const formData = new FormData();
    formData.set("sprintDepth", "default");
    formData.set("autonomyLevel", "medium");

    await expect(startDispatch(formData)).rejects.toThrow("Missing ideaId");

    expect(mocked.createViabilityJobForCurrentUser).not.toHaveBeenCalled();
    expect(mocked.redirect).not.toHaveBeenCalled();
  });

  it("uses the authenticated user instead of the submitted user id", async () => {
    const { startDispatch } = await import("@/app/dispatch/[ideaId]/actions");

    mocked.requireCurrentUser.mockResolvedValue({ id: "signed-in-user" });
    mocked.createViabilityJobForCurrentUser.mockResolvedValue({ id: "job-1" });

    const formData = new FormData();
    formData.set("ideaId", "idea-1");
    formData.set("userId", "submitted-user");
    formData.set("sprintDepth", "default");
    formData.set("autonomyLevel", "medium");

    await expect(startDispatch(formData)).rejects.toThrow("NEXT_REDIRECT:/jobs/job-1");

    expect(mocked.requireCurrentUser).toHaveBeenCalledOnce();
    expect(mocked.createViabilityJobForCurrentUser).toHaveBeenCalledWith({
      currentUserId: "signed-in-user",
      ideaId: "idea-1",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });

  it("dispatches generated ideas with the v2 job creator", async () => {
    const { startDispatch } = await import("@/app/dispatch/[ideaId]/actions");

    mocked.requireCurrentUser.mockResolvedValue({ id: "signed-in-user" });
    mocked.createV2ViabilityJob.mockResolvedValue({ id: "job-2" });

    const formData = new FormData();
    formData.set("generatedIdeaId", "generated-idea-1");
    formData.set("ideaId", "legacy-idea-should-not-be-used");
    formData.set("sprintDepth", "default");
    formData.set("autonomyLevel", "medium");

    await expect(startDispatch(formData)).rejects.toThrow("NEXT_REDIRECT:/jobs/job-2");

    expect(mocked.createV2ViabilityJob).toHaveBeenCalledWith({
      currentUserId: "signed-in-user",
      generatedIdeaId: "generated-idea-1",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
    expect(mocked.createViabilityJobForCurrentUser).not.toHaveBeenCalled();
  });
});
