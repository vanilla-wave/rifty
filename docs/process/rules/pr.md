# PR — unit of delivery (`PR`)

## PR-1 One PR = one reviewable delivered behavior

Never a workspace, hypothesis probe, or vehicle for process state. A draft
PR in flight may hold only process state while its unit waits on a stop; it
merges only with a delivery.

## PR-2 Discoveries ride the branch

Everything the unit discovers commits into its branch: contract flips,
demotions, re-cuts, splits, intake drafts, lineage. A finding never opens a
second PR. A change with nothing to trace (`readiness.md` `RDY-3`) — four
CHANGELOG lines, a docs fix, a defect fix, a CI rule — has no unit doc: it is
its own `review: ordinary` unit and its own PR (`RDY-8`); nothing is minted
for it, nothing is journaled beyond the PR, and nothing waits for "the next
delivery". A capture with no unit branch to ride (a post-merge audit) is such
a docs-only PR carrying the minted draft.

## PR-3 Draft PR at the first commit

A unit opens its draft PR at its first commit. Inside a goal one draft PR
carries every slice by default; never one per attempt; splitting into several
PRs is allowed, never required. The body names the goal and each carried
slice. Slices land serially — the next PICKUP waits for the prior slice's
PASS, its `BASE` (`review.md` `REV-8`); with split PRs, never stack one on an
unmerged other. Merge is the goal PR's, at the end by default, by the
driver (`decisions.md` `DEC-3`: pre-authorized once given).

## PR-4 Separate-PR demands name their gate

A rule demanding a separate PR holds only if it names the gate forcing it.
Today one: `check:contract-drift` refuses a diff that touches code (a
production path or a test) and edits anything outside the product, its tests
and parity cases (`tools/node-parity-runner/cases/**` — the RED that cannot
be faked rides with the change it proves), examples, deploy/perf, the backlog
and ADR docs, changelogs, lockfile and workspace/tsconfig structure — CI, the
gates, the parity oracle harness (`src/`), the process canon, agent
instructions, every lint/test/lane config (root or package-local `vitest`/
`playwright` configs and `package.json`s) judge the PR and land separately,
never as a "carrier" of the unit that needs them changed. An open rule: a new
judge is a referee by default.

## PR-5 User-asked PR

A PR the user explicitly asks for is their call: open it, name what it carries
(zero source, docs-only, process state), never refuse or re-litigate.

## PR-6 DoD

`AGENTS.md` §DoD is the checklist; `pnpm pr:check` is its machine half. Its
lanes follow the diff class (`tools/checks/ci-change-scope.mjs`, the CI
classifier): a docs-only tree never runs `typecheck`, `build:libs`,
`check:arch`, `test:run`, `test:parity`; a red `test:run` reruns its failed
files once in isolation, labelled with the time-out count — a failure that
reproduces in isolation stays red and is an observed defect (`rifty-fix`), a
pass on rerun is reported and captured (`rifty-to-backlog`, fault class
`concurrent-same-key` or host load — `fault-classes.md`), never hidden and
never declared a flake without a record. Merge has its own machine half:
`pnpm check:pass-binding` (`review.md` `REV-8`) on a PR marked ready.
