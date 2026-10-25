# ADR 0535: Judge app tasks against a prompt-stated contract

Status: Accepted
Date: 2026-10-17

> TL;DR: an app task's acceptance contract lives in its public prompt (module API + a few accessible names); the judge is an ordinary test run in the originating environment, calibrated on ≥3 correct and ≥3 wrong implementations before freeze. The record-observation judge engine and the booking/expense cases it served are removed; ADR-0511/0512/0516/0518–0525 are superseded.

## Context

ADR-0511 froze two "connected workflow" app cases (Vue reservations, Svelte settlement)
whose prompts left DOM/controls/captions open. Grading them needed a private engine
that discovered records, actions and choices from accessible captions
(`src/judge/{record-*,reservation-*,room-records,expense-records,native-input,…}.ts`,
≈2.3k lines, eleven ADRs, 22 case versions, eighteen campaign manifests). Eighteen
campaigns were stopped on judge false negatives. On PR #375 five independent
Final+GREEN reviews each found a new defect class in that engine: a candidate load
clicked `Cancel edit room delete` and deleted the saved room; the identity remainder
stripped interior verb tokens (`Cancel room east`); a destructive-prefix guard then
misread records literally named Delete. Each repair was itself a caption heuristic.

The library cases — command judges executed in each origin (ADR-0506) — produced
the findings that matter to the mission (`AsyncLocalStorage` across `await`,
getter-only CJS exports, npm alias/SHA-1 installs). Open-layout UI oracles produced
oracle research. Evaluations are not deterministic; the oracle must be trivial.

## Decision

1. **Contract in the prompt.** An app task states what the judge checks: a module
   API (exported functions/types, persistence schema) and a minimal UI contract
   (the accessible names of the few controls one smoke touches). Nothing judged is
   undisclosed; nothing disclosed is discovered by heuristic.
2. **Judge = test.** The judge is a test file run in the originating environment
   through the existing command-judge path (ADR-0506) plus at most one Playwright
   smoke through the declared names. No caption, record, choice or role discovery
   layer; no per-case adapters.
3. **Calibrate before freeze** (replaces ADR-0511's freeze-after-controls): ≥3
   correct implementations in different UI styles pass 100 %, ≥3 wrong ones (one
   per stated requirement at least) fail 100 %; the set is committed with the case.
4. **Oracle defects mark rows, never restart campaigns.** A judge defect found
   after a series classifies its rows `task-bad`/oracle-invalid in the frozen
   report; a corrected judge is a new case id in a new suite without a
   comparability claim.
5. **Retire the engine.** Booking/expense cases, their manifests (pilot-v1…4,
   eval-v1…18) and the engine leave the tree; `corpus/core-v1.json` carries the six
   eval-v18 cases whose judges stand (four library, `csv-workflow-v5`,
   `markdown-notes-v4`) with unchanged bytes. eval-v18 stays a frozen text record;
   its booking/expense rows are oracle-qualified.

Superseded in full: 0511 (connected workflow corpus freeze), 0512 (contextual choice
captions), 0516 (native calendar/number input owner), 0518 (action-context control
binding), 0519 (workflow operations through context), 0520/0521/0522 (record identity
outside captions / across presentation / through persisted effects), 0523/0524
(reservation display/projection), 0525 (observation settlement). Still active for
the two surviving browser-judged cases and the boundary judges: 0508, 0509, 0510,
0513, 0514, 0515, 0517; new app cases do not extend them.

## Alternatives

- Sixth engine repair cycle: each cycle found a new class; the oracle itself is unbounded.
- Keep booking/expense as calibration-only rows: a judge that can delete a record
  while loading candidates cannot calibrate anything.
- LLM-as-judge: non-deterministic; the mission's oracle is real Node, not a model.
- Retain manifests v1–v18 as history: every one references the removed cases;
  ADR-0532 already keeps campaign history out of git.

## Consequences

- Judges become ordinary tests; the rifty-vs-native delta measures Node fidelity
  in the browser, not UI guessing. New app cases need a prompt-stated contract and
  a calibration set before any model call.
- Prompts are more prescriptive: the benchmark measures implementing a stated
  contract, not UI design freedom. Recorded as the measured quantity, not hidden.
- eval-v18 booking/expense numbers are not reproducible from this tree.
- Next unit: `docs/backlog/distribution/agent-bench-contract-first-corpus.md`.
- Process deviations authorized 2026-10-17 by the user: review loop stopped after
  five cycles in favour of removal (REV-12 FIX route not taken); bulk retirement via
  this one superseding ADR (DEC-2); frozen corpus/history relaxed as in ADR-0532.
