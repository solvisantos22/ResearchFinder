import { describe, expect, it, vi } from "vitest";
import { runResearchFinderLauncher } from "../scripts/researchfinder-launcher";

function fetchStub(states: Array<{ inbox: boolean; research: boolean }>) {
  let i = 0;
  return vi.fn(async (url: string) => {
    if (url.endsWith("/api/launcher/state")) return { ok: true, json: async () => states[Math.min(i++, states.length - 1)] };
    if (url.includes("/token")) return { ok: true, json: async () => ({ token: "t" }) };
    throw new Error(`unexpected ${url}`);
  });
}

describe("runResearchFinderLauncher", () => {
  it("spawns a desired lane and kills it when no longer desired", async () => {
    const spawnWorker = vi.fn(() => ({ lane: "inbox" as const, child: {} as never, isAlive: () => true }));
    const killWorker = vi.fn();
    await runResearchFinderLauncher(
      { appUrl: "https://x", launcherToken: "L", codexCommand: "codex" },
      {
        fetchImpl: fetchStub([{ inbox: true, research: false }, { inbox: false, research: false }]) as unknown as typeof fetch,
        spawnWorker,
        killWorker,
        sleep: async () => {},
        maxIterations: 2
      }
    );
    expect(spawnWorker).toHaveBeenCalledWith("inbox", "t");
    expect(killWorker).toHaveBeenCalledTimes(1);
  });

  it("does not spawn a lane that is already running", async () => {
    let alive = true;
    const handle = { lane: "inbox" as const, child: {} as never, isAlive: () => alive };
    const spawnWorker = vi.fn(() => handle);
    const killWorker = vi.fn();
    await runResearchFinderLauncher(
      { appUrl: "https://x", launcherToken: "L" },
      {
        fetchImpl: fetchStub([{ inbox: true, research: false }, { inbox: true, research: false }]) as unknown as typeof fetch,
        spawnWorker,
        killWorker,
        sleep: async () => {},
        maxIterations: 2
      }
    );
    // Should spawn only once even though we ran two iterations
    expect(spawnWorker).toHaveBeenCalledTimes(1);
    expect(killWorker).not.toHaveBeenCalled();
  });

  it("logs errors on transient poll failures without tearing down running workers", async () => {
    let callCount = 0;
    const faultyFetch = vi.fn(async (url: string) => {
      callCount += 1;
      if (url.endsWith("/api/launcher/state")) {
        if (callCount === 1) return { ok: false, status: 503, json: async () => ({}) };
        return { ok: true, json: async () => ({ inbox: false, research: false }) };
      }
      throw new Error(`unexpected ${url}`);
    });
    const spawnWorker = vi.fn();
    const killWorker = vi.fn();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runResearchFinderLauncher(
      { appUrl: "https://x", launcherToken: "L" },
      {
        fetchImpl: faultyFetch as unknown as typeof fetch,
        spawnWorker,
        killWorker,
        sleep: async () => {},
        maxIterations: 2
      }
    );
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("launcher state failed: 503"));
    expect(spawnWorker).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
