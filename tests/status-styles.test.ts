import { describe, expect, it } from "vitest";

import {
  noveltyLabelStyles,
  scoreToneStyles,
  signalStatusStyles,
  workerStatusStyles
} from "@/lib/ui/status-styles";

describe("status styles", () => {
  it("maps worker statuses to rf token classes only", () => {
    expect(workerStatusStyles.online).toContain("rf-success");
    expect(workerStatusStyles.offline).toContain("rf-danger");
    expect(workerStatusStyles.needs_auth).toContain("rf-warning");
    expect(workerStatusStyles.unknown).toContain("rf-muted");
  });

  it("maps signal statuses", () => {
    expect(signalStatusStyles.pass).toContain("rf-success");
    expect(signalStatusStyles.warning).toContain("rf-warning");
    expect(signalStatusStyles.fail).toContain("rf-danger");
  });

  it("maps score tones with violet as the strong accent", () => {
    expect(scoreToneStyles.strong).toContain("rf-violet");
    expect(scoreToneStyles.neutral).toContain("rf-border");
    expect(scoreToneStyles.warning).toContain("rf-warning");
  });

  it("maps every novelty label", () => {
    expect(noveltyLabelStyles.likely_novel).toContain("rf-success");
    expect(noveltyLabelStyles.crowded).toContain("rf-warning");
    expect(noveltyLabelStyles.near_duplicate).toContain("rf-danger");
    expect(noveltyLabelStyles.unclear).toContain("rf-muted");
    expect(noveltyLabelStyles.not_checked).toContain("rf-muted");
  });

  it("never references off-brand palette colors", () => {
    const all = [
      ...Object.values(workerStatusStyles),
      ...Object.values(signalStatusStyles),
      ...Object.values(scoreToneStyles),
      ...Object.values(noveltyLabelStyles)
    ].join(" ");
    expect(all).not.toMatch(/(slate|teal|amber|emerald|rose|sky|gray)-\d/);
    expect(all).not.toMatch(/\b(?:bg|text|border)-white\b/);
  });
});
