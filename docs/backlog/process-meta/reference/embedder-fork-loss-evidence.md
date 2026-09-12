# Embedder refinement lost observable choices

Investigation: 2026-09-07. Historical evidence, not a fresh product regression
run. Root session `01a0794e-7afe-7093-8244-6b52632c5164`, branch
`t3code/validate-embedder-gaps`; transcript timestamps below are UTC.

## Observed sequence

| Time / artifact | Observation |
|---|---|
| 17:59 user | Selected feedback 3, 6, 7, 4, 8, 5, 10 plus gzip. |
| 18:01–18:04 assistant | Existing gzip decoding passed; chose `.json.gz` interpretation. Reported only namespace migration and orphan recovery questions remaining. |
| 19:35 user | New namespace starts empty; orphan bytes retained for public download. |
| 19:39 user | Clarified ordinary archive, viewable without an extra tool. Compression proof had not established this intended action. |
| 19:41 assistant; 19:51 user | Proposed metadata beside payload; user required no collisions with user paths. |
| 19:53–19:57 critiques | Goal and seven children recorded clear; separate residual dedup critique found a value-claim problem. |
| 20:01 report | Declared no remaining critic concerns or user questions; ready goal, seven draft children, PR #316. |
| 20:06 user | Asked whether more user forks existed, pointing to file paths. |
| 20:11–20:15 audit | Found registry authentication scope and existing edited project on replacement snapshot; demoted goal. |
| 20:15 user | Registry authorization belongs to embedder environment. Requested explicit apply vs deployment-only modes; deployment-only default, persisted state wins. |
| 20:19 user | After dependent questions, chose general file-conflict policy: overwrite or stop with error, independent of dependency/package.json classification. |

Committed anchors, read with `git show` during this investigation:

- [Initial ready goal and evidence, 1f5a932fe](https://github.com/vanilla-wave/rifty/commit/1f5a932feefa6c0977af564f3f8720b5a9dd48c6):
  `map.md` said no observable-scope questions; I1 said configured registry;
  proof used a public Vite fixture and excluded private-package compatibility.
  Those statements did not settle whether the producer owns authentication.
- [Reopened scope, 56b301014](https://github.com/vanilla-wave/rifty/commit/56b30101481af4c0b6a2cbb1f350bce214d15f8e):
  same product baseline; F1/F2 recorded; goal demoted. Recorded real Memory VFS
  catalog probe changed snapshot identity after a user edit: `dirty:false`,
  `userFileExists:false`. Earlier reload proof kept identity unchanged.
  Probe was removed in that session; not rerun here, not proof of a fix.

## Cause and failed defenses

Raw input connection: the supplied embedder report's selected point 3 describes
runtime upgrades requiring rebaking and replacing snapshotId/static assets.
Its introduction describes an agent editing a persisted plugin project; point
13 reports lost edits on reopen (unconfirmed, and not selected as new scope).
Thus the redeploy/edited-project interaction was available to investigate;
this does not prescribe the user's later two-mode solution. The report does
not explicitly request authenticated registry support. F1 is an ambiguity to
classify against that context, not evidence of an omitted mandatory capability.

1. **Discovery closed too early.** Empty known frontier was treated as evidence
   of scope completeness. Research followed selected capabilities separately;
   edit/persist plus producer/redeploy was not examined as one transition.
2. **Mechanism mistaken for outcome.** Gzip decoding answered compression, not
   ordinary archive inspection. Archive layout looked internal, but collision
   handling affects admitted user paths. Names remain agent-owned; observable
   restrictions need an authority. Collision freedom may follow an existing
   fidelity/no-data-loss contract; that should be established before asking.
3. **Independent checking inherited the boundary.** At `1f5a932fe`, backlog
   Challenge explicitly gave critics the raw document and asked value/cheaper
   route questions. Clear verdicts did not establish that the document carried
   every user decision. More per-child critiques did not cover the missing
   cross-capability transition.
4. **Existing instructions lacked closure evidence.** Historical refine already
   required all independent forks; FIT step 3 already required every assumption
   explicit. Execution failed those requirements, but neither gave a concrete
   transition/counterexample check for concluding discovery. `backlog:check`
   validated record shape, not completeness. Later review mainly traces the
   declared contract; an omitted decision can remain invisible to that trace.

Current rules already improve early research/Challenge: refine now cycles
research with choices, and Challenge accepts user outcome, evidence and
alternatives rather than just a polished solution. Do not re-propose those as
missing. Remaining gap: independently checking omitted observable choices and
requiring evidence before asserting scope closure.

F1 was a missing question, not proof that private auth had to ship; the user's
answer excluded it. F2 exposed a material missing policy. Later conflict questions
depended on the new apply-mode choice and are legitimate refinement progress.
No finite checklist guarantees all future forks are known. The preventable
failure is unsupported closure of choices discoverable from current evidence.

## Investigation validation

2026-09-07: `pnpm pr:check` passed, docs-only 20/20. Source lanes skipped:
typecheck, build:libs, check:arch, test:run, test:parity. No product repair claimed.
Independent Final+GREEN at `bb10375d0`, reviewer `/root/review_investigation`:
PASS, no findings. Completeness, mission/architecture, goal drift, approach
cost, scope and bugs PASS; regressions/ecosystem UX N/A for this capture.
Reviewer inspected both documents, historical/current rules, committed anchors
and raw report; exact transcript times/later answers were checked by the driver.
Only this validation record was appended after that review. Prevention remains
a proposal; independent replay has not established its effectiveness.
