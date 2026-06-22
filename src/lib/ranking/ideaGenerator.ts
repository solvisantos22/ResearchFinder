type PaperLike = {
  title: string;
  abstract: string;
  categories: string[];
};

type ProfileLike = {
  interests: string[];
  preferredOutputs: string[];
};

export type GeneratedIdea = {
  title: string;
  summary: string;
  rationale: string;
  approach: string;
  risks: string[];
  nextSteps: string[];
  tags: string[];
  generatedBy: string;
};

export function generateIdeasForPaper(paper: PaperLike, profile: ProfileLike): GeneratedIdea[] {
  const interests = profile.interests.slice(0, 3).join(", ") || "the research profile";

  return [
    {
      title: `Build a focused evaluation extension for ${paper.title}`,
      summary:
        "Turn the paper's core claim into a compact evaluation that tests where the finding breaks under realistic constraints.",
      rationale:
        "This creates a bounded path from recent literature to evidence without requiring frontier-scale model training.",
      approach: `Recreate the smallest relevant setup, then add stress tests connected to ${interests}.`,
      risks: [
        "The paper may not expose enough implementation detail for fast reproduction.",
        "The extension may be too incremental unless the failure mode is sharp."
      ],
      nextSteps: [
        "Design a minimal viability test with one baseline and one stress condition.",
        "Identify the smallest dataset or task slice needed for preliminary evidence.",
        "Check related work for near-duplicate benchmark variants."
      ],
      tags: ["evaluation", "benchmark", "viability"],
      generatedBy: "heuristic:v1"
    },
    {
      title: `Find a benchmark slice implied by ${paper.title}`,
      summary:
        "Identify one assumption in the source paper and build a narrow benchmark slice around that assumption.",
      rationale:
        "A narrow slice can become publishable if it exposes systematic failures across models or agent setups.",
      approach:
        "Create 50-200 targeted examples, run baseline models or agents, and analyze whether failures cluster.",
      risks: [
        "The benchmark may be too small to support strong claims.",
        "The failure pattern may disappear after prompt or model changes."
      ],
      nextSteps: [
        "Extract one falsifiable assumption from the paper.",
        "Draft the example schema for the benchmark slice.",
        "Run a novelty scan for similar datasets."
      ],
      tags: ["dataset", "failure analysis", "benchmark design"],
      generatedBy: "heuristic:v1"
    },
    {
      title: `Prototype a research-agent workflow around ${paper.title}`,
      summary:
        "Use the source paper as a seed for agents that propose, critique, and refine follow-up experiments.",
      rationale:
        "This tests whether agentic research workflows can improve the specificity of paper-extension ideas.",
      approach:
        "Compare a single-agent idea generator against a multi-role workflow with scout, critic, and experiment designer roles.",
      risks: [
        "The evaluation may measure writing quality rather than research quality.",
        "The workflow may need careful human judging to avoid noisy conclusions."
      ],
      nextSteps: [
        "Define the scoring rubric for research-plan quality.",
        "Select three recent papers as test cases.",
        "Run a minimal single-agent versus multi-agent comparison."
      ],
      tags: ["research agents", "planning", "evaluation"],
      generatedBy: "heuristic:v1"
    }
  ];
}
