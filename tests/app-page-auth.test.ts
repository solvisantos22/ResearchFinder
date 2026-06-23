import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  canDispatchIdeaForProfile: vi.fn(),
  canViewUserResearch: vi.fn(),
  canEditProfile: vi.fn(),
  getInboxItems: vi.fn(),
  ensureProfileForUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  prisma: {
    generatedIdea: {
      findUnique: vi.fn()
    },
    idea: {
      findUnique: vi.fn()
    },
    user: {
      findUnique: vi.fn()
    },
    researchProfile: {
      findUnique: vi.fn()
    },
    viabilityJob: {
      findUnique: vi.fn()
    }
  },
  requireCurrentUser: vi.fn(),
  toEditableProfile: vi.fn()
}));

vi.mock("@/lib/auth/session", () => ({
  requireCurrentUser: mocked.requireCurrentUser
}));

vi.mock("@/lib/auth/permissions", () => ({
  canDispatchIdeaForProfile: mocked.canDispatchIdeaForProfile,
  canEditProfile: mocked.canEditProfile,
  canViewUserResearch: mocked.canViewUserResearch
}));

vi.mock("@/lib/db", () => ({
  prisma: mocked.prisma
}));

vi.mock("@/lib/inbox/service", () => ({
  getInboxItems: mocked.getInboxItems
}));

vi.mock("@/lib/profiles/service", () => ({
  ensureProfileForUser: mocked.ensureProfileForUser,
  toEditableProfile: mocked.toEditableProfile
}));

vi.mock("next/navigation", () => ({
  notFound: mocked.notFound
}));

describe("app page auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.prisma.generatedIdea.findUnique.mockResolvedValue(null);
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
    mocked.prisma.generatedIdea.findUnique.mockResolvedValue(null);
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
    expect(mocked.prisma.generatedIdea.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "idea-1" }
      })
    );
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

  it("returns not found for a generated dispatch setup owned by another user", async () => {
    const { default: DispatchPage } = await import("@/app/dispatch/[ideaId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.canDispatchIdeaForProfile.mockReturnValue(false);
    mocked.prisma.generatedIdea.findUnique.mockResolvedValue({
      id: "generated-idea-2",
      userId: "other-user",
      title: "Other generated idea",
      summary: "Generated summary",
      expandedExplanation: "Expanded generated explanation",
      trajectory: "Prototype trajectory",
      smallestSprint: "Run a focused default sprint",
      paper: {
        title: "Generated paper",
        abstract: "Generated abstract",
        url: "https://arxiv.org/abs/2606.00001"
      },
      citations: []
    });

    await expect(
      DispatchPage({ params: Promise.resolve({ ideaId: "generated-idea-2" }) })
    ).rejects.toThrow("NEXT_NOT_FOUND");

    expect(mocked.prisma.idea.findUnique).not.toHaveBeenCalled();
    expect(mocked.canDispatchIdeaForProfile).toHaveBeenCalledWith({
      currentUserId: "current-user",
      generatedForUserId: "other-user"
    });
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

  it("renders profile data read-only for a permitted non-owner viewer", async () => {
    const { default: ProfilePage } = await import("@/app/profiles/[userId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.canViewUserResearch.mockReturnValue(true);
    mocked.canEditProfile.mockReturnValue(false);
    mocked.prisma.user.findUnique.mockResolvedValue({
      id: "target-user",
      name: "Target User"
    });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue({ id: "profile-1" });
    mocked.toEditableProfile.mockReturnValue({
      fieldPresetKey: "ai_ml",
      keywords: ["LLM evaluation"],
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

    render(await ProfilePage({ params: Promise.resolve({ userId: "target-user" }) }));

    expect(screen.getByText("LLM evaluation")).toBeInTheDocument();
    expect(screen.getByText("cat:cs.AI AND all:evaluation")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save profile" })).not.toBeInTheDocument();
    expect(mocked.ensureProfileForUser).not.toHaveBeenCalled();
    expect(mocked.prisma.researchProfile.findUnique).toHaveBeenCalledWith({
      where: { userId: "target-user" }
    });
  });

  it("renders missing profile state for a permitted non-owner without ensuring a profile", async () => {
    const { default: ProfilePage } = await import("@/app/profiles/[userId]/page");

    mocked.requireCurrentUser.mockResolvedValue({ id: "current-user" });
    mocked.canViewUserResearch.mockReturnValue(true);
    mocked.canEditProfile.mockReturnValue(false);
    mocked.prisma.user.findUnique.mockResolvedValue({
      id: "target-user",
      name: "Target User"
    });
    mocked.prisma.researchProfile.findUnique.mockResolvedValue(null);

    render(await ProfilePage({ params: Promise.resolve({ userId: "target-user" }) }));

    expect(screen.getByText("No research profile has been configured yet.")).toBeInTheDocument();
    expect(mocked.ensureProfileForUser).not.toHaveBeenCalled();
    expect(mocked.toEditableProfile).not.toHaveBeenCalled();
  });
});
