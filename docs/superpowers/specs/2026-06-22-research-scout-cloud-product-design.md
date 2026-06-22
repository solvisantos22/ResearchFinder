# Research Scout Cloud Product Design

Date: 2026-06-22

## Summary

Research Scout is a cloud research platform for a small AI research team, starting with two private users but architected for broader small-team use. Each user receives a personalized morning inbox of ten recent papers worth attention. The inbox is paper-first, but ranking is driven by the strongest attached project opportunity and by whether a prototype-first viability sprint can produce useful evidence.

The core lifecycle is:

```text
Daily personalized inbox
-> select paper/project idea
-> choose sprint depth and autonomy
-> run prototype-first viability sprint
-> review decision screen
-> if viable, expand into full research project
-> develop paper-ready artifact
-> write full paper with strict citation gate
-> produce advisor review packet
```

The first implementation milestone should focus on the inbox-to-viability-gate flow. The full research-project and paper-writing pipeline should be designed now, but implemented behind explicit gates so the system cannot jump from an abstract idea directly to paper writing.

## Product Direction

The chosen approach is an **Inbox-to-Gate Product**:

- Build a polished cloud morning inbox and dispatch system first.
- Make the viability sprint a real automation milestone, not a fake summary step.
- Design the full artifact-development and paper-writing pipeline now.
- Implement full paper generation only after the viability gate reliably produces evidence.

This balances product feel with research rigor. The daily inbox creates the habit loop, while the viability gate proves that the system can do more than summarize papers.

## Users

The first users are the two researchers building the product. The product should be private initially, but modeled as a small-team research system.

The product should support:

- Personal research profiles.
- Personalized paper rankings.
- Private discovery inboxes.
- Collaboration suggestions only after an idea passes viability.
- Research projects that can later become shared team workspaces.

Discovery is personal. Collaboration starts after viability.

## Morning Inbox

Each user gets a personalized daily inbox of ten papers. The inbox uses a dense **Scientific Inbox** layout: paper-first, scan-friendly, and score-driven.

Each collapsed paper card shows:

- Paper title.
- Authors, source, arXiv date, and categories.
- Overall score.
- Paper quality score.
- Project opportunity score.
- Dispatch likelihood score.
- Best project idea.
- Short abstract summary.
- Dispatch button.
- Expandable reasoning.

The product should rank papers by a configurable weighted score:

```text
overall = weighted(paper quality, project opportunity, dispatch likelihood)
```

A high-quality paper may still appear in the top ten even if dispatch likelihood is low. Every paper should have a dispatch path, but for weak candidates the dispatch path should be framed as a fast viability check rather than a commitment to a full project.

Expanded reasoning should show:

- Why the paper matters.
- Why the attached project idea is promising.
- Why the idea might be a trap.
- What the smallest viability sprint would test.
- Suggested sprint depth.
- Suggested autonomy level.

## Dispatch Setup

Clicking dispatch opens a focused setup screen rather than immediately starting work.

The setup screen shows:

- Selected paper.
- Selected project idea.
- Sprint depth control: fast, default, or deep.
- Autonomy control: low, medium, or high.
- Budget and time warning.
- Start viability sprint action.

Sprint depth means:

- **Fast**: 10-20 minute novelty and feasibility triage.
- **Default**: one to three hour viability sprint with a minimal prototype or concrete experiment sketch.
- **Deep**: six to twelve hour overnight-style investigation with deeper search, stronger prototype attempts, and more complete evidence.

Autonomy means:

- **Low**: agents read, summarize, and propose experiments only.
- **Medium**: agents can create files, small scripts, experiment plans, and local/cloud artifacts, but ask before expensive API usage or broad external services.
- **High**: agents can run code, call APIs, fetch datasets, and spend within a preset budget.

The default first product behavior should be default depth plus medium autonomy.

## Viability Sprint

The viability sprint answers one question:

```text
Is this idea novel enough, testable enough, and promising enough to become a real research project?
```

The sprint must evaluate three signals:

- **Prototype signal**: Can the system build or simulate a minimal test that produces useful preliminary evidence?
- **Research signal**: Is there a crisp hypothesis, contribution, and path to a paper?
- **Novelty signal**: Does related work suggest the idea is not already solved or too close to existing work?

The sprint output is a decision screen, not just a report.

The decision screen shows:

- Verdict.
- Prototype signal.
- Research signal.
- Novelty signal.
- Artifacts produced.
- Key evidence.
- Main risks.
- Recommended next action.

The user can choose:

- Expand to full agent team.
- Revise idea.
- Save for later.
- Discard.

## Full Research Project Phase

If the viability sprint passes, the product promotes the idea into a full research project. This phase takes the prototype and develops it into a paper-ready research artifact before any final paper-writing stage begins.

The full project phase should optimize for:

- Fully developing the prototype.
- Running stronger experiments.
- Producing reproducible artifacts.
- Creating figures, tables, and ablations.
- Preparing a paper-ready package.
- Writing a full research paper only after evidence exists.

Before paper writing begins, the project must pass the paper-ready package gate.

The gate requires:

- Runnable codebase.
- Documented data or task setup.
- Experiment scripts and configs.
- Saved results.
- Figures and tables.
- Ablations or comparisons.
- Explicit limitations.
- Reproduction instructions.

If the gate fails, the system should continue artifact development or ask for a human decision. It should not proceed to final paper generation.

## Paper Writing and Citation Gate

The paper-writing phase produces two outputs:

1. Full research paper draft.
2. Advisor review packet.

The paper draft must use strict citation verification.

Citation requirements:

- Every important claim must have source evidence.
- Every citation must link to real metadata such as arXiv, DOI, URL, or repository.
- The system must store evidence snippets, source sections, or equivalent support showing why the source backs the claim.
- Unsupported claims must be marked or removed.
- Final paper generation is blocked until unsupported claims are resolved.

The system must not invent citations. Citation metadata alone is not enough; the citation must support the claim it is attached to.

The advisor review packet should surface:

- Novelty uncertainty.
- Missing baselines.
- Fragile or overstrong claims.
- Citation confidence.
- Weak experimental evidence.
- Questions where advisor judgment is needed.
- Recommended next advisor discussion points.

## Cloud Architecture

The product should be designed as a cloud app with clear internal subsystem boundaries.

Core subsystems:

- **User/profile service**: accounts, personal interests, ranking preferences, autonomy defaults, budget defaults.
- **Paper ingestion service**: scheduled arXiv ingestion, metadata, abstracts, deduplication, category and query configuration.
- **Ranking and idea service**: paper quality score, project opportunity score, dispatch likelihood score, best idea, idea variants, reasoning.
- **Dispatch/job service**: viability sprint jobs, depth and autonomy controls, status, progress, events.
- **Artifact storage**: job outputs, generated code, reports, figures, experiment logs, datasets or dataset references.
- **Evidence and citation service**: source metadata, citation records, claim-to-evidence links, unsupported claim tracking.
- **Research project workspace**: promoted projects, code/results/figures, agent outputs, paper drafts, advisor packets.

The first implementation should not overbuild distributed infrastructure. A practical first architecture can be:

```text
web app + API
database
background worker queue
object/file storage
scheduled daily job
LLM/provider abstraction
```

Artifacts and evidence must be first-class. The system should not emit important text without preserving provenance.

## Core UX

The first useful product should revolve around three screens.

### Morning Inbox

A dense list of ten personalized paper cards.

Primary actions:

- Expand reasoning.
- Dispatch viability sprint.

### Dispatch Setup

A focused configuration screen for sprint depth, autonomy, and budget/time awareness.

Primary action:

- Start viability sprint.

### Viability Decision Screen

A post-sprint decision surface that presents evidence and asks what to do next.

Primary actions:

- Expand to full agent team.
- Revise idea.
- Save for later.
- Discard.

The product should feel like a research operating system, not a chatbot. Chat can exist inside jobs, but the main interaction model should be cards, decisions, artifacts, gates, and workspaces.

## First Milestone Scope

The first implementation milestone should cover:

- Cloud accounts for the initial private users.
- Personal research profiles.
- Scheduled daily paper ingestion.
- Personalized morning inbox.
- Hybrid paper-first ranked cards.
- Overall plus three-part score display.
- Expandable reasoning.
- Dispatch setup.
- Viability sprint job creation.
- Job status and progress view.
- Viability decision screen.
- Basic artifact and evidence storage.

The first milestone should not attempt to fully implement autonomous paper generation. It should preserve the architecture for future project expansion and citation-gated paper writing, but the initial success criterion is a useful inbox-to-gate loop.

## Non-Goals for the First Milestone

The first milestone should not include:

- Public SaaS onboarding.
- Billing.
- General marketplace-style team discovery.
- Fully autonomous long-running paper generation.
- Automatic publication or submission.
- Citation-gated final paper generation.
- Complex multi-tenant administration.

These can be designed after the inbox and viability gate are valuable.

## Success Criteria

The product is successful at the first milestone if:

- A user wants to open the inbox each morning.
- The top ten papers feel relevant and worth attention.
- Each card exposes a plausible project direction.
- Dispatch settings make the user feel in control of autonomy and cost.
- The default viability sprint produces enough evidence to make an expand/revise/save/discard decision.
- Artifacts and evidence are preserved, not lost in chat transcripts.
- The product creates at least one viable research project candidate for the team.

## Open Implementation Questions

These should be answered during implementation planning:

- Which arXiv categories and search queries should be included for each user profile?
- Which LLM providers and models should be available for each sprint depth?
- What budget limits should correspond to low, medium, and high autonomy?
- How should related-work search be implemented for the novelty signal?
- What artifact format should viability sprint outputs use?
- What database schema best supports claim-to-evidence citation tracking?
- Which parts of the existing local CLI prototype should be reused versus replaced?
