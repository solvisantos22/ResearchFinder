import { describe, expect, it } from "vitest";

import { clampGeneratedInboxIdeas } from "@/lib/v2/clamp-inbox";
import { MAX_DAILY_IDEAS, MAX_IDEAS_PER_PAPER } from "@/lib/v2/domain";

type LooseInbox = {
  papers: Array<{ sourceId: string; ideas: Array<{ title: string; scores: { overall: number } }> }>;
};

function idea(title: string, overall: number) {
  return { title, scores: { overall } };
}

function inbox(papers: LooseInbox["papers"]) {
  return { inboxDate: "2026-06-26", generatedForUserId: "user-1", papers };
}

function totalIdeas(value: unknown): number {
  const data = value as LooseInbox;
  return data.papers.reduce((sum, paper) => sum + paper.ideas.length, 0);
}

function keptTitles(value: unknown): string[] {
  const data = value as LooseInbox;
  return data.papers.flatMap((paper) => paper.ideas.map((i) => i.title));
}

describe("clampGeneratedInboxIdeas", () => {
  it("returns the input unchanged when within both caps", () => {
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.9), idea("b", 0.5)] },
      { sourceId: "p2", ideas: [idea("c", 0.7)] }
    ]);

    expect(clampGeneratedInboxIdeas(value)).toBe(value);
  });

  it("returns the input unchanged at exactly the daily cap with valid per-paper counts", () => {
    // 4 papers * (3,3,3,1) = 10 ideas, none over the per-paper cap.
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.9), idea("b", 0.9), idea("c", 0.9)] },
      { sourceId: "p2", ideas: [idea("d", 0.9), idea("e", 0.9), idea("f", 0.9)] },
      { sourceId: "p3", ideas: [idea("g", 0.9), idea("h", 0.9), idea("i", 0.9)] },
      { sourceId: "p4", ideas: [idea("j", 0.9)] }
    ]);

    expect(clampGeneratedInboxIdeas(value)).toBe(value);
    expect(totalIdeas(value)).toBe(MAX_DAILY_IDEAS);
  });

  it("trims to the daily cap, keeping the highest overall scores", () => {
    // 4 papers * 3 = 12 ideas; the two weakest must be dropped to reach 10.
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.99), idea("b", 0.98), idea("c", 0.97)] },
      { sourceId: "p2", ideas: [idea("d", 0.96), idea("e", 0.95), idea("f", 0.94)] },
      { sourceId: "p3", ideas: [idea("g", 0.93), idea("h", 0.92), idea("i", 0.91)] },
      { sourceId: "p4", ideas: [idea("j", 0.90), idea("drop1", 0.02), idea("drop2", 0.01)] }
    ]);

    const result = clampGeneratedInboxIdeas(value);

    expect(totalIdeas(result)).toBe(MAX_DAILY_IDEAS);
    expect(keptTitles(result)).not.toContain("drop1");
    expect(keptTitles(result)).not.toContain("drop2");
    expect(keptTitles(result)).toContain("j");
  });

  it("caps ideas per paper even when the total is within the daily cap", () => {
    const value = inbox([
      {
        sourceId: "p1",
        ideas: [idea("a", 0.9), idea("b", 0.8), idea("c", 0.7), idea("d", 0.6), idea("e", 0.5)]
      }
    ]);

    const result = clampGeneratedInboxIdeas(value) as LooseInbox;

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].ideas).toHaveLength(MAX_IDEAS_PER_PAPER);
    // Keeps the three highest within the paper, in original order.
    expect(result.papers[0].ideas.map((i) => i.title)).toEqual(["a", "b", "c"]);
  });

  it("caps per paper when many ideas are concentrated in one paper over the cap", () => {
    const value = inbox([
      { sourceId: "p1", ideas: Array.from({ length: 12 }, (_, i) => idea(`i${i}`, 0.9 - i * 0.01)) }
    ]);

    const result = clampGeneratedInboxIdeas(value) as LooseInbox;

    expect(result.papers).toHaveLength(1);
    expect(result.papers[0].ideas).toHaveLength(MAX_IDEAS_PER_PAPER);
  });

  it("drops a paper whose ideas are all trimmed away", () => {
    // 4 strong papers (3 each, all 0.9) fill the 10 slots; the weak paper gets none.
    const value = inbox([
      { sourceId: "s1", ideas: [idea("a", 0.9), idea("b", 0.9), idea("c", 0.9)] },
      { sourceId: "s2", ideas: [idea("d", 0.9), idea("e", 0.9), idea("f", 0.9)] },
      { sourceId: "s3", ideas: [idea("g", 0.9), idea("h", 0.9), idea("i", 0.9)] },
      { sourceId: "s4", ideas: [idea("j", 0.9), idea("k", 0.9), idea("l", 0.9)] },
      { sourceId: "weak", ideas: [idea("w1", 0.1), idea("w2", 0.05)] }
    ]);

    const result = clampGeneratedInboxIdeas(value) as LooseInbox;

    expect(totalIdeas(result)).toBe(MAX_DAILY_IDEAS);
    expect(result.papers.map((paper) => paper.sourceId)).not.toContain("weak");
  });

  it("breaks ties by document order (earlier ideas win)", () => {
    // 12 ideas all tied at 0.5 across 4 papers; later papers lose slots first.
    const value = inbox([
      { sourceId: "p1", ideas: [idea("p1a", 0.5), idea("p1b", 0.5), idea("p1c", 0.5)] },
      { sourceId: "p2", ideas: [idea("p2a", 0.5), idea("p2b", 0.5), idea("p2c", 0.5)] },
      { sourceId: "p3", ideas: [idea("p3a", 0.5), idea("p3b", 0.5), idea("p3c", 0.5)] },
      { sourceId: "p4", ideas: [idea("p4a", 0.5), idea("p4b", 0.5), idea("p4c", 0.5)] }
    ]);

    const result = clampGeneratedInboxIdeas(value);
    const titles = keptTitles(result);

    expect(titles).toHaveLength(MAX_DAILY_IDEAS);
    // p1-p3 fully kept (9), p4 keeps only its first idea.
    expect(titles).toContain("p4a");
    expect(titles).not.toContain("p4b");
    expect(titles).not.toContain("p4c");
  });

  it("preserves paper order and within-paper idea order", () => {
    // 11 ideas; only the single weakest (b, 0.1) is dropped.
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.9), idea("b", 0.1), idea("c", 0.8)] },
      { sourceId: "p2", ideas: [idea("d", 0.9), idea("e", 0.9), idea("f", 0.9)] },
      { sourceId: "p3", ideas: [idea("g", 0.9), idea("h", 0.9), idea("i", 0.9)] },
      { sourceId: "p4", ideas: [idea("j", 0.9), idea("k", 0.9)] }
    ]);

    const result = clampGeneratedInboxIdeas(value) as LooseInbox;

    expect(totalIdeas(result)).toBe(MAX_DAILY_IDEAS);
    expect(result.papers[0].sourceId).toBe("p1");
    expect(result.papers[0].ideas.map((i) => i.title)).toEqual(["a", "c"]);
    expect(result.papers.map((paper) => paper.sourceId)).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("trims unscored and out-of-range ideas before valid ones", () => {
    // p4 has an out-of-range 'bad' (1.5) and a valid low 'low' (0.01). Over the cap,
    // the schema-invalid 'bad' must be dropped before the valid 'low'.
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.9), idea("b", 0.9), idea("c", 0.9)] },
      { sourceId: "p2", ideas: [idea("d", 0.9), idea("e", 0.9), idea("f", 0.9)] },
      { sourceId: "p3", ideas: [idea("g", 0.9), idea("h", 0.9), idea("i", 0.9)] },
      { sourceId: "p4", ideas: [idea("bad", 1.5), idea("low", 0.01)] }
    ]);

    const result = clampGeneratedInboxIdeas(value);
    const titles = keptTitles(result);

    expect(titles).toHaveLength(MAX_DAILY_IDEAS);
    expect(titles).toContain("low");
    expect(titles).not.toContain("bad");
  });

  it("does not mutate the input value", () => {
    const value = inbox([
      { sourceId: "p1", ideas: [idea("a", 0.9), idea("b", 0.8), idea("c", 0.7), idea("d", 0.6)] }
    ]);
    const snapshot = JSON.stringify(value);

    clampGeneratedInboxIdeas(value);

    expect(JSON.stringify(value)).toBe(snapshot);
  });

  it("returns non-inbox shapes untouched so the schema can report the real error", () => {
    expect(clampGeneratedInboxIdeas(null)).toBeNull();
    expect(clampGeneratedInboxIdeas("nope")).toBe("nope");
    expect(clampGeneratedInboxIdeas({ papers: "not-an-array" })).toEqual({ papers: "not-an-array" });
  });
});
