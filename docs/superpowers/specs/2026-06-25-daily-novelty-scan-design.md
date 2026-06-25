# Daily Novelty Scan Design

## Context

ResearchFinder currently generates daily AI inbox ideas from arXiv candidate papers and lets a user dispatch an idea into a worker-based viability check. The first live run showed a calibration problem: every generated idea and the first viability result landed on `needs_novelty_check`.

That outcome is honest under the current evidence boundary, but not useful enough. The worker is not yet doing a real related-work search before assigning novelty status. The daily inbox should include lightweight novelty evidence every morning so dispatch decisions start from grounded information rather than speculation.

## Goals

- Run a lightweight novelty scan automatically after each daily AI inbox is generated.
- Use arXiv, open scholarly sources, and general web evidence where available.
- Store search queries, matched sources, overlap explanations, confidence, and calibrated labels.
- Avoid fake certainty. If evidence is weak, the system should say `unclear` and show why.
- Keep deeper prototype work in the dispatch flow, not the morning scan.

## Non-Goals

- Do not force a mix of novelty labels for aesthetic variety.
- Do not require paid search APIs or user-provided model/API keys.
- Do not claim a project is novel without evidence.
- Do not build the 1-3 hour prototype sprint in this spec; that is a separate dispatch-worker upgrade.

## Daily Flow

1. Hosted cron fetches arXiv candidate papers for each active profile.
2. The local Codex worker generates up to 10 ideas from the candidate batch.
3. The same worker immediately runs a novelty scan for generated ideas.
4. The inbox displays the ideas with novelty labels, supporting evidence, query traces, and confidence.
5. The user dispatches only the ideas that still look promising after this scan.

The novelty scan should be part of the morning inbox pipeline, not an action the user has to trigger manually.

## Evidence Sources

The first implementation should use sources in this order:

1. **arXiv API**
   - Query exact title phrases, method names, benchmark names, dataset names, task names, and source-paper topic terms.
   - Prefer precise queries over broad web-style keyword bags.

2. **Open scholarly APIs**
   - Use free APIs such as Semantic Scholar, OpenAlex, or Crossref where they work without private credentials.
   - Treat these as optional adapters. The scan must still run if one adapter fails.

3. **General web evidence**
   - Search for project pages, GitHub repositories, benchmark websites, blog posts, PDFs, and non-arXiv preprints.
   - In the no-API-key version, this may be done by the local Codex worker if its environment supports browsing or command-line web access.
   - Any web result must be persisted as evidence with URL, title, claim, and overlap explanation.

## Labels

Inbox idea novelty should use calibrated labels:

- `likely_novel`: search found no close existing project and the idea has a clear differentiator.
- `unclear`: evidence is insufficient or adjacent work exists but overlap is not decisive.
- `crowded`: many adjacent works exist and the idea needs sharper differentiation.
- `near_duplicate`: a close paper, repo, benchmark, or project already appears to do the same thing.
- `not_checked`: the scan did not run or failed before collecting enough evidence.

The existing `needs_novelty_check` language should remain valid for older records and dispatch viability outcomes, but new daily inbox labels should use the calibrated set above.

## Scoring Calibration

The novelty scan should update or supplement the idea's originality signal:

- `likely_novel` can support high originality only when evidence shows a concrete gap.
- `unclear` should cap novelty confidence, even if the idea sounds creative.
- `crowded` should lower originality unless the idea has a distinct angle.
- `near_duplicate` should strongly lower originality and make dispatch unlikely.

The UI should show the label and the evidence, not just the score.

## Persistence

Add persisted novelty evidence that is separate from the source-paper citation list. A generated idea can have many novelty scan records or evidence items.

Each scan result should store:

- generated idea id
- scan status
- final novelty label
- confidence from 0 to 1
- short summary
- overlap explanation
- search queries used
- source adapters attempted
- source adapters that failed
- evidence items with title, URL, source type, claim, overlap level, and confidence
- timestamps

This keeps the UI explainable and makes calibration debuggable.

## Worker Behavior

The worker should treat the morning novelty scan as a bounded evidence-gathering task:

- Scan all generated ideas for the user/date after inbox generation succeeds.
- Use a limited number of queries per idea to keep the morning job lightweight.
- Continue scanning other ideas if one source adapter fails.
- Persist partial results rather than failing the entire inbox.
- Mark ideas as `not_checked` only when evidence collection cannot run.

The scan should not run for hours or build prototypes. It should prepare the inbox for better human selection.

## UI Behavior

The inbox should show:

- novelty label on each idea
- confidence
- short summary
- top overlapping sources
- queries used or a compact "search trace" view
- source adapter failures when relevant

The UI should make `unclear` feel like an honest state, not a failure. A user should be able to see why the system is unsure.

## Error Handling

- If arXiv search fails, mark the scan as partial and continue with other sources.
- If all evidence sources fail, mark `not_checked`.
- If a source returns low-quality or malformed results, store an adapter failure note rather than hallucinating evidence.
- If Codex produces malformed novelty output, fail only that scan job and leave the generated inbox visible.

## Testing

Tests should cover:

- a morning inbox generation job can enqueue or run novelty scans
- arXiv result parsing and deduplication
- calibrated label assignment from evidence
- persistence of query traces and evidence items
- UI rendering for `likely_novel`, `unclear`, `crowded`, `near_duplicate`, and `not_checked`
- adapter failure handling without losing the generated inbox

## Open Follow-Up

The next separate design should upgrade dispatch viability from a short JSON report into a real 1-3 hour prototype sprint that creates local artifacts, runs checks, and persists outputs.
