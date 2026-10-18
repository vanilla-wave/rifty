# Process — the one map

The user owns the destination; the agent owns the route. Fidelity is unchanged
(`AGENTS.md` §Fidelity): real reference behavior, RED before a product repair,
no fake implementation, independent review. Every rule lives here, once; other
documents cite it by id (`DEC`/`RDY`/`REV`/`STOP`/`PR`). Removed ids keep
their letters; older records may still cite them. Taxonomies:
`rules/fault-classes.md`, `rules/testing.md`; lessons and harness mechanics:
`traps.md`; backlog storage and templates: `docs/backlog/README.md`.

## Layers

| Layer | Artifact | Owner |
|---|---|---|
| Destination | `goal.md`: outcome, scenario, invariants, tier | user; explicit amendments in place (`RDY-6`) |
| Route | `map.md`, unit contracts, ordering, mechanisms | agent (`RDY-5`) |
| Evidence and history | review JSON, carriers (tests, parity cases, e2e), `ledger.md`, git | producer; prior observations stay history |

An obligation comes from the accepted scenario, an invariant, an ADR, or the
existing baseline. A reviewer's suggestion becomes work only if that authority
requires it. The source of a discovery does not decide its route (`REV-12`).

## Entry points

Intent selects the entry: unsettled user input → `rifty-refine`; observed
failure → `rifty-fix`; authorized item/change → PICKUP; whole goal →
`rifty-goal`. `rifty-to-backlog` records work that must wait.

## Route

Every authorized change follows one route; the evidence already available
decides which preparation remains (`RDY-8`), never a document or a skill name.

| Stage | Result |
|---|---|
| FIT, goals only | accepted destination, the acceptance carrier RED, initial map |
| PICKUP | authority and missing proof identified |
| Contract+RED, when needed | independent promise/RED proof before new behavior |
| IMPLEMENT | honest implementation, GREEN |
| Final+GREEN | independent review of the delivered result |
| RECHART, goals only | the acceptance carrier run; the next wall chosen |
| CLOSE | accepted obligations proven end to end, residuals resolved, merge on green CI |

An observed defect already has a baseline: reproduce, RED, fix, Final+GREEN.
A new parity/stateful promise needs Contract+RED first. Documentation has no
product RED. A whole-goal hand-off loops the route over the map, then CLOSE; a
standalone request finishes its unit. The starting session drives the entire
route, including routine records and its report; never return control between
stages. On Claude Code a whole-goal hand-off runs through
`.claude/workflows/goal-run.js`: the script sequences the same stages, one fresh
leaf per stage reading state from disk, a fresh reviewer per checkpoint, the
invoking session the exception layer (`DEC-5`; `traps.md` §Harness). A re-entry
reads the PR body and the ledger tail. Fresh contexts are for independent
decisions only (`DEC-5`).

### FIT — chart a goal

Input: a ratified outcome (a refine session's settled epic, a draft left on an
unanswered question or a just-file, a hand-off, a legacy single-file epic).
Output: a ready goal directory (`goal.md`, `map.md`, `ledger.md`). Derive,
never invent scope; the user is present (the refine session, or the hand-off
session). A stage is never a PR boundary (`PR-3`).

1. Bounded-destination test: provably closable, or it is not a goal — a
   direction or standing invariant routes to `docs/ROADMAP.md`, an owner doc or
   a ratchet; a legacy epic failing the test is re-typed and its file deleted.
2. `goal.md` (`status: draft`): frontmatter, `## Outcome`, `## User scenario`;
   a legacy epic carries ratified content verbatim, old file deleted.
3. Owner first, then probe-or-fog (`RDY-6`): a user-owned question (observable
   scope, what must not change, whose scenario counts) is asked now — no answer
   → the goal stays `draft` with the question as an `owner: user` line; an
   agent-owned fact gets a discriminating probe (command + output + version) or
   an `owner: agent` fog line. Split mixed questions.
4. `## Invariants` numbered from Outcome/scenario/decisions only, each false on
   current main (evidence above the list); `tier` with one `## Decisions` line;
   a rejected rival route as `rejected route: <route> — violates <I#|Outcome>`.
5. Map: the first unit is the acceptance carrier — the `## User scenario` as an
   executable e2e/parity case, committed RED and marked expected-failure. Later
   units are the walls that running it exposes; a seeded item is a hypothesis
   until the run hits it. Children stay `draft` (PICKUP compiles, `RDY-1`).
   Add `## Out of scope`.
6. Ledger: one header line.
7. Challenge: `docs/backlog/README.md` §Challenge on outcome and route; reuse an
   early checked premise for unchanged promises; record `## Challenge`.
8. Final written-result check (`RDY-6`) over goal/map/seeded drafts together in
   one fresh reviewer context; resolve findings, recheck material edits. On a
   docs-only tree this pass is also the Final+GREEN.
9. Flip `status: ready`; write the completion report (`docs/backlog/README.md`
   §Report); no approval gate. Pushback before the first PICKUP re-fits in
   place; after a run started → user amendment.

Done when `pnpm backlog:check` passes and every fit-time decision lives in
`goal.md`, `map.md` or a ledger line.

### PICKUP — identify the authority and missing proof

Input: authorized work — a draft, an observed defect, a direct request, or the
goal's next wall.

1. Name the accepted result and its authority: scenario, invariant, ADR or
   observed baseline. New scope needs the user's decision (`RDY-6`).
2. A draft compiles per `RDY-2`; a missing premise check is resolved here. A
   question a probe answers is answered here; keep a useful decision, otherwise
   delete the draft.
3. Identify the evidence still needed (`RDY-8`): new parity/stateful behavior
   → Contract+RED; an observed defect → its real baseline artifact and RED;
   landed behavior → its accepted authority. Docs need no product RED.
4. Run the missing preparation (Contract+RED, or `rifty-fix`); set an existing
   draft ready with its evidence references.
5. Deliver the preparation report (`docs/backlog/README.md` §Report) before the
   first IMPLEMENT, then continue without another approval.

Done when the required pre-implementation proof exists.

### Contract+RED — certify the promise before code

Subject: the ready contract and its RED tests on a clean tree, boundary BASE =
the prior landed slice, else the branch base (`REV-1`). Never an implementation
in the diff. Evidence bar `REV-5`; coverage rows for traced obligations only
(`REV-4`). PASS → `ready-verdict: <date> — Contract+RED @ <sha>` as the first
`## Decisions` line, the JSON on the PR (`REV-8`). Blocker → reception, one
batch fix, one verify pass (§Review run); a stall → `STOP-3`.

### IMPLEMENT — the smallest honest mechanism to GREEN

1. Run RED before product changes: the certified new-behavior tests or the
   reproduced defect's own parity/regression test. Never retarget a test to
   pass.
2. Fix the root owner and sweep its fault class (`rules/fault-classes.md`
   §Class-kill); a sibling the sweep finds is routed by `REV-12`.
3. Update obligations, decisions and useful observations where they belong. A
   technical uncertainty is a next probe/design, not a user scope question.
4. Run `pnpm pr:check` (`PR-6`). A reproducing failure is diagnosed; expected
   RED is not a separate bug; an unresolvable red never lands.
5. Commit, push, update the draft PR, continue Final+GREEN.

### Final+GREEN — prove the delivered result

Review the current unit diff from BASE on a clean committed tree. The reviewer
checks the current contract/baseline, the preparation `RDY-8` required, real
acceptance proof and any change to the judging criteria (`PR-4`). A filename, a
ready flag or a passing test with a fake cannot close a claim. PASS → verdict
recorded at the reviewed sha (`REV-8`); inside a goal continue RECHART;
standalone work merges per `PR-6`. Blockers → reception, fix, verify (§Review
run); a surviving technical problem follows `STOP-3..4`, never a fake GREEN.

### RECHART — make the map match the run

Immediately after a slice, an impasse, a fact that changes the route, or the
hand-off of a goal with no carrier.

1. Record decisions and useful observations once in the ledger; history does
   not become an obligation because it was written down.
2. Run the acceptance carrier on the landed tree. The next unit is the first
   wall it hits; with no carrier yet (a goal fitted before carrier-first), the
   carrier itself. Resolve known questions and dependencies on the way. Route
   verified work by `REV-12`; scope changes follow `RDY-6`.
3. Required unfinished work stays linked to the goal with the next probe or
   design that can settle it; continue independent work. Revert unsafe partial
   product/test changes before another unit relies on that tree; keep evidence
   and history.
4. For a landed slice append `re-chart after <slice> (final-green PASS @ <sha>):
   <what changed>` — the navigation reference to the verdict (`REV-8`). Remove
   the completed item from the map.

An empty map is not proof of completion; CLOSE verifies the destination.

### CLOSE — close obligations, keep useful knowledge

1. An independent reviewer verifies the goal's end-to-end evidence: every
   invariant executed on the real scenario (it may be the final slice reviewer
   when the same tree and the complete goal were reviewed). Composed actions are
   proven on one representative real program/state; no full cross-product.
   Unproven work stays open; a technical limit is not permission to drop it.
2. Resolve required questions and residuals; a changed destination needs the
   user's recorded amendment (`RDY-6`). Deferred useful work outside the result
   has an owner and trigger; a required repair never completes by moving to
   backlog.
3. Export durable decisions, operating constraints and reproducible evidence.
   Routine observations and failed attempts remain in git history.
4. Remove completed goal/item documents and stale links; keep the landing
   verdict. CHANGELOG, `backlog:check`, then `goal_complete` and merge per
   `PR-6`. Deletion is cleanup, never the definition of success.

## Review run — one procedure, one verdict

Name CHECKPOINT (`Contract+RED` | `Final+GREEN`), UNIT (contract path, or PR
number plus the observed baseline) and BASE. The tree is clean. A fresh
independent reviewer (`rifty-review`) reads raw authorities, diff and
artifacts — never the implementer's diagnosis; it may execute probes/mutants in
a detached scratch copy; it never edits the work. Harness mechanics: `traps.md`
§Harness. An invalid report is a harness failure, not a review: retry once, then
report the error.

1. The driver verifies every finding against its authority and evidence
   (`REV-12`): a valid blocker is FIX, advice is NOTE. A disputed blocker goes to
   one fresh critic with the original evidence (`DEC-5`); the implementer cannot
   dismiss its own defect. The critic records HOLDS / FALSE / STRETCH with the
   clause and evidence as `adjudication` in the same JSON; a Fidelity blocker is
   rejected only as FALSE with the discriminating carrier cited `file:line`.
2. Fix the surviving blockers together, commit, then the independent reviewer
   verifies the actual changed tree, including whether the fixes work. A
   mistaken report is corrected by the same reviewer with its reason and
   revalidated; no new context. Prior rulings are evidence, not immunity: a new
   artifact reopens a finding.
3. PASS → the driver adds `reviewed_sha` and validates with
   `tools/review/blockers.mjs`; the JSON is posted on the PR. Continue the next
   stage. A surviving identical failure with no new evidence changes the
   approach (`STOP-3..4`).

A small docs review still has independent eyes: empty product coverage, no
manufactured contract, RED, challenge, critic or report-writing agent.

## Review rules (`REV`)

Two symmetric reviewer errors, equally serious: missing a declared-authority
violation, and blocking on a demand no declared authority makes.

- **REV-1 Scope.** Contract+RED reviews the new promise and REDs. Final+GREEN
  reviews the current unit from BASE against its current authority. Earlier
  accepted work is not re-reviewed without a changed dependency or new defect
  evidence. Changed tests, gates and oracle machinery are reviewed under `PR-4`.
- **REV-2 Authority.** A blocker cites what it violates. Admissible: an
  invariant `I#`; a `## User scenario` line; a traced unit row (`Acceptance 3 →
  I3`, or the contract cited `docs/backlog/….md:line`); an active `ADR-NNNN`;
  named baseline behavior; and only these rules, which name the blocker
  themselves: `AGENTS.md` §Fidelity (a fake, a silent gap, a mocked sibling, a
  test edited to pass, a parity claim without an artifact), `RDY-8` (missing
  pre-implementation proof), `REV-7` (machinery the contract is deliverable
  without, or the same fault class repeating at one boundary), `REV-11` (a
  checkpoint without a fresh reviewer), `REV-10` axis 3 (a changed ready
  `goal.md`, an edited ledger line, a user-traced row dropped or weakened
  without `fork:`). A sibling sweep, more RED outside the cited row, a stricter
  assertion or extra hardening is advice: file it as a concern naming the path
  and the row it would protect, so reception reads it (`REV-12`).
- **REV-3 Severity.** `blocker` = violates a cited authority or a traced
  obligation has no carrier → FIX in this slice before the verify pass.
  `concern` = advisory (weak evidence, deeper mutant, hardening, premise doubt,
  taste) → NOTE, fixed in place at the agent's choice. `nit` = style. Gates are
  calibrated, not maximal: "prove more exactly" is a concern unless the trace
  target states the exactness (I3 "byte-identical" does; "works" does not).
- **REV-4 Coverage.** One row per obligation traced to `I#`, scenario or ADR
  inside the `REV-1` boundary (fault-matrix line, acceptance/parity clause,
  public API entry the diff adds, frozen oracle). `pass` = a committed carrier
  discriminates it; `weak` = a carrier exists but a named plausible wrong
  implementation passes while violating the clause as declared — advisory,
  unless the clause is the discrimination; `missing` = no carrier — blocks. A
  row whose oracle is real Node carries a runner case or a real-Node artifact;
  a hand-typed golden grades `missing`. Untraced and rule-id-only rows raise no
  coverage row (`RDY-3`).
- **REV-5 Evidence bar.** Contract+RED reviews the promise, never an imagined
  implementation; four blocker classes, each with an executed artifact: the
  contract asserts a false fact about the oracle (probe command + output +
  version) · scenario behavior no clause covers (cited line) · a RED does not
  fail now, or fails for another reason (run output) · a RED would pass with
  the scenario unimplemented (run output). Reasoning without an artifact is a
  concern. Final+GREEN: code exists and settles a mutant in one read; judge
  `pass` adversarially, bounded by the clause as declared.
- **REV-6 Premise.** Timing and reuse follow `docs/backlog/README.md`
  §Challenge. A premise objection (value does not follow / cheaper rival route)
  is a concern that goes to the user (`STOP-1`), never a blocker; a goal
  `rejected route:` line answers it by citation.
- **REV-7 Design.** Repeat: the same fault class at one boundary after a fix,
  or a review change adding a state owner → redesign/split at one chokepoint
  (`rules/fault-classes.md` §Class-kill), never a bigger mechanism for the
  same promise; when only a bigger one would hold it, trim the promise
  (`RDY-5`; an `I#`/scenario row → a `STOP-1` line, the run continues). A
  blocker, not a stall (`STOP-3`). External API:
  proxy/wrapper semantic copy requires an ADR + differential suite. Testing:
  the same scenario runs against reference and rifty; a fake cannot close
  acceptance. Approach cost: machinery the contract is deliverable without →
  blocker, ported/carried machinery included (a port re-states its forcing
  constraint); pure code shrinkage → goal residual or capture.
- **REV-8 One review record, bound to the result.** The driver adds
  `reviewed_sha` after a pass; the JSON is posted on the PR, referenced by the
  unit's `ready-verdict:` line or the ledger's `re-chart after …` line — the
  reference is not the proof. Evidence lives in the carrier and the verdict,
  never in a separate file; deleting the completed draft does not delete the
  review. A PR that changes product or test paths commits its landing verdict —
  the Final+GREEN of the delivered result (the CLOSE verdict of a goal, a
  standalone unit's own) — as
  `docs/backlog/<area>/reference/<slug|pr-N>-final-green.json`;
  `check:pass-binding` reads it at merge; any other PR keeps the JSON on the
  PR. Inside a goal the prior slice's sha is the next BASE. Fixes commit with
  their findings; the verify pass reviews the resulting tree.
- **REV-9 Closure.** Unit: current contract proof + empty unit residuals. Goal:
  no linked children + empty goal residuals + end-to-end proof of every
  invariant — never a source grep, a warning, a backlog record or one green
  slice.
- **REV-10 Rubric axes, in order.** Completeness · Mission and architecture ·
  Goal drift (amendments carry the user's decision, weakened user rows their
  fork, required preparation exists, required residuals visible) · Approach
  cost (`REV-7`) · Scope · Bugs · Regressions · Ecosystem UX (observable
  behavior matches real Node software). A correctness blocker names its fault
  class and the row it violates, cited `file:line`.
- **REV-11 Independence.** A fresh reviewer checks the promise when required
  and the delivered result, from raw evidence.
- **REV-12 Verify, disposition, route.** Read the authority, evidence and code
  before acting. An established `REV-2` violation is FIX; a concern/nit is
  NOTE. A new executed artifact can reopen PASS or REJECT; a repeated demand
  without new evidence cannot. Route the verified fact by obligation,
  regardless of who found it or when: required by the accepted result →
  current work and its root-cause fix; useful outside it → backlog if
  deferred, with owner/trigger; advisory → NOTE. Bot and reviewer comments on
  the PR are observations under this rule. After landing, a discovered
  violation starts its repair against that baseline. Inside authorized work
  continue without another user hand-off.

## Readiness rules (`RDY`)

- **RDY-1 When.** PICKUP identifies the accepted result and the missing
  evidence for any authorized change; a goal's children compile just in time.
  Never implement an unsettled promise: prepare it by `RDY-2`/`RDY-8` first.
- **RDY-2 Compile.** Exhaust code, ADR, real-Node and disposable-spike
  evidence; resolve internal choices yourself; ask only for an unresolved
  user-observable choice. Record scenario, acceptance, applicable parity/fault
  cases and their authority; an oracle claim carries command + output +
  version in the row or its carrier. Resolve a missing premise check
  (`docs/backlog/README.md` §Challenge) before adopting a plan; record
  `challenge: <date> — clear | N problems`. Then `RDY-8` preparation, set
  ready, `backlog:check`, continue.
- **RDY-3 Trace.** Every `## Acceptance` / `## Parity cases` / `## Fault
  matrix` row ends with `→ I3`, `→ scenario` or `→ ADR-NNNN`; the trace names
  why the row exists and holds only when the target states the property the
  row asserts. Trace targets are the only authorities a review may block on
  (`REV-2`). An untraced or rule-id-only row is a carrier note. Machine gate:
  `backlog:check` requires traces on ready items.
- **RDY-4 Size.** A ready unit is one intent its `title` states in one
  sentence; two intents are two units (`RDY-5`). Run state never lives in the
  contract: diagnoses and fork narratives go to the ledger (no goal: the PR
  body); `## Decisions`
  holds one-line records. Sufficient, not exhaustive: a clause the scenario
  does not need is a clause the reviewer will grade.
- **RDY-5 Re-cut.** The agent may trim, split, merge, re-order or demote rows at
  any time: one `re-cut: <date> — <what changed> — trace: none` line (a split
  successor names its predecessor; a successor carrying only rows and REDs
  already certified inherits: `ready-verdict: <date> — inherited from
  <predecessor> @ <sha>`). Dropping or weakening a row traced to `I#` or
  `scenario` is the user's (`STOP-1`): demote to `draft`, record the fork and
  the row verbatim, ask per `STOP-1`; the resolution lands as `re-cut:
  <date> — fork: <what> — trace: I#`. ADR-traced rows leave only with the ADR
  named. `check:contract-drift` enforces the records.
- **RDY-6 Authority and amendments.** The user owns observable scope; the
  agent owns carriers and implementation. Before claiming scope settled, check
  material assumptions against the original request and answers, not only the
  agent's scenario: walk the requested actions and reachable transitions; try
  two outcomes the words allow — a difference is a user fork only when it is
  reachable, materially affects the requested value and nothing accepted
  settles it; ask the informed frontier together; revisit dependent choices
  after an answer. A probe establishes behavior, not consent. An unanswered
  user question keeps the goal `draft`. Final written-result check: before a
  write-up (capture, refine, FIT) is complete, one fresh read-only reviewer
  reads the final draft set with the original request, the user's answers and
  the evidence; verify its findings by `REV-12`; material edits get a new pass;
  no approval of the report. Amendments: a user decision amends a ready goal in
  place — `amend: <date> — user: <their words> — <changed obligations and why>`
  — rechart dependencies, recheck changed promises (`RDY-8`), keep valid
  evidence. Silence, a technical failure, an ADR or a reviewer demand is not
  consent.
- **RDY-7 Reachability.** Own-product work without an external oracle needs a
  user-action repro path; without one record the attempt and keep `draft`.
  Inject only faults physically allowed by `rules/fault-classes.md` §Boundary
  failure models within the goal tier; raising tier requires an ADR.
- **RDY-8 Preparation follows missing evidence.** A new parity/stateful
  promise needs independent Contract+RED (reference behavior + discriminating
  REDs) then Final+GREEN. An observed defect already has a contract in real
  Node / the baseline: capture the artifact, execute its RED, fix the root
  cause, Final+GREEN. Proof for landed behavior reuses its accepted authority.
  Docs/CI/process/tooling need their relevant checks and Final+GREEN.

## Decisions (`DEC`) — decide, record, continue

- **DEC-1 Reversibility, first yes wins.** (1) Cross-package public API →
  ADR (a repo-only internal subpath with a shared consumer suite → backlog).
  (2) New external dependency → ADR. (3) Contradicts an ADR → `DEC-2`.
  (4) A contested policy/default affecting behavior or parity, or a data
  model/authority encoding external-system semantics (npm tree/bins/peers,
  Node identity; cites a pinned discriminating probe) → ADR. (5) Otherwise
  reversible: contract-stable → CHANGELOG line; provisional judgment → backlog
  item + `// TODO(backlog: <area>/<slug>)`. A mechanism choice is not an ADR
  by itself; `REV-7` challenges it at review and the CHANGELOG names it.
  Process decisions land here + a CHANGELOG line naming what they overturn.
- **DEC-2 Reconsidering.** A new decision or correction on a seam an ADR owns
  is a dated line under that ADR's `## Decisions` / `§Corrections`, edited in
  place; an ADR not yet on main is simply edited. Overturning an active
  ADR/dependency gets a critic (`DEC-5`) and a superseding ADR naming the
  overturned decisions: all overturned → remove the
  old ADR and add the old→new pointer in `docs/adr/README.md`; some → the old
  ADR stays active with a dated §Corrections note pointing at the successor.
- **DEC-3 Confirm-first.** Only publish, spend, delete user data. Everything
  else is pre-authorized; merge permission persists once given.
- **DEC-4 Subagents.** For independent research, review, verification and
  scoped implementation; leaves never spawn children; code-editing agents own
  disjoint files; the parent owns integration and final verification.
- **DEC-5 Fresh contexts.** Three: the independent reviewer at a checkpoint
  (`REV-11`); one critic — a disputed blocker, an overturned decision or the
  premise (`docs/backlog/README.md` §Challenge); the written-result check at
  the end of refine/FIT (`RDY-6`). Orchestrator, worker and runner are one
  driver across all stages: the session, or on Claude Code the `goal-run`
  script, whose stage leaves are fresh by construction and hand over through
  the journal (one read-only state leaf, because the script has no file
  access). No fresh agent for a journal line or a user-facing report. A
  decision leaves a session only through the journal
  (ledger line, verdict, `## Decisions` line), written before it can fall out
  of context.

## Stops (`STOP`)

- **STOP-1 The only user stop.** A choice only the user can make about the
  observable scope, tier or destination (including the premise). It is one
  line — `owner: user`, the executed probe or RED linked — in the map's `##
  Open questions` (a standalone unit: its `## Decisions`) and on the PR. The
  run continues on every wall the question does not block; the obligation
  stays unproven until the answer and nothing closes on it. A difference that
  exists only because of this branch's carrier is the agent's technical task
  (another carrier, `REV-7`), not a fork. A throw for behavior that real Node
  and rifty already perform is a fake (`AGENTS.md` §Fidelity), never a way to
  satisfy the letter of an invariant. A stop names what the user decides that
  the agent cannot; anything else is a status line.
- **STOP-3 Stall.** A FIX blocker surviving a fix + verify pass unchanged
  (same authority, same summary) is a stall → `STOP-4`, never another fix.
  Passes are not counted; a new real defect at a verify pass is the review
  doing its job, also of a recurring fault class (`REV-7` Repeat blocks the
  mechanism, not the bug). A blocker on a row the previous pass graded `pass` goes
  through reception like any finding.
- **STOP-4 Change the approach, keep the obligation.** Check the authority and
  diagnosis, trim unsupported demands, choose a materially different design or
  a discriminating probe; record what new fact can settle it. If that fact is
  not available yet, keep the obligation on the map with owner, dependency and
  trigger and continue independent work; revert unsafe partial changes, keep
  evidence. No executable approach left → report the technical limit and what
  would unblock it (`STOP-6`): a standalone unit does not land; a goal
  continues wherever it can.
- **STOP-6 Stop report.** One screen: what blocked (blockers with authority; a
  destination conflict quotes the exact clause), what was tried, the single
  question, the default if the user stays silent; the ledger gets a `stop:`
  line. A stop without a question is a status.

## PR (`PR`) — unit of delivery

- **PR-1** One PR = one reviewable delivered behavior: source, tests,
  packaging, documentation and the checking infrastructure it needs.
- **PR-2** Discoveries ride the work: required repairs in the current unit;
  useful work outside the result is recorded only if it waits. The discovering
  actor does not choose the route (`REV-12`).
- **PR-3** Packaging is the driver's: one draft PR per goal by default, opened
  at the first commit; combine or split for assessability; no PR per stage,
  discovery or retry.
- **PR-4** Independent criteria, not separate PRs: a change that touches a
  gate, oracle, test/lane configuration or process rule is reviewed against
  the old criterion, the proposed one and their evidence, in the same PR; a
  weaker test hiding a product defect is a Fidelity blocker. The reviewer reads
  the baseline rule from git.
- **PR-5** The user's requested packaging wins.
- **PR-6 DoD.** `AGENTS.md` §DoD: `pnpm pr:check` (locally the test lanes
  follow the diff since the origin/main merge-base; `--all`, or CI on every
  PR push that is not docs-only, runs the full set), real acceptance proof,
  root-cause repairs, package CHANGELOGs. `check:pass-binding` runs after
  final review, before merge and in ready-PR CI; it consumes the review, never
  turns a BLOCK into PASS. A product/test commit after `reviewed_sha` (a
  CI-red fix included) gets a verify pass and a re-bound verdict (`REV-8`).
  Done = merged on a green PR CI at HEAD: before reporting done or merging,
  the driver waits for `gh pr checks` at HEAD; a red lane → `rifty-fix`.
  `goal_complete` is the CLOSE reviewer's end-to-end claim.

## Artifacts

Shapes: `docs/backlog/TEMPLATE.md` (unit), `docs/backlog/epics/TEMPLATE.md`
(`goal.md`, `map.md` with `## Items` / `## Open questions` / `## Out of scope`,
`ledger.md` — append-only dated one-liners: `re-chart after …` per RECHART 4,
`stop:` per `STOP-6`). Verdict: `tools/review/review-schema.json`, validated by
`tools/review/blockers.mjs` (exit 0 accepted · 1 blocking findings / missing
coverage / residuals · 2 malformed); a unit with no contract names its PR and
observed baseline; required residuals block until proved or corrected.

## Machine gates

- `backlog:check`: schema, links, ready sections, trace, premise at pickup.
- `check:contract-drift`: changes to accepted scope carry their decision record.
- `tools/review/blockers.mjs`: the one verdict validator; coverage, a declared
  authority on every blocker, Fidelity rulings.
- `check:pass-binding`: the same validator plus the reviewed version at merge.
- `refs:check`: durable documentation links.

Machines validate records, never infer human authorization or prove reference
semantics from a filename. Independent review verifies both.
