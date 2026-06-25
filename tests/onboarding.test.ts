import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  requireCurrentUser: vi.fn(),
  ensureProfileForUser: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  }),
  prisma: {
    researchProfile: { findUnique: vi.fn() }
  }
}));

vi.mock("@/lib/auth/session", () => ({ requireCurrentUser: mocked.requireCurrentUser }));
vi.mock("@/lib/profiles/service", () => ({ ensureProfileForUser: mocked.ensureProfileForUser }));
vi.mock("@/lib/db", () => ({ prisma: mocked.prisma }));
vi.mock("next/navigation", () => ({ redirect: mocked.redirect }));

describe("home routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a user without a profile to onboarding", async () => {
    const { default: HomePage } = await import("@/app/page");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue(null);

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/onboarding");
    expect(mocked.ensureProfileForUser).not.toHaveBeenCalled();
  });

  it("sends a user with a profile to their inbox", async () => {
    const { default: HomePage } = await import("@/app/page");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue({ userId: "u1" });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
  });
});

describe("onboarding submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a profile from the chosen preset and redirects to inbox", async () => {
    const { chooseField } = await import("@/app/onboarding/actions");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.ensureProfileForUser.mockResolvedValue({ userId: "u1" });

    const formData = new FormData();
    formData.set("fieldPresetKey", "biology");

    await expect(chooseField(formData)).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
    expect(mocked.ensureProfileForUser).toHaveBeenCalledWith("u1", "biology");
  });

  it("falls back to ai_ml when an invalid preset is submitted", async () => {
    const { chooseField } = await import("@/app/onboarding/actions");
    mocked.requireCurrentUser.mockResolvedValue({ id: "u1" });
    mocked.ensureProfileForUser.mockResolvedValue({ userId: "u1" });

    const formData = new FormData();
    formData.set("fieldPresetKey", "not-a-field");

    await expect(chooseField(formData)).rejects.toThrow("NEXT_REDIRECT:/inbox/u1");
    expect(mocked.ensureProfileForUser).toHaveBeenCalledWith("u1", "ai_ml");
  });
});
