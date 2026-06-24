import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  canEditProfile: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  requireCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  updateOwnProfile: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/auth/permissions", () => ({
  canEditProfile: mocked.canEditProfile
}));

vi.mock("@/lib/profiles/service", () => ({
  updateOwnProfile: mocked.updateOwnProfile
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocked.revalidatePath
}));

vi.mock("next/navigation", () => ({
  notFound: mocked.notFound,
  redirect: mocked.redirect
}));

function createProfileForm(overrides: Record<string, string> = {}) {
  const formData = new FormData();
  const values = {
    userId: "user-1",
    fieldPresetKey: "ai_ml",
    keywords: "agent evaluation, benchmark drift",
    preferredOutputs: "benchmark",
    constraints: "No frontier-scale training",
    arxivQuery: " cat:cs.AI AND all:evaluation ",
    normalDailyRuntimeMin: "45",
    maxDailyRuntimeMin: "120",
    maxPapersScreened: "40",
    maxPapersDeepRead: "6",
    allowRelatedWorkSearch: "on",
    ...overrides
  };

  for (const [key, value] of Object.entries(values)) {
    formData.set(key, value);
  }

  return formData;
}

describe("profile actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.requireCurrentUser.mockResolvedValue({ id: "user-1" });
    mocked.canEditProfile.mockReturnValue(true);
    mocked.updateOwnProfile.mockResolvedValue({ id: "profile-1" });
  });

  it("rejects empty arxiv queries before updating the profile", async () => {
    const { saveProfile } = await import("@/app/profiles/[userId]/actions");

    await expect(saveProfile(createProfileForm({ arxivQuery: "   " }))).rejects.toThrow(
      "arXiv query is required"
    );

    expect(mocked.updateOwnProfile).not.toHaveBeenCalled();
    expect(mocked.redirect).not.toHaveBeenCalled();
  });

  it("rejects invalid numeric bounds before updating the profile", async () => {
    const { saveProfile } = await import("@/app/profiles/[userId]/actions");

    await expect(
      saveProfile(
        createProfileForm({
          maxPapersScreened: "0",
          maxPapersDeepRead: "999"
        })
      )
    ).rejects.toThrow("Max papers screened must be between 1 and 200");

    expect(mocked.updateOwnProfile).not.toHaveBeenCalled();
    expect(mocked.redirect).not.toHaveBeenCalled();
  });

  it("trims and persists validated profile form values", async () => {
    const { saveProfile } = await import("@/app/profiles/[userId]/actions");

    await expect(saveProfile(createProfileForm())).rejects.toThrow("NEXT_REDIRECT:/profiles/user-1");

    expect(mocked.updateOwnProfile).toHaveBeenCalledWith({
      currentUserId: "user-1",
      targetUserId: "user-1",
      fieldPresetKey: "ai_ml",
      keywords: ["agent evaluation", "benchmark drift"],
      preferredOutputs: ["benchmark"],
      constraints: ["No frontier-scale training"],
      arxivQuery: "cat:cs.AI AND all:evaluation",
      normalDailyRuntimeMin: 45,
      maxDailyRuntimeMin: 120,
      maxPapersScreened: 40,
      maxPapersDeepRead: 6,
      allowPdfFetch: false,
      allowRelatedWorkSearch: true
    });
    expect(mocked.revalidatePath).toHaveBeenCalledWith("/profiles/user-1");
    expect(mocked.redirect).toHaveBeenCalledWith("/profiles/user-1");
  });
});
