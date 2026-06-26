import { describe, expect, it } from "vitest";
import { LAUNCHER_LANES } from "@/lib/v2/domain";

describe("LAUNCHER_LANES", () => {
  it("is exactly the two launcher-managed lanes in priority order", () => {
    expect(LAUNCHER_LANES).toEqual(["inbox", "research"]);
  });
});
