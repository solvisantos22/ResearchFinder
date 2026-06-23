import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  canViewUserResearch: vi.fn(),
  getInboxItems: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  prisma: {
    idea: {
      findUnique: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    },
    viabilityJob: {
      findUnique: vi.fn()
    }
  },
  requireCurrentUser: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/auth/permissions", () => ({
  canViewUserResearch: mocked.canViewUserResearch
}));

vi.mock("@/lib/db", () => ({
  prisma: mocked.prisma
}));

vi.mock("@/lib/inbox/service", () => ({
  getInboxItems: mocked.getInboxItems
}));

vi.mock("next/navigation", () => ({
  notFound: mocked.notFound
}));

describe("app page auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("checks shared visibility before rendering another user's inbox", async () => {
    const { default: InboxPage } = await import("@/app/inbox/[userId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.canViewUserResearch.mockReturnValue(false);
    mocked.prisma.user.findUnique.mockResolvedValue({ id: "target-user", name: "Target User" });
    mocked.getInboxItems.mockResolvedValue([]);

    await expect(
      InboxPage({ params: Promise.resolve({ userId: "target-user" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocked.requireCurrentUser).toHaveBeenCalledOnce();
    expect(mocked.canViewUserResearch).toHaveBeenCalledWith({
      currentUserId: "current-user",
      targetUserId: "target-user"
    });
    expect(mocked.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("loads dispatch setup from the signed-in user's inbox and ignores query user id", async () => {
    const { default: DispatchPage } = await import("@/app/dispatch/[ideaId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.prisma.idea.findUnique.mockResolvedValue({
      id: "idea-1",
      title: "Idea",
      summary: "Summary",
      paper: { title: "Paper", abstract: "Abstract" },
      inboxItems: [
        {
          userId: "current-user",
          reasoningJson: "{}"
        }
      ]
    });

    await DispatchPage({
      params: Promise.resolve({ ideaId: "idea-1" }),
      searchParams: Promise.resolve({ userId: "submitted-user" })
    });

    expect(mocked.requireCurrentUser).toHaveBeenCalledOnce();
    expect(mocked.prisma.idea.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          inboxItems: expect.objectContaining({
            where: { userId: "current-user" }
          })
        })
      })
    );
  });

  it("uses shared research visibility for read-only job pages", async () => {
    const { default: JobPage } = await import("@/app/jobs/[jobId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.canViewUserResearch.mockReturnValue(false);
    mocked.prisma.viabilityJob.findUnique.mockResolvedValue({
      id: "job-1",
      userId: "target-user",
      status: "queued",
      idea: {
        title: "Idea",
        paper: {}
      },
      artifacts: [],
      evidence: []
    });

    await expect(JobPage({ params: Promise.resolve({ jobId: "job-1" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );

    expect(mocked.requireCurrentUser).toHaveBeenCalledOnce();
    expect(mocked.canViewUserResearch).toHaveBeenCalledWith({
      currentUserId: "current-user",
      targetUserId: "target-user"
    });
  });
});
