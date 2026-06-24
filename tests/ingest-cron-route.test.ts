import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const mocked = vi.hoisted(() => ({
  buildDailyInbox: vi.fn(),
  findUsers: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findMany: (...args: unknown[]) => mocked.findUsers(...args)
    }
  }
}));

vi.mock("@/lib/inbox/service", () => ({
  buildDailyInboxForUser: (...args: unknown[]) => mocked.buildDailyInbox(...args)
}));

const routePromise = import("@/app/api/cron/ingest/route");

afterEach(() => {
  vi.unstubAllEnvs();
  mocked.buildDailyInbox.mockReset();
  mocked.findUsers.mockReset();
});

describe("ingest cron route", () => {
  it("loads profiled user emails before allowlist filtering", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", " allowed@example.com ");
    mocked.findUsers.mockResolvedValue([]);

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      }) as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mocked.findUsers).toHaveBeenCalledWith({
      where: { profile: { isNot: null } },
      select: { id: true, email: true }
    });
    expect(mocked.buildDailyInbox).not.toHaveBeenCalled();
  });

  it("filters profiled users through the case-insensitive email allowlist", async () => {
    vi.stubEnv("CRON_SECRET", "secret");
    vi.stubEnv("ALLOWED_GOOGLE_EMAILS", "allowed@example.com");
    mocked.findUsers.mockResolvedValue([
      { id: "user-1", email: "Allowed@Example.com" },
      { id: "user-2", email: "removed@example.com" },
      { id: "user-3", email: null }
    ]);
    mocked.buildDailyInbox.mockResolvedValue([{ id: "item-1" }]);

    const { POST } = await routePromise;
    const response = await POST(
      new Request("https://example.com/api/cron/ingest", {
        method: "POST",
        headers: { authorization: "Bearer secret" }
      }) as NextRequest
    );

    expect(response.status).toBe(200);
    expect(mocked.findUsers).toHaveBeenCalledWith({
      where: { profile: { isNot: null } },
      select: { id: true, email: true }
    });
    expect(mocked.buildDailyInbox).toHaveBeenCalledTimes(1);
    expect(mocked.buildDailyInbox).toHaveBeenCalledWith("user-1", expect.any(String));
    await expect(response.json()).resolves.toEqual({
      inboxDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      results: [{ userId: "user-1", count: 1 }]
    });
  });
});
