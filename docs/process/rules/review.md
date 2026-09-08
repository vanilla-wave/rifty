# Review — scope, authority, severity, evidence (`REV`)

Two symmetric reviewer errors, equally serious: missing a declared-authority
violation, and blocking on a demand no declared authority makes.

## REV-1 Scope = accepted work

Contract+RED reviews the new promise and REDs. Final+GREEN reviews the current
unit from BASE (previous accepted slice, otherwise branch base) against its
current authority. Earlier accepted work is not re-reviewed without a changed
dependency or new defect evidence. File location and PR packaging do not confer
immunity: changed tests, gates and oracle machinery are reviewed under `PR-4`.

## REV-2 Authority — a blocker cites what it violates

Admissible authorities: an invariant `I#`; a `## User scenario` line; a traced
unit row (`Acceptance 3 → I3`); an active `ADR-NNNN`; named baseline
behavior; and only these rules, which name the blocker themselves:
`AGENTS.md` §Fidelity (every rule of it — a fake, a silent gap, a mocked
sibling, a test edited to pass, a parity claim without an artifact),
`RDY-8` (missing pre-implementation reference/RED proof), `REV-7` (machinery
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

Premise timing and reuse follow `docs/backlog/README.md` §Challenge: early in
refine when it informs the user's choice, otherwise at FIT/PICKUP, optionally
with Contract+RED. Reuse a checked premise for unchanged promises; settled
scope is not reopened without new evidence.
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

## REV-8 One review record, bound to the result

Contract+RED and Final+GREEN share `artifacts/verdict.md`'s JSON model and
`tools/review/blockers.mjs` validator. Every change gets independent final
review; `RDY-8` decides the preparation. A document flip, split or deletion
has no independent review lifecycle.

The runner adds the exact `reviewed_sha` after a pass. Store the same JSON,
including any critic rulings, under `docs/backlog/<area>/reference/` as
`<slug|pr-N>-contract-red.json` or `…-final-green.json`. For docs-only work,
a PR review record is sufficient. The artifact survives temporary doc cleanup.
A ready unit may reference its preparation as
`ready-verdict: <date> — Contract+RED @ <sha>`; the reference is not the proof.

At merge `check:pass-binding` uses the same validator, requires Final+GREEN
PASS and a reviewed ancestor of HEAD with only documentation changed since.
A surviving named contract must still match the reviewed contract. It reads
the contract at the reviewed revision, so delete-on-done needs no separate
format or lifecycle inference. Draft PRs are work in flight; binding is checked
when ready. The reviewer, not artifact formatting, establishes independence.

Inside a goal the ledger points to each landed review as
`re-chart after <slice> (final-green PASS @ <sha>): …`; the prior slice's SHA
is the next BASE. Read legacy `ordinary PASS` / `Final+GREEN PASS` records as
references to their original reviewed slice. Verify only changed obligations;
new evidence can invalidate an earlier PASS. Fixes commit with their findings,
then an independent verify pass reviews the resulting tree.

## REV-9 Closure

Unit: current contract proof + empty unit residuals. Goal: no linked children +
empty goal residuals + end-to-end baseline proof of every invariant — never a
source grep, a warning, a backlog record, or one green slice.

## REV-10 Rubric axes (in order)

1. Completeness — every traced clause covered; no required deferral.
2. Mission and architecture — the DELIVERY fits the mission and layer
   boundaries (`REV-6` for premise).
3. Goal drift — delivery matches the accepted goal revision; amendments carry
   the user's decision (`RDY-6`), weakened user rows their fork (`RDY-5`).
   Required preparation exists (`RDY-8`); required residuals remain visible.
4. Approach cost — `REV-7`.
5. Scope — modified files inspected against the contract: a change no clause
   requires is `REV-7`, required supporting changes stay in the unit (`REV-1`, `PR-4`).
6. Bugs — no correctness defect.
7. Regressions — existing behavior holds.
8. Ecosystem UX — observable behavior matches real Node software.

Correctness blockers name fault class, missing RED, sibling sweep; other
blockers cite their rule. Cite `file:line`.

## REV-11 Independence

A fresh independent reviewer checks the promise when required and the delivered
result. Raw evidence, never the implementer's own verdict. A fresh critic
adjudicates disputed blockers; accepted repairs need no separate adjudicator.
The driver writes reports and bookkeeping in-session (`DEC-5`). An inline
look shares context and cannot replace the independent review.

## REV-12 Verify, disposition, route

For every observation, read the authority, evidence and code before acting.
An established violation of `REV-2` is FIX. A concern/nit is NOTE. To reject a
blocker the driver asks a fresh critic; the critic cites why it is FALSE or an
unsupported strengthening (STRETCH). A Fidelity violation cannot be STRETCH:
FALSE needs the existing discriminating carrier, cited as file:line. A BLOCK
never becomes NOTE merely because it is inconvenient or unverified.

Keep the ruling with the original evidence. A new executed artifact can reopen
PASS or REJECT; a repeated demand without new evidence cannot. A valid HOLDS
is fixed even if an earlier reviewer missed it. At verification review the
actual fix, not just a list described as settled.

Route the verified fact by obligation, regardless of who found it or when:
required by the accepted result → current work and its root-cause fix;
useful outside that result → backlog if deferred, with owner/trigger;
advisory → NOTE, no automatic task. A review suggestion cannot manufacture
scope. Required goal work stays linked. After landing, a discovered violation
starts its repair against that baseline; it is not an invitation to rebuild
the old plan. Inside authorized work continue without another user hand-off.
