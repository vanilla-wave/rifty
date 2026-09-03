# PR — unit of delivery (`PR`)

## PR-1 One PR = one reviewable delivered behavior

Never a workspace, hypothesis probe, or vehicle for process state.

## PR-2 Discoveries ride the branch

Everything the unit discovers commits into its branch: contract flips,
demotions, re-cuts, splits, intake drafts, lineage. A finding never opens a
second PR. Too small to review alone → rides with the next delivery.

## PR-3 Goal run

One draft PR per goal by default, opened by the first slice before its
review (at its Contract+RED pass, or at IMPLEMENT for a `review: ordinary`
unit), carrying every slice; never one per attempt; splitting into several
PRs is allowed, never required. The body names the goal and each carried slice's ledger band + rounds
row (`review.md` `REV-10` axis 5). Slices land serially — the next PICKUP waits
for the prior slice's Final+GREEN; with split PRs, never stack one on an
unmerged other. Merge is the goal PR's, at the end by default.

## PR-4 Separate-PR demands name their gate

A rule demanding a separate PR holds only if it names the gate forcing it.
Today one: `check:contract-drift` refuses an implementation diff that edits its
own referee (`tools/checks/contract-drift.mjs`, `tools/review/*`) — process
referees land separately.

## PR-5 User-asked PR

A PR the user explicitly asks for is their call: open it, name what it carries
(zero source, docs-only, process state), never refuse or re-litigate.

## PR-6 DoD

`AGENTS.md` §DoD is the checklist; `pnpm pr:check` is its machine half. Its
lanes follow the diff class (`tools/checks/ci-change-scope.mjs`, the CI
classifier): a docs-only tree never runs `typecheck`, `build:libs`,
`check:arch`, `test:run`, `test:parity`; a red `test:run` reruns its failed
files once in isolation, labelled with the time-out count — a failure that
reproduces in isolation stays red, a pass on rerun is reported, never hidden.
