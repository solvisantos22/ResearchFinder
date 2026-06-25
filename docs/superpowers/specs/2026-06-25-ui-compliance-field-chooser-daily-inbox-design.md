# UI Compliance, Field Chooser, and Per-Day Inbox Design

Date: 2026-06-25

## Context

ResearchFinder V2 has a defined "dark command-center" brand direction (see
`docs/superpowers/specs/2026-06-23-researchfinder-v2-ai-inbox-hosted-design.md`):
black/near-black surfaces, violet action/status accents, white text, muted gray
neutrals, Roboto typography, and ≤8px card radius. The current implementation
only partially follows it. This design fixes three issues raised by the product
owner:

1. **Clashing colours.** `tailwind.config.ts` carries both the dark `rf.*` tokens
   and leftover light tokens (`ink`, `paper`, `line`, `accent`=teal). Ten files
   mix the two systems, and three pages (`dispatch`, `jobs`, `profiles`) render in
   a light theme that clashes with the dark shell.
2. **Field chooser gaps.** A field-preset dropdown exists in the profile editor
   (`ai_ml`, `chemistry`), but it lives on the visually-broken profiles page,
   first sign-in silently defaults to `ai_ml`, two of the four spec presets
   (biology, economics) are missing, and changing the preset does not update the
   arXiv query/keywords.
3. **Inbox clutter over time.** Ten ideas arrive every day. The inbox page
   hard-codes today's date with no way to view another day, and candidate
   fetching only dedups within a single day — the same recent arXiv paper
   re-surfaces day after day until it ages out.

This design does **not** implement the daily novelty scan; that is a separate,
already-written plan (`docs/superpowers/plans/2026-06-25-daily-novelty-scan.md`)
that ships **after** this work, on top of the clean UI foundation established
here.

## Goals

- One coherent dark design-token system; no off-brand colors anywhere in `src/`.
- Every page rendered through the dark command-center shell.
- A first-run field picker, four complete field presets, and a reactive preset
  selector in the editor.
- An inbox that is scoped to a single day, navigable across days, with no
  cross-day content overlap.

## Non-Goals

- The novelty-scan feature itself (separate plan).
- New functional profile fields beyond what already exists.
- Inbox retention/deletion policies (old days are archived and navigable, not
  pruned).
- Unrelated refactoring.

## Sequencing

This UI + field + inbox work ships first. The daily-novelty-scan plan follows.
The novelty-label color mapping is added here (Section 1) so the later novelty UI
simply consumes existing tokens.

---

## Section 1 — Design-token system

The root cause of "clashing colours" is two palettes in `tailwind.config.ts`.

- **Remove** legacy tokens `ink`, `paper`, `line`, `accent`. Any leftover usage
  then fails the build/lint loudly instead of rendering off-brand.
- **Keep** the `rf.*` dark tokens (`black`, `panel`, `surface`, `border`,
  `violet`, `violetSoft`, `white`, `muted`).
- **Add a small semantic status set** tuned for dark surfaces. The brand calls
  for "violet action and status accents," but status states (online/offline/
  needs-auth, viability pass/warn/fail, novelty labels) need real differentiation,
  so monochrome violet is insufficient. Add:
  - `rf.violet` / `rf.violetSoft` — primary action and the "good/recommended"
    accent.
  - `rf.success` (desaturated green), `rf.warning` (muted amber), `rf.danger`
    (muted rose). Used only as text/border and low-alpha backgrounds on dark
    surfaces — never as bright full-bleed fills.

**Single status→token map.** Add `src/lib/ui/status-styles.ts` as the one source
of truth that maps semantic states to className fragments. Worker status, signal
panels, score pills, and novelty labels all derive their colors from it instead
of hardcoding palette classes.

- Worker status: `online`→success, `offline`→danger, `needs_auth`→warning,
  `unknown`→muted/border.
- Viability signal: `pass`→success, `warning`→warning, `fail`→danger.
- Score pill tone: `strong`→violet, `neutral`→muted/border, `warning`→warning.
- Novelty label (consumed later by the novelty-scan UI): `likely_novel`→success,
  `unclear`→muted, `crowded`→warning, `near_duplicate`→danger,
  `not_checked`→muted/border.

## Section 2 — UI compliance overhaul

- **Route every page through `AppShell`** so the dark three-column layout (left
  nav rail, central work surface, right status column) is universal. Today
  `dispatch`, `jobs`, `profiles`, and `inbox` render their own `<main>`/light
  layouts; wrap and restyle them.
- **Migrate the clashing files** to `rf.*` tokens + the status map:
  `src/app/dispatch/[ideaId]/page.tsx`, `src/app/jobs/[jobId]/page.tsx`,
  `src/app/profiles/[userId]/page.tsx`, `src/components/PaperCard.tsx`,
  `src/components/ScorePill.tsx`, `src/components/ProfileForm.tsx`,
  `src/components/DispatchForm.tsx`, `src/components/WorkerStatusPanel.tsx`,
  `src/components/WorkerSetupContent.tsx`, `src/components/SignalPanel.tsx`.
  Remove all `[color-scheme:light]`, `bg-white`, `text-slate-*`, `bg-teal-*`,
  `bg-accent`, `border-line`, `text-emerald/rose/amber-*`, etc.
- Enforce spec details: ≤8px radius on cards, violet primary buttons (replace
  teal action buttons), Roboto (already set globally).

## Section 3 — "Choose your field"

1. **First-run onboarding picker.** New `/onboarding` route. The home page
   (`src/app/page.tsx`) changes from "silently `ensureProfileForUser(id,"ai_ml")`
   → inbox" to: if the user has no profile, redirect to `/onboarding`. The user
   picks a field from a card grid of the four presets; the profile is created from
   that preset; they land on the inbox. Users who already have a profile are
   unaffected.
2. **Add biology + economics presets** in `src/lib/profiles/field-presets.ts`,
   matching the shape of the existing two, with real arXiv categories (biology →
   `q-bio.*`; economics → `econ.*` plus relevant `q-fin.*`), keywords,
   constraints, and preferred outputs. Result: four presets — AI/ML, Chemistry,
   Biology, Economics.
3. **Reactive preset in the editor.** `src/components/ProfileForm.tsx` becomes a
   client component (`"use client"`) with local state. Selecting a different field
   repopulates the arXiv query, keywords, constraints, and preferred-output fields
   from that preset's defaults; the user can then tweak before saving. Switching
   fields overwrites the current values in those fields (this is the intended
   behavior — picking a new field means adopting its defaults). It still submits
   through the existing `saveProfile` server action; no API contract change.
4. **Fix data bug found in passing.** `updateOwnProfile`
   (`src/lib/profiles/service.ts`) currently overwrites `interestsJson` with the
   keywords value on every save. Since the reactive work touches this path,
   persist `interests` correctly instead of clobbering it with keywords.

## Section 4 — Inbox as a per-day view

**View partition + navigation.** `src/app/inbox/[userId]/page.tsx` reads an
optional `?date=YYYY-MM-DD` search param. Default = the most recent inbox-day that
has content for that user (fallback to today's empty state). The header gains:

- the current inbox date,
- `◀` / `▶` arrows that jump to the adjacent inbox-day that has content (disabled
  at the ends),
- a dropdown listing every inbox-day for the user.

Each render shows only that one day's ≤10 ideas — nothing accumulates into a
single endless scroll. The inbox page is also routed through `AppShell`.

**Available-days source.** Distinct `inboxDate` values for the user, ordered
newest-first, drawn from generation jobs/generated ideas so pending and failed
days remain navigable. Expose a helper (e.g. `listInboxDatesForUser(userId)`)
in the inbox-generation/jobs layer.

**Content dedup — never re-surface a paper.**
`createArxivCandidateBatchForUser` (`src/lib/sources/arxiv-candidates.ts`)
excludes any `arxivId` the user has already been shown in a prior candidate batch.
It fetches from arXiv (recency-sorted as today), filters out previously-seen IDs,
and keeps the genuinely new ones up to `maxPapersScreened`. A quiet arXiv day
honestly yields fewer than 10 ideas. This guarantees days don't overlap in
content, not just in view. The seen-set is the union of `CandidatePaper.arxivId`
across the user's prior batches.

## Section 5 — Components and boundaries

- `src/lib/ui/status-styles.ts` — pure functions mapping semantic state → class
  fragments. No React, fully unit-testable.
- `src/lib/profiles/field-presets.ts` — extended preset map + helpers; remains the
  single source of preset truth.
- `/onboarding` route + a small field-picker component — one purpose: choose a
  field and create the profile.
- `ProfileForm` — client component owning editor local state and reactive preset
  fill; submits via the unchanged server action.
- Inbox date navigation — a small client navigator component plus a server-side
  available-days/day-resolution helper; the page stays a server component that
  reads `?date` and queries one day.
- Candidate dedup — contained entirely within `createArxivCandidateBatchForUser`.

## Section 6 — Testing

- **Token regression lock:** a guard test asserting no file under `src/`
  references removed legacy tokens (`ink`/`paper`/`line`/`accent`) or raw light
  palette classes (`bg-white`, `text-slate-*`, `*-teal-*`, `*-emerald-*`,
  `*-rose-*`, `*-amber-*`, `*-sky-*`).
- **Status map:** unit tests mapping each worker status, viability signal, score
  tone, and novelty label to its expected token fragment.
- **Field presets:** unit test that all four presets are well-formed (non-empty
  categories; default query references the preset's categories).
- **Onboarding:** a profile-less user is routed to `/onboarding`; selecting a
  preset creates the correctly-populated profile; a user with a profile skips it.
- **Reactive form + bug fix:** changing the preset repopulates the dependent
  fields; saving persists `interests` correctly (no keyword clobber).
- **Inbox day view:** resolves the correct day from `?date`; defaults to the
  latest day with content; the day list reflects only days that have inboxes.
- **Cross-day dedup:** a paper present in an earlier batch is excluded from a
  later day's batch for the same user.

## Success Criteria

- No off-brand color classes remain in `src/`; the guard test passes.
- All pages render in the dark command-center shell.
- A new user is asked to choose a field before first inbox; four presets exist;
  changing the preset in the editor live-fills the query/keywords/constraints/
  outputs; `interests` is no longer clobbered on save.
- The inbox shows exactly one day at a time, is navigable across days via
  arrows + a dropdown, defaults to the latest day with content, and never shows a
  paper that appeared on an earlier day.
- `npm run lint`, `npx tsc --noEmit`, `npm run build`, and the full Vitest suite
  pass.
