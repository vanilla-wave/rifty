# ADR 0081: Reversibility checklist rule 4 — record decisions, not diffs (refines ADR-0063 / the ADR-0008 checklist)

Status: Accepted
Date: 2026-06-06
Refines: ADR-0063 (and the reversibility checklist it retained from ADR-0008) — narrows what counts as IRREVERSIBLE; does not touch the record-and-continue duty or the decision-subagent path.

## Context

The reversibility checklist (ADR-0008, retained by ADR-0063) classifies a fork to decide *where* it is recorded. Rule 4 reads: *"Would reverting require >100 lines or >2 files changed? → IRREVERSIBLE → write an ADR."* It uses change **size** as a proxy for "this needs an ADR."

A JS-runtime performance audit (`docs/perf/js-runtime-perf-audit-2026-06-05.md`) surfaced 30 actionable changes. Mechanically applying the checklist classified **12** of them as IRREVERSIBLE → NEW ADR. On inspection, about half were **behavior-preserving, contract-stable internal optimizations** — a per-instance cached `DataView` for Buffer accessors, a `normalizePath` already-normalized fast-path, a `loadResolved` dedup of a double resolve, lazy builtin-registration *timing*, stream microtask batching. None of them changes a cross-package contract, adds a dependency, or contradicts an ADR. None has an alternative a future reader would weigh: the "decision" is only "it was slow; we made it faster, same observable behavior." An ADR for that records nothing the package CHANGELOG (and the audit doc it cites) does not already carry. It dilutes the audit trail with hollow entries.

This is the same failure mode ADR-0033 fixed for the file-size budget: a **count** (lines / files) is a weak proxy for the property we actually care about — here, "is there a design decision with trade-offs worth recording" — and optimizing the proxy produces noise (ADR-0033: shallow modules; here: hollow ADRs).

## Decision

**Rule 4 no longer triggers on size.** Reverting cost (LOC / file count) signals how much *review attention* a PR deserves — not whether it deserves an ADR.

A change is **IRREVERSIBLE** (→ inline ADR; or a superseding ADR via a decision subagent if it overturns a recorded one) iff **any** of:

1. it changes a **cross-package public API** surface — an `index.ts` export, or a shared interface / wire contract another package imports (e.g. `FsSync`, `SabRing`, the `SyncRpc` frame/version, the worker spawn-spec shapes, `CrossRealmPortHandler`, the observable contract of a `./builtins/*` public export);
2. it adds an **external dependency**;
3. it **contradicts a recorded ADR**;
4. it makes a **genuine design choice** — one with live alternatives or a recordable trade-off: a new mechanism, an **observable-behavior / Node-parity change**, or a contested policy/default.

Otherwise it is **REVERSIBLE**. And a reversible change that is **behavior-preserving and contract-stable needs no governance artifact at all — however large**: record it in the affected package's `CHANGELOG.md` (citing the rationale doc, e.g. the perf audit, when one exists). `OPEN_QUESTIONS.md` is still used for a reversible change that embeds a **provisional judgment call** (e.g. a cache key or invalidation strategy) someone may later want to revisit.

The operative question moves from *"how many lines did this touch?"* to *"what would a future reader have needed to weigh?"*

## What does NOT change

- Rules 1–3 are unchanged. The decision-subagent path for overturning an already-recorded ADR (ADR-0063) is unchanged.
- "Record-and-continue; an unrecorded irreversible decision is a defect" (ADR-0063) is unchanged — this ADR narrows what *counts* as irreversible, not the duty to record real decisions.
- All Hard rules stand (no reverse imports, never edit a test to make code pass, parity-first, public API only via `index.ts`). ADRs remain immutable after merge.

## Consequences

- Fewer, denser ADRs; the audit trail records *decisions*, not *diffs*.
- The size backstop is gone — a large but behavior-preserving refactor can land without an ADR. Mitigation: it still surfaces at PR review (ADR-0033 already moved size judgment to humans) and is recorded in CHANGELOG.
- "Behavior-preserving" and "genuine alternative" are judgment calls. Mitigation: when unsure, prefer a cheap `OPEN_QUESTIONS.md` entry over a full ADR; the milestone walk promotes or rolls it back.
- Re-applied to the perf package: the 12 rule-4 ADRs collapse to the ~5 that hit rules 1–4 (cross-package contract / overturn / genuine trade-off) plus one supersede; the rest move to CHANGELOG or OPEN_QUESTIONS. See `docs/perf/js-runtime-perf-adr-plan-2026-06-06.md`.
- `CLAUDE.md` — the reversibility checklist (rule 4 and rule 5) and the "always reversible" list — updated to match.
