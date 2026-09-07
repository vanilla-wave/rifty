# Verdict — one model, one validator

Every independent review uses `tools/review/review-schema.json`:
`checkpoint` (`Contract+RED` or `Final+GREEN`), `unit_goal_source`, ordered
`axes`, `coverage`, `unit_residuals`, `goal_residuals`, `goal_complete`,
`overall_verdict`, `merge_call`. A unit with no contract names its PR and
observed baseline. It still supplies proof of any product claim.

One validator: `tools/review/blockers.mjs` `evaluateVerdict`. The CLI uses it
at review; `check:pass-binding` uses it again at merge. Exit 0 = accepted unit,
1 = blocking findings / missing coverage / required residuals, 2 = malformed
or unreadable evidence. Weak coverage stays advisory under `REV-4`.

`findings[].evidence` carries executed artifacts. Disputed blockers alone go
to a fresh critic; its rulings are embedded as `adjudication`:
`[{summary, ruling: HOLDS|STRETCH|FALSE, clause, by: critic}]`.
Fidelity rejects need FALSE with the discriminating carrier cited; an author
cannot reject its own blocker. The original reviewer evidence stays intact.
Required residuals remain blocking until independently proved or corrected;
rejecting a finding never erases an obligation.

After PASS the driver adds `reviewed_sha` (exact 40-hex commit) and saves the
same record as `reference/<slug|pr-N>-contract-red.json` or `…-final-green.json`.
The record's checkpoint, outcome, coverage and identity are validated together.
It survives deletion of the temporary unit doc. The merge gate reads a named
contract at the reviewed commit, never guesses its history from a deleted file.
Docs-only review records may live on the PR; no product landing artifact needed.

Eight axes: Completeness, Mission and architecture, Goal drift, Approach cost,
Scope, Bugs, Regressions, Ecosystem UX. Contract+RED grades the promise and RED;
Final+GREEN grades the implemented result, including required preparation.
