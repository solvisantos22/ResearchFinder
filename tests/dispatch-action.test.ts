import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
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
});
