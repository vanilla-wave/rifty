# Review — scope, authority, severity, evidence (`REV`)

Two symmetric reviewer errors, equally serious: missing a declared-authority
violation, and blocking on a demand no declared authority makes.

## REV-1 Scope = unit of work, never delivery form

Contract+RED reviews the contract + its RED tests; Final+GREEN reviews the
slice diff from `BASE` — the prior landed slice's PASS inside a goal run,
else the branch base. Earlier landed slices are certified, not re-reviewed:
their files raise no coverage row. In/out is decided by ROLE in this unit,
never by directory: the unit's own contract and RED are the subject wherever
they live (a `tools/checks/*.contract.test.ts` RED included); carriers the
unit merely rides past (unrelated docs, sibling tooling that is not a
referee — `pr.md` `PR-4`) get ordinary treatment — fixed in place, never a
blocker; a referee never rides as a carrier.

## REV-2 Authority — a blocker cites what it violates

Admissible authorities: an invariant `I#`; a `## User scenario` line; a traced
unit row (`Acceptance 3 → I3`); an active `ADR-NNNN`; named baseline
behavior; and only these rules, which name the blocker themselves:
`AGENTS.md` §Fidelity (every rule of it — a fake, a silent gap, a mocked
sibling, a test edited to pass, a parity claim without an artifact),
`RDY-8` (a `review: ordinary` unit that changes a production path), `REV-7` (machinery
the contract is deliverable without), `REV-11` (a checkpoint without a fresh
reviewer), `REV-10` axis 3 (a changed ready `goal.md`, an edited ledger line, a
user-traced row dropped or weakened without `fork:`).
The `authority` field is mandatory (`blockers.mjs` rejects a blocker without
one). Any other rule id (`DEC-2` graft, `RDY-4` size, `REV-8` line forms, …),
an untraced row, a strengthening beyond the clause as written (stricter
assertion, deeper mutant, extra hardening, exactness the trace target does not
state), or taste = advisory (`REV-3`). Issuing it as a blocker is reviewer
error, symmetric to a miss.

## REV-3 Severity

| severity | meaning | effect |
|---|---|---|
| `blocker` | violates a cited authority, or a traced obligation has no carrier | FIX (`REV-12`): fixed in this slice before the verify pass |
| `concern` | advisory: weak evidence, deeper mutant, hardening, premise doubt, taste | NOTE (`REV-12`): report-only, fixed in place at the agent's choice |
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
report-only, unless the clause IS the discrimination (the unit delivers the
proof: "mutant Y dies"), where a surviving mutant is no carrier — `missing`;
`missing` = no carrier — blocks. At Contract+RED
a `weak` row needs an executed artifact from a `REV-5` class, else the row is
`pass` and the doubt is a concern. Public API entries and frozen artifacts
trace to the clause or ADR that introduces them; none → no row. Untraced rows
raise no coverage row. A later gap in a `pass` cell, or a defect visible in
this tree that surfaces only at a later pass, is reviewer error.

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
that stops the run to the user (`stops.md` `STOP-1b`) — never a blocker. A
goal `rejected route: <route> — violates <I#>` line answers it by citation.

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

Two records, nothing else:

- **Contract+RED pass** — `ready-verdict: <date> — Contract+RED @ <sha>`, first
  line of the unit's `## Decisions` (`readiness.md` `RDY-2`), with the
  reviewer's `verdict.json` and the critic's `adjudication.json` committed as
  `docs/backlog/<area>/reference/<slug>-contract-red.json` (the proof a fresh
  reviewer ran; deleted with the unit on done). A later
  `re-cut:` does not void it: Final+GREEN grades the contract as it stands
  (`REV-1`); a demotion to `draft` does, by construction — PICKUP compiles
  again or records inheritance (`RDY-5`).
- **Final+GREEN pass** — recorded where the slice lands: inside a goal the
  ledger's `re-chart after <slice> (final-green PASS @ <sha>): …` line
  (`../artifacts/ledger.md`; `(ordinary PASS @ <sha>)` for `ordinary`
  units), written by RECHART, which deletes the landed unit in the same
  commit, the Final verdict + adjudication committed beside the Contract+RED
  ones as `…-final-green.json`; a unit without a goal commits the same files,
  the runner checks the binding in session, deletes the doc, and the merged PR
  is the record (`readiness.md` `RDY-8`). An `ordinary` review's prose
  verdict is posted to the PR naming the reviewed sha before merge, and when
  the unit changes a production or test path it is also committed as
  `docs/backlog/<area>/reference/<slug|pr-N>-ordinary.md` — no verdict, no
  review happened (`REV-11`).

No status lines, no round counters: the pass history is `git log` — each fix
batch commits with its FIX findings in the message (`REV-12`). An `ordinary`
unit whose one review produced a FIX gets a verify pass by the same fresh
reviewer after the fix; the PASS names the verified tree, never one no
reviewer saw.

Binding: a PASS at `<sha>` holds while every path changed since it is
documentation per the CI classifier (`tools/checks/ci-change-scope.mjs`
`isDocumentationOnlyPath` — the same class that skips `pr:check`'s source
lanes) and the unit's graded contract is unchanged (`contract-drift.mjs`
`itemContract`) or the doc is deleted on done — bookkeeping, CLOSE exports,
ADRs and CHANGELOGs never break it, any product, test or contract change
after it does; merge requires it against the last PASS. `BASE` of the next slice = the `<sha>` of the last such rechart
line reachable from HEAD, else the branch base. Slices landed before
2026-09-03 recorded their PASS as a ledger `Final+GREEN PASS @ <sha>` line:
read it as the same record — never fall back to the branch base while such a
line exists. A blocker iterates on the SAME branch. A split successor names
its predecessor in its `re-cut:` line (`RDY-5`); nothing is copied.

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
   flip carries its `ready-verdict:` or, off any production path, its
   `review: ordinary` line (`RDY-8`), and a re-cut that dropped or weakened a
   user-traced row carries `fork:` (`RDY-5`); every landed slice carries its
   `re-chart after <slice> (… PASS @ <sha>)` line.
4. Approach cost — `REV-7`.
5. Scope — modified files inspected against the contract: a change no clause
   requires is `REV-7`, a carrier the unit rides past is ordinary (`REV-1`).
6. Bugs — no correctness defect.
7. Regressions — existing behavior holds.
8. Ecosystem UX — observable behavior matches real Node software.

Correctness blockers name fault class, missing RED, sibling sweep; other
blockers cite their rule. Cite `file:line`.

## REV-11 Freshness

One fresh isolated reviewer per checkpoint, and for the one review of an
`ordinary` unit — raw evidence only, never the implementer's
diagnosis; the implementer's own pass never counts. An inline review in a
shared context (`.claude/commands/rifty-review-inline.md`) is a look, not a
checkpoint: no verdict, no merge authority.

## REV-12 Reception — a finding is dispositioned, never inherited

Every finding gets exactly one disposition BEFORE any fix. At a checkpoint a
fresh read-only critic rules HOLDS / STRETCH / FALSE
(`../stages/checkpoint-run.md`); on an `ordinary` unit the driver rules
inline, quoting the clause as written — a concern or nit is NOTE, a blocker
is FIX or goes to the fresh critic for a REJECT, as at a checkpoint: a
blocker is never NOTEd, and the implementer never dismisses a Fidelity
finding against itself.

| disposition | when | record |
|---|---|---|
| `FIX` | HOLDS: the cited clause AS WRITTEN states the property, carrier absent; a `missing` row | the fix batch commit names it |
| `REJECT` | STRETCH / FALSE: clause broader than the demand, carrier exists, citation misread, "prove more exactly" (`REV-3`). A blocker citing `AGENTS.md` §Fidelity is rejected only as FALSE with the existing carrier cited — never as STRETCH | one journal line per verdict (`rejected: …`); never re-raised on the same evidence — it returns only with an EXECUTED artifact the ruling did not have (a repro, a failing test; the `REV-5` bar), and then goes through reception again. A REJECT that only over-reads the clause is closed; one that names a product gap the contract never claimed is a discovery (`rifty-to-backlog`) |
| `NOTE` | concern, nit, `weak` row | same line (`note: …`); report-only; the agent may fix it in place |

Verify before dispositioning: restate the demand, read the cited clause and
the carrier, check the codebase — never "you're right", never implement
first. Cannot verify → the finding stays a NOTE. A finding never becomes a
unit, a fog line or a split seed on agent authority: a NOTE graduates only
through `rifty-refine` (the user owns scope, `readiness.md` `RDY-6`). A
product defect the reviewer saw outside the unit's boundary is a discovery,
not a finding: repaired at once as its own unit (`rifty-fix`), or captured
(`rifty-to-backlog`) when it waits — never widening this one (`pr.md`
`PR-1`). A finding on a
unit that already landed is the same: a defect → `rifty-fix`; anything else
→ `rifty-refine`. Why (2026-09-02/03
`no-coi-sandbox-tier`):
a 15-blocker Final became four "proof HOLD" children — 8 h, three proof-only
slices, 0 product lines. Findings had become the plan.
