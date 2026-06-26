import { describe, expect, it } from "vitest";
import { computeReconcilePlan } from "@/lib/launcher/reconcile";

describe("computeReconcilePlan", () => {
  it("spawns enabled lanes that are not running", () => {
    expect(computeReconcilePlan({ inbox: true, research: false }, [])).toEqual({ toSpawn: ["inbox"], toKill: [] });
  });
  it("kills running lanes that are no longer desired", () => {
    expect(computeReconcilePlan({ inbox: false, research: false }, ["inbox", "research"])).toEqual({ toSpawn: [], toKill: ["inbox", "research"] });
  });
  it("is a no-op when running matches desired", () => {
    expect(computeReconcilePlan({ inbox: true, research: true }, ["inbox", "research"])).toEqual({ toSpawn: [], toKill: [] });
  });
  it("spawns a lane that is desired but whose process has died (not in running)", () => {
    expect(computeReconcilePlan({ inbox: true, research: true }, ["inbox"])).toEqual({ toSpawn: ["research"], toKill: [] });
  });
});
