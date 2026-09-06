# verdict — checkpoint output

Produced by a fresh reviewer (`review.md` `REV-11`) as `$RUN/verdict.json`
against `tools/review/review-schema.json`; evaluated by
`node tools/review/blockers.mjs verdict.json [adjudication.json]`.

| Field | Content |
|---|---|
| `checkpoint` | `Contract+RED` \| `Final+GREEN` |
| `unit_goal_source` | exact contract path + `BASE` used |
| `axes[]` | the 8 rubric axes in order (`REV-10`), each with `verdict` + `findings[]` |
| `findings[].severity` | `blocker` \| `concern` \| `nit` (`REV-3`) |
| `findings[].authority` | mandatory for blockers: `I#`, scenario line, traced row, `ADR-NNNN`, baseline, or a `REV-2`-listed rule |
| `coverage[]` | one row per traced obligation in boundary: `row, source, trace, status pass\|weak\|missing, citation, note` (`REV-4`) |
| `unit_residuals` / `goal_residuals` | slice blockers / goal continuation |
| `goal_complete` | true only with both residual sets empty + end-to-end proof |

`adjudication.json` (fresh critic, before any fixing): `[{"summary", "ruling":
"HOLDS|STRETCH|FALSE", "clause"}]` — HOLDS: the cited clause as written
requires the demand and the carrier is absent; STRETCH: clause broader than the
demand; FALSE: carrier exists / citation misread. Default STRETCH when the
clause text does not clearly mandate the specific demand.

Exit codes: `0` pass (`goal_complete:false` = continue the goal) · `1` FIX
findings remain — surviving blockers + `missing` rows (`weak` rows and
concerns never block; a row whose clause is the discrimination itself is
graded `missing` when the mutant survives, `REV-4`) — fix, verify
(`../stages/checkpoint-run.md`) · `2`
invalid verdict (retry once; twice = harness failure, the run ends with the
`STOP-6` report). Raw mode (no
adjudication): `unit_residuals` and an axis/overall `blocker` verdict also
block; adjudicated: residuals mirror the blockers and follow their rulings. A PASS binds to the reviewed commit through the boundary diff (`REV-8`); the reviewer never edits or pushes.
