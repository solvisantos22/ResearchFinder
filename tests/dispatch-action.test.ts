import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createViabilityJob: vi.fn(),
  createViabilityJobForCurrentUser: vi.fn(),
  getRequestUserIdForPrivateAccess: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireCurrentUser: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/dispatch/service", () => ({
  createViabilityJob: mocked.createViabilityJob,
  createViabilityJobForCurrentUser: mocked.createViabilityJobForCurrentUser
}));

vi.mock("@/lib/private-access-server", () => ({
  getRequestUserIdForPrivateAccess: mocked.getRequestUserIdForPrivateAccess
}));

vi.mock("next/navigation", () => ({
  redirect: mocked.redirect
}));

describe("startDispatch", () => {
  it("uses the authenticated user instead of the submitted user id", async () => {
    const { startDispatch } = await import("@/app/dispatch/[ideaId]/actions");

    mocked.requireCurrentUser.mockResolvedValue({ id: "signed-in-user" });
    mocked.getRequestUserIdForPrivateAccess.mockResolvedValue("submitted-user");
    mocked.createViabilityJob.mockResolvedValue({ id: "legacy-job" });
    mocked.createViabilityJobForCurrentUser.mockResolvedValue({ id: "job-1" });

    const formData = new FormData();
    formData.set("ideaId", "idea-1");
    formData.set("userId", "submitted-user");
    formData.set("sprintDepth", "default");
    formData.set("autonomyLevel", "medium");

    await expect(startDispatch(formData)).rejects.toThrow("NEXT_REDIRECT:/jobs/job-1");

    expect(mocked.requireCurrentUser).toHaveBeenCalledOnce();
    expect(mocked.getRequestUserIdForPrivateAccess).not.toHaveBeenCalled();
    expect(mocked.createViabilityJob).not.toHaveBeenCalled();
    expect(mocked.createViabilityJobForCurrentUser).toHaveBeenCalledWith({
      currentUserId: "signed-in-user",
      ideaId: "idea-1",
      sprintDepth: "default",
      autonomyLevel: "medium"
    });
  });
});
