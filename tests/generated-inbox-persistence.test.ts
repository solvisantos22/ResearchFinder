import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { withPostgresTestDatabase } from "./helpers/postgres";

const mocked = vi.hoisted(() => ({
  prisma: null as PrismaClient | null
}));

vi.mock("@/lib/db", () => ({
  get prisma() {
    if (!mocked.prisma) throw new Error("Test prisma client has not been initialized");
    return mocked.prisma;
  }
}));

const jobServicePromise = import("@/lib/jobs/inbox-generation");

afterEach(() => {
  mocked.prisma = null;
});

describe("generated inbox persistence", () => {
  it(
    "creates Paper, GeneratedIdea, and IdeaCitation records from GeneratedInboxSchema output",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);
        const output = createGeneratedInbox({
          generatedForUserId: user.id,
          inboxDate: job.inboxDate
        });

        const completedJob = await completeInboxGenerationJob({
          jobId: job.id,
          workerId: "worker-1",
          output
        });

        expect(completedJob.status).toBe("completed");
        expect(JSON.parse(completedJob.outputJson ?? "{}")).toEqual(output);
        expect(completedJob.completedAt).toBeInstanceOf(Date);

        const paper = await client.paper.findUniqueOrThrow({
          where: { arxivId: "2606.00001" }
        });
        expect(paper.title).toBe("Paper 1");
        expect(JSON.parse(paper.authorsJson)).toEqual(["A. Researcher"]);
        expect(JSON.parse(paper.categoriesJson)).toEqual(["cs.AI"]);

        const idea = await client.generatedIdea.findFirstOrThrow({
          where: {
            userId: user.id,
            inboxDate: job.inboxDate,
            paperId: paper.id
          },
          include: { citations: true }
        });

        expect(idea.inboxGenerationJobId).toBe(job.id);
        expect(idea.title).toBe("Idea 1");
        expect(idea.summary).toBe("Summary 1");
        expect(idea.expandedExplanation).toBe("Expanded explanation 1");
        expect(idea.trajectory).toBe("Trajectory 1");
        expect(idea.recommended).toBe(true);
        expect(idea.noveltyStatus).toBe("needs_novelty_check");
        expect(idea.relevanceScore).toBe(0.91);
        expect(idea.significanceScore).toBe(0.82);
        expect(idea.originalityScore).toBe(0.73);
        expect(idea.feasibilityScore).toBe(0.64);
        expect(idea.overallScore).toBe(0.85);
        expect(JSON.parse(idea.scoreExplanationsJson)).toEqual({
          relevance: "Relevance 1",
          significance: "Significance 1",
          originality: "Originality 1",
          feasibility: "Feasibility 1",
          overall: "Overall 1"
        });
        expect(JSON.parse(idea.risksJson)).toEqual(["Risk 1"]);
        expect(idea.smallestSprint).toBe("Sprint 1");
        expect(idea.generatedBy).toBe("codex");

        expect(idea.citations).toHaveLength(2);
        expect(idea.citations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceType: "paper",
              title: "Paper 1",
              url: "https://arxiv.org/abs/2606.00001",
              sourceId: "2606.00001",
              claim: "Paper claim 1",
              confidence: 0.96
            }),
            expect.objectContaining({
              sourceType: "generated_analysis",
              title: "Generated analysis 1",
              url: "",
              sourceId: null,
              claim: "Generated claim 1",
              confidence: 0.7
            })
          ])
        );
      });
    },
    15000
  );

  it(
    "rejects more than 10 total generated ideas",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: user.id,
              inboxDate: job.inboxDate,
              papers: [
                createPaperGroup(1, 3),
                createPaperGroup(2, 3),
                createPaperGroup(3, 3),
                createPaperGroup(4, 2)
              ]
            })
          })
        ).rejects.toThrow("maximum is 10");

        expect(await client.generatedIdea.count()).toBe(0);
        const persistedJob = await client.inboxGenerationJob.findUniqueOrThrow({
          where: { id: job.id }
        });
        expect(persistedJob.status).toBe("running");
        expect(persistedJob.outputJson).toBeNull();
      });
    },
    15000
  );

  it(
    "returns pending state for an inbox with no generation job",
    async () => {
      const { getGeneratedInboxState } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const user = await client.user.create({
          data: { id: `user-${randomUUID()}`, email: `${randomUUID()}@example.com` }
        });

        await expect(getGeneratedInboxState(user.id, "2026-06-23")).resolves.toEqual({
          status: "pending",
          ideas: []
        });
      });
    },
    15000
  );

  it(
    "returns ready ideas in descending score order with paper and citations",
    async () => {
      const { completeInboxGenerationJob, getGeneratedInboxState } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);
        const output = createGeneratedInbox({
          generatedForUserId: user.id,
          inboxDate: job.inboxDate,
          papers: [
            createPaperGroup(1, [
              createGeneratedIdea(1, 1, "2606.00001", {
                title: "Lower score idea",
                scores: createScores(0.62)
              })
            ]),
            createPaperGroup(2, [
              createGeneratedIdea(2, 1, "2606.00002", {
                title: "Higher score idea",
                scores: createScores(0.94)
              })
            ])
          ]
        });

        await completeInboxGenerationJob({
          jobId: job.id,
          workerId: "worker-1",
          output
        });

        const state = await getGeneratedInboxState(user.id, job.inboxDate);

        expect(state.status).toBe("ready");
        expect(state.ideas.map((idea) => idea.title)).toEqual([
          "Higher score idea",
          "Lower score idea"
        ]);
        expect(state.ideas[0]?.overallScore).toBe(0.94);
        expect(state.ideas[0]?.paper).toEqual(
          expect.objectContaining({
            arxivId: "2606.00002",
            title: "Paper 2"
          })
        );
        expect(state.ideas[0]?.citations).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sourceType: "paper",
              sourceId: "2606.00002"
            })
          ])
        );
      });
    },
    15000
  );

  it(
    "does not persist worker output for a different claimed user or date",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { job } = await createRunningInboxGenerationJob(client, {
          userId: "claimed-user",
          inboxDate: "2026-06-23"
        });

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: "other-user",
              inboxDate: "2026-06-24"
            })
          })
        ).rejects.toThrow("Generated inbox output does not match claimed job user/date");

        expect(await client.paper.count()).toBe(0);
        expect(await client.generatedIdea.count()).toBe(0);
        expect(await client.ideaCitation.count()).toBe(0);
      });
    },
    15000
  );

  it(
    "rejects output papers outside the claimed candidate batch without writing generated rows",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client, {
          candidateIndexes: [1]
        });

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: user.id,
              inboxDate: job.inboxDate,
              papers: [createPaperGroup(2, 1)]
            })
          })
        ).rejects.toThrow("Generated inbox includes paper outside claimed candidate batch");

        expect(await client.paper.count()).toBe(0);
        expect(await client.generatedIdea.count()).toBe(0);
        expect(await client.ideaCitation.count()).toBe(0);
      });
    },
    15000
  );

  it(
    "uses canonical candidate metadata for global Paper upserts",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const canonicalPublishedAt = new Date("2026-06-20T10:30:00.000Z");
        const canonicalUrl = "https://arxiv.org/abs/2606.00001v2";
        const { user, job } = await createRunningInboxGenerationJob(client, {
          candidates: [
            createCandidatePaperInput(1, {
              title: "Canonical candidate title",
              abstract: "Canonical candidate abstract",
              url: canonicalUrl,
              publishedAt: canonicalPublishedAt,
              authors: ["Canonical Author"],
              categories: ["cs.LG"]
            })
          ]
        });

        await completeInboxGenerationJob({
          jobId: job.id,
          workerId: "worker-1",
          output: createGeneratedInbox({
            generatedForUserId: user.id,
            inboxDate: job.inboxDate,
            papers: [
              createPaperGroup(1, [
                createGeneratedIdea(1, 1, "2606.00001", {
                  citations: [
                    {
                      sourceType: "paper",
                      title: "Worker supplied title",
                      url: canonicalUrl,
                      sourceId: "2606.00001",
                      claim: "Paper claim 1",
                      confidence: 0.96
                    }
                  ]
                })
              ], {
                title: "Worker supplied title",
                abstract: "Worker supplied abstract",
                url: canonicalUrl,
                authors: ["Worker Author"],
                categories: ["cs.POISON"],
                publishedAt: "2020-01-01T00:00:00.000Z"
              })
            ]
          })
        });

        const paper = await client.paper.findUniqueOrThrow({
          where: { arxivId: "2606.00001" }
        });

        expect(paper.title).toBe("Canonical candidate title");
        expect(paper.abstract).toBe("Canonical candidate abstract");
        expect(paper.url).toBe("https://arxiv.org/abs/2606.00001v2");
        expect(paper.publishedAt.toISOString()).toBe(canonicalPublishedAt.toISOString());
        expect(paper.arxivUpdatedAt.toISOString()).toBe(canonicalPublishedAt.toISOString());
        expect(JSON.parse(paper.authorsJson)).toEqual(["Canonical Author"]);
        expect(JSON.parse(paper.categoriesJson)).toEqual(["cs.LG"]);
      });
    },
    15000
  );

  it("rejects source paper metadata that does not match the claimed candidate", async () => {
    const { completeInboxGenerationJob } = await jobServicePromise;
    const job = {
      id: "job-1",
      userId: "user-1",
      inboxDate: "2026-06-23",
      candidateBatch: {
        candidates: [
          createCandidatePaperInput(1, {
            url: "https://arxiv.org/abs/2606.00001v2"
          })
        ]
      }
    };
    const tx = {
      inboxGenerationJob: {
        findFirstOrThrow: vi.fn().mockResolvedValue(job),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ ...job, status: "completed" }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 })
      },
      generatedIdea: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: "idea-1" })
      },
      paper: {
        upsert: vi.fn().mockResolvedValue({ id: "paper-1" })
      },
      ideaCitation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    mocked.prisma = {
      $transaction: vi.fn(async (run: (transactionClient: typeof tx) => Promise<unknown>) =>
        run(tx)
      )
    } as unknown as PrismaClient;

    await expect(
      completeInboxGenerationJob({
        jobId: job.id,
        workerId: "worker-1",
        output: createGeneratedInbox({
          papers: [
            createPaperGroup(1, [
              createGeneratedIdea(1, 1, "2606.00001", {
                citations: [
                  {
                    sourceType: "paper",
                    title: "Paper 1",
                    url: "https://arxiv.org/abs/2606.00001v2",
                    sourceId: "2606.00001",
                    claim: "Canonical source paper claim",
                    confidence: 0.96
                  },
                  {
                    sourceType: "paper",
                    title: "Paper 1",
                    url: "https://arxiv.org/abs/poisoned",
                    sourceId: "2606.00001",
                    claim: "Poisoned source paper claim",
                    confidence: 0.96
                  }
                ]
              })
            ], {
              url: "https://arxiv.org/abs/2606.00001v2"
            })
          ]
        })
      })
    ).rejects.toThrow("Generated inbox source paper metadata does not match claimed candidate batch");

    expect(tx.generatedIdea.deleteMany).not.toHaveBeenCalled();
    expect(tx.paper.upsert).not.toHaveBeenCalled();
    expect(tx.generatedIdea.create).not.toHaveBeenCalled();
    expect(tx.ideaCitation.createMany).not.toHaveBeenCalled();
  });

  it(
    "rejects completion for a non-running job without leaving generated ideas",
    async () => {
      const { completeInboxGenerationJob } = await jobServicePromise;

      await withPostgresTestDatabase(async (client) => {
        mocked.prisma = client;
        const { user, job } = await createRunningInboxGenerationJob(client);
        await client.inboxGenerationJob.update({
          where: { id: job.id },
          data: {
            status: "completed",
            outputJson: "{}",
            completedAt: new Date("2026-06-23T12:10:00.000Z")
          }
        });

        await expect(
          completeInboxGenerationJob({
            jobId: job.id,
            workerId: "worker-1",
            output: createGeneratedInbox({
              generatedForUserId: user.id,
              inboxDate: job.inboxDate
            })
          })
        ).rejects.toThrow();

        expect(await client.generatedIdea.count()).toBe(0);
        expect(await client.ideaCitation.count()).toBe(0);
      });
    },
    15000
  );

  it("rejects when the final running-job update guard does not match", async () => {
    const { completeInboxGenerationJob } = await jobServicePromise;
    const job = {
      id: "job-1",
      userId: "user-1",
      inboxDate: "2026-06-23",
      candidateBatch: {
        candidates: [createCandidatePaperInput(1)]
      }
    };
    const tx = {
      inboxGenerationJob: {
        findFirstOrThrow: vi.fn().mockResolvedValue(job),
        updateMany: vi.fn().mockResolvedValue({ count: 0 })
      },
      generatedIdea: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: "idea-1" })
      },
      paper: {
        upsert: vi.fn().mockResolvedValue({ id: "paper-1" })
      },
      ideaCitation: {
        createMany: vi.fn().mockResolvedValue({ count: 1 })
      }
    };
    mocked.prisma = {
      $transaction: vi.fn(async (run: (transactionClient: typeof tx) => Promise<unknown>) =>
        run(tx)
      )
    } as unknown as PrismaClient;

    await expect(
      completeInboxGenerationJob({
        jobId: job.id,
        workerId: "worker-1",
        output: createGeneratedInbox()
      })
    ).rejects.toThrow("Inbox generation job is no longer running");

    expect(tx.inboxGenerationJob.updateMany).toHaveBeenCalledWith({
      where: {
        id: job.id,
        claimedByWorkerId: "worker-1",
        status: "running"
      },
      data: expect.objectContaining({
        status: "completed",
        completedAt: expect.any(Date)
      })
    });
    const updateInput = tx.inboxGenerationJob.updateMany.mock.calls[0]?.[0];
    expect(JSON.parse(updateInput?.data.outputJson ?? "{}")).toEqual(createGeneratedInbox());
  });
});

async function createRunningInboxGenerationJob(
  client: PrismaClient,
  overrides: {
    userId?: string;
    inboxDate?: string;
    candidateIndexes?: number[];
    candidates?: ReturnType<typeof createCandidatePaperInput>[];
  } = {}
) {
  const user = await client.user.create({
    data: {
      id: overrides.userId ?? `user-${randomUUID()}`,
      email: `${randomUUID()}@example.com`
    }
  });
  const batch = await client.candidateBatch.create({
    data: {
      userId: user.id,
      inboxDate: overrides.inboxDate ?? "2026-06-23",
      source: "arxiv",
      query: "cat:cs.AI",
      status: "completed",
      completedAt: new Date("2026-06-23T12:00:00.000Z")
    }
  });
  const candidates =
    overrides.candidates ??
    (overrides.candidateIndexes ?? [1, 2, 3, 4]).map((index) => createCandidatePaperInput(index));
  await client.candidatePaper.createMany({
    data: candidates.map((candidate) => ({
      batchId: batch.id,
      arxivId: candidate.arxivId,
      title: candidate.title,
      abstract: candidate.abstract,
      url: candidate.url,
      publishedAt: candidate.publishedAt,
      authorsJson: candidate.authorsJson,
      categoriesJson: candidate.categoriesJson,
      rawJson: candidate.rawJson
    }))
  });
  const job = await client.inboxGenerationJob.create({
    data: {
      userId: user.id,
      candidateBatchId: batch.id,
      inboxDate: batch.inboxDate,
      status: "running",
      claimedByWorkerId: "worker-1",
      inputJson: JSON.stringify({ candidateBatchId: batch.id }),
      startedAt: new Date("2026-06-23T12:05:00.000Z")
    }
  });

  return { user, batch, job };
}

function createGeneratedInbox(overrides: Record<string, unknown> = {}) {
  return {
    inboxDate: "2026-06-23",
    generatedForUserId: "user-1",
    papers: [createPaperGroup(1, 1)],
    ...overrides
  };
}

function createPaperGroup(
  paperIndex: number,
  ideas: number | ReturnType<typeof createGeneratedIdea>[],
  overrides: Record<string, unknown> = {}
) {
  const sourceId = `2606.0000${paperIndex}`;
  const generatedIdeas = Array.isArray(ideas)
    ? ideas
    : Array.from({ length: ideas }, (_, index) =>
        createGeneratedIdea(paperIndex, index + 1, sourceId)
      );

  return {
    source: "arxiv",
    sourceId,
    title: `Paper ${paperIndex}`,
    abstract: `Abstract ${paperIndex}`,
    url: `https://arxiv.org/abs/${sourceId}`,
    authors: ["A. Researcher"],
    categories: ["cs.AI"],
    publishedAt: "2026-06-23T00:00:00.000Z",
    whyPaperMatters: `Why paper ${paperIndex} matters`,
    ideas: generatedIdeas,
    ...overrides
  };
}

function createGeneratedIdea(
  paperIndex: number,
  ideaIndex: number,
  sourceId: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    title: `Idea ${ideaIndex}`,
    summary: `Summary ${ideaIndex}`,
    expandedExplanation: `Expanded explanation ${ideaIndex}`,
    trajectory: `Trajectory ${ideaIndex}`,
    recommended: ideaIndex === 1,
    noveltyStatus: "needs_novelty_check",
    scores: {
      relevance: 0.91,
      significance: 0.82,
      originality: 0.73,
      feasibility: 0.64,
      overall: 0.86 - ideaIndex * 0.01
    },
    scoreExplanations: {
      relevance: `Relevance ${ideaIndex}`,
      significance: `Significance ${ideaIndex}`,
      originality: `Originality ${ideaIndex}`,
      feasibility: `Feasibility ${ideaIndex}`,
      overall: `Overall ${ideaIndex}`
    },
    risks: [`Risk ${ideaIndex}`],
    smallestViabilitySprint: `Sprint ${ideaIndex}`,
    citations: [
      {
        sourceType: "paper",
        title: `Paper ${paperIndex}`,
        url: `https://arxiv.org/abs/${sourceId}`,
        sourceId,
        claim: `Paper claim ${ideaIndex}`,
        confidence: 0.96
      },
      {
        sourceType: "generated_analysis",
        title: `Generated analysis ${ideaIndex}`,
        url: "",
        claim: `Generated claim ${ideaIndex}`,
        confidence: 0.7
      }
    ],
    ...overrides
  };
}

function createScores(overall: number) {
  return {
    relevance: 0.91,
    significance: 0.82,
    originality: 0.73,
    feasibility: 0.64,
    overall
  };
}

function createCandidatePaperInput(
  paperIndex: number,
  overrides: {
    title?: string;
    abstract?: string;
    url?: string;
    publishedAt?: Date;
    authors?: string[];
    categories?: string[];
  } = {}
) {
  const arxivId = `2606.0000${paperIndex}`;
  const title = overrides.title ?? `Paper ${paperIndex}`;
  const abstract = overrides.abstract ?? `Abstract ${paperIndex}`;
  const url = overrides.url ?? `https://arxiv.org/abs/${arxivId}`;
  const publishedAt = overrides.publishedAt ?? new Date("2026-06-23T00:00:00.000Z");
  const authors = overrides.authors ?? ["A. Researcher"];
  const categories = overrides.categories ?? ["cs.AI"];

  return {
    arxivId,
    title,
    abstract,
    url,
    publishedAt,
    authorsJson: JSON.stringify(authors),
    categoriesJson: JSON.stringify(categories),
    rawJson: JSON.stringify({
      arxivId,
      title,
      abstract,
      url,
      publishedAt: publishedAt.toISOString(),
      authors,
      categories
    })
  };
}
