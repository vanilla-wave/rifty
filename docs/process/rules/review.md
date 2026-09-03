# Review — scope, authority, severity, evidence (`REV`)

Two symmetric reviewer errors, equally serious: missing a declared-authority
violation, and blocking on a demand no declared authority makes.

## REV-1 Scope = unit of work, never delivery form

Contract+RED reviews the contract + its RED tests; Final+GREEN reviews the
slice diff from `BASE` — the prior landed slice's reviewed tree inside a goal
run, else the branch base. Earlier landed slices are certified, not re-reviewed:
their files raise no coverage row. In/out is decided by ROLE in this unit,
never by directory: the unit's own contract and RED are the subject wherever
they live (a `tools/checks/*.contract.test.ts` RED included); carriers the
unit merely rides past (unrelated docs, CI wiring, sibling tooling, harness)
get ordinary treatment — fixed in place, never a blocker, never a round.

## REV-2 Authority — a blocker cites what it violates

Admissible authorities: an invariant `I#`; a `## User scenario` line; a traced
unit row (`Acceptance 3 → I3`); an active `ADR-NNNN`; named baseline
behavior; and only these rules, which name the blocker themselves:
`AGENTS.md` §Fidelity (fake implementation, silent gap), `REV-7` (machinery
the contract is deliverable without), `REV-11` (a checkpoint without a fresh
reviewer), `REV-10` axis 3 (a changed ready `goal.md`, an edited ledger line).
The `authority` field is mandatory (`blockers.mjs` rejects a blocker without
one). Any other rule id (`DEC-2` graft, `RDY-4` size, `REV-8` line forms, …),
an untraced row, a strengthening beyond the clause as written (stricter
assertion, deeper mutant, extra hardening, exactness the trace target does not
state), or taste = advisory (`REV-3`). Issuing it as a blocker is reviewer
error, symmetric to a miss.

## REV-3 Severity

| severity | meaning | effect |
|---|---|---|
| `blocker` | violates a cited authority, or a traced obligation has no carrier | re-cut; spends a round |
| `concern` | advisory: weak evidence, deeper mutant, hardening, premise doubt, taste | NOTE (`REV-12`): report-only, fixed in place at the agent's choice; never spends a round |
| `nit` | style | report-only |

Gates are calibrated, not maximal: "prove more exactly" is a concern unless
the trace target itself states the exactness (I3 "byte-identical" does;
"works" does not).

## REV-4 Coverage

One row per obligation traced to `I#`, scenario, or ADR inside the `REV-1`
boundary: Fault-matrix line, Acceptance/Parity clause, public API entry the
diff adds or changes, frozen oracle/golden. Each row carries its `trace`;
rule-id-only rows raise none (`readiness.md` `RDY-3`). `pass` = a committed carrier
discriminates it; `weak` = a carrier exists but a named plausible wrong
implementation passes while violating the clause AS DECLARED — advisory,
report-only; `missing` = no carrier — blocks. At Contract+RED a `weak` row
needs an executed artifact from a `REV-5` class, else the row is `pass` and
the doubt is a concern. Public API entries and frozen artifacts trace to the
clause or ADR that introduces them; none → no row. Untraced rows raise no
coverage row. A later gap in a `pass` cell, or a defect visible in this tree
that surfaces only at a later round, is reviewer error.

## REV-5 Evidence bar per checkpoint

- **Contract+RED** — reviews the promise, never an imagined implementation.
  Four admissible blocker classes, each carrying an EXECUTED artifact: the
  contract asserts a false fact about the oracle (probe command + output +
  version) · `## User scenario` behavior no clause covers (cited line) · a RED
  does not fail now, or fails for another reason — import, typecheck (run
  output) · a RED would pass with the scenario unimplemented (run output).
  Reasoning without an artifact is a concern — the bar the contract itself
  carries (`readiness.md` `RDY-2` 4).
- **Final+GREEN** — code exists and settles a mutant in one read: judge `pass`
  adversarially, bounded by the clause as declared (`REV-2`).

## REV-6 Premise

The goal's premise is adjudicated at FIT with the user, never at a checkpoint.
A premise objection (value does not follow / cheaper rival route) is a concern
that stops the run to the user (`stops.md` `STOP-1b`) — never a blocker, never
a round. A goal `rejected route: <route> — violates <I#>` line answers it by
citation.

## REV-7 Design rows

- Repeat: same fault class at one boundary, or a review change adding a state
  owner → redesign/split (`fault-classes.md` §Class-kill).
- External API: proxy/wrapper semantic copy requires an ADR + differential
  suite.
- Testing: the same scenario runs against reference and rifty; a fake cannot
  close acceptance (`testing.md`).
- Approach cost: machinery the contract is deliverable without → blocker,
  first instance and ported/carried machinery included (a port re-states its
  forcing constraint); pure code shrinkage → goal residual or capture.

## REV-8 Lineage

Three records, nothing else:

- **Contract+RED pass** — `ready-verdict: <date> — Contract+RED @ <sha>`, first
  line of the unit's `## Decisions` (`readiness.md` `RDY-2`).
- **Rounds** — one status line per checkpoint in `## Decisions`, overwritten
  each round: `final-green: round <n>/<budget> — blocker @ <sha>` (or
  `contract-red: round <n> — blocker @ <sha>`). The runner writes it right
  after the verdict; it commits with the fix batch — no separate verdict
  commit. The round history is the file's git log.
- **Final+GREEN pass** — recorded where the slice lands: the ledger's
  `re-chart after <slice> (final-green PASS @ <sha>): …` line
  (`../artifacts/ledger.md`). Nothing is written to the unit. A `review:
  ordinary` unit lands the same way with `(ordinary PASS @ <sha>)` — same
  binding, same `BASE` role.

Binding: a PASS at `<sha>` holds while
`git diff --quiet <sha> HEAD -- . ':!docs/backlog' ':!CHANGELOG.md'` is empty —
bookkeeping commits never break it, any product/test change after it does;
merge requires it against the last PASS. `BASE` of the next slice = the `<sha>`
of the last such rechart line reachable from HEAD, else the branch base.
Slices landed before 2026-09-03 recorded their PASS as a ledger
`Final+GREEN PASS @ <sha>` line and a unit `final-green:` line: read those as
the same record — never fall back to the branch base while such a line
exists. A blocker iterates on the SAME branch. A split successor names its
predecessor in its `re-cut:` line (`RDY-5`); nothing is copied.

## REV-9 Closure

Unit: current contract proof + empty unit residuals. Goal: no linked children +
empty goal residuals + end-to-end baseline proof of every invariant — never a
source grep, a warning, a backlog record, or one green slice.

## REV-10 Rubric axes (in order)

1. Completeness — every traced clause covered; no required deferral.
2. Mission and architecture — the DELIVERY fits the mission and layer
   boundaries (`REV-6` for premise).
3. Goal drift — delivery matches the named `goal.md`, else the ready contract;
   a ready `goal.md` never changed; `ledger.md` only grew; a `draft→ready`
   flip carries its `ready-verdict:`; every landed slice carries its
   `re-chart after <slice> (final-green PASS @ <sha>)` line.
4. Approach cost — `REV-7`.
5. Budget — every carried slice declared with band + rounds in `ledger.md`;
   modified files inspected against them.
6. Bugs — no correctness defect.
7. Regressions — existing behavior holds.
8. Ecosystem UX — observable behavior matches real Node software.

Correctness blockers name fault class, missing RED, sibling sweep; other
blockers cite their rule. Cite `file:line`.

## REV-11 Freshness

One fresh isolated reviewer per checkpoint — raw evidence only, never the
implementer's diagnosis; the implementer's own pass never counts. An inline
review in a shared context (`.claude/commands/rifty-review-inline.md`) is a
look, not a checkpoint: no attempt, no merge authority.

## REV-12 Reception — a finding is dispositioned, never inherited

Every finding of every verdict gets exactly one disposition BEFORE any fix,
one ledger line each (`../artifacts/ledger.md`). A fresh read-only critic
rules where a blocker would spend a round or force a re-cut — the checkpoints
(`../stages/checkpoint-run.md` §One round 3); on a `review: ordinary` unit the
driver dispositions inline, quoting the clause as written.

| disposition | when | effect |
|---|---|---|
| `FIX` | HOLDS: the cited clause AS WRITTEN states the property, carrier absent | fixed in this slice; spends the round |
| `REJECT` | STRETCH / FALSE: clause broader than the demand, carrier exists, citation misread, "prove more exactly" (`REV-3`) | `rejected: <finding> — <clause as written>`; never re-raised, never backlog |
| `NOTE` | concern, nit, `weak` row | `note: <finding>`; report-only; the agent may still fix it in place |

Verify before dispositioning (grafted from obra/superpowers
`receiving-code-review`): restate the demand, read the cited clause and the
carrier, check the codebase — never "you're right", never implement first.
Cannot verify → say what is missing; the finding stays a NOTE.

Route to the owner (Spec Kit `analyze`): requirement gap → a contract row at
PICKUP, `STOP-1a` if it widens observable scope; design gap → ADR; carrier
gap → the RED. A finding never becomes a unit, a fog line or a split seed on
agent authority: a NOTE graduates only through `rifty-refine` — the user
owns scope (`readiness.md` `RDY-6`). A product defect the reviewer saw
outside the unit's boundary is a discovery, not a finding → `rifty-to-backlog`.

Why (2026-09-02/03 `no-coi-sandbox-tier`): a 15-blocker Final was split into
four "proof HOLD" children; 8 h and three proof-only slices later, product
lines changed: 0. Findings had become the plan.
