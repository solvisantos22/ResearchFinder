import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  auth: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  prisma: {
    user: {
      findUnique: vi.fn()
    }
  },
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  })
}));

vi.mock("@/auth", () => ({
  auth: mocked.auth
}));

vi.mock("@/lib/db", () => ({
  prisma: mocked.prisma
}));

vi.mock("next/navigation", () => ({
  notFound: mocked.notFound,
  redirect: mocked.redirect
}));

describe("requireCurrentUser", () => {
  const originalAllowedEmails = process.env.ALLOWED_GOOGLE_EMAILS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_GOOGLE_EMAILS = "allowed@example.com";
    mocked.prisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      email: "allowed@example.com"
    });
  });

  afterEach(() => {
    process.env.ALLOWED_GOOGLE_EMAILS = originalAllowedEmails;
  });

  it("returns an allowlisted signed-in user", async () => {
    const { requireCurrentUser } = await import("@/lib/auth/session");
    mocked.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "allowed@example.com"
      }
    });

    await expect(requireCurrentUser()).resolves.toEqual({
      id: "user-1",
      email: "allowed@example.com"
    });

    expect(mocked.prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" }
    });
  });

  it("rejects an existing session whose email is no longer allowlisted", async () => {
    const { requireCurrentUser } = await import("@/lib/auth/session");
    mocked.auth.mockResolvedValue({
      user: {
        id: "user-1",
        email: "removed@example.com"
      }
    });

    await expect(requireCurrentUser()).rejects.toThrow("NEXT_REDIRECT:/api/auth/signin");

    expect(mocked.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocked.redirect).toHaveBeenCalledWith("/api/auth/signin");
  });
});
