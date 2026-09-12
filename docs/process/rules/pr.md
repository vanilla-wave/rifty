# PR — unit of delivery (`PR`)

## PR-1 One PR = one reviewable delivered behavior

A PR may carry source, its tests, dependency/packaging changes, documentation,
and the checking infrastructure needed to deliver that behavior. Scope follows
the accepted result, not the directory or type of file (`REV-12`).

## PR-2 Discoveries ride the work

Verified work required by the result is repaired in the current unit; update
its contract when needed. Useful work outside that result is recorded only if
it waits. Notes do not become tasks. The same rule applies before, during, and
after review (`REV-12`); the discovering actor does not choose the route.
A standalone request needs no invented backlog item or goal to carry it.

## PR-3 Packaging is the driver's

One draft PR per goal by default; combine or split when that makes the delivered
behavior easier to assess. No mandatory separate PR per stage, discovery,
referee, or retry. Open a draft at the first commit; keep its body aligned with
the delivered behavior. Merge permission persists (`DEC-3`). Goal slices are
reviewed against the prior accepted slice; splitting PRs does not change proof.

## PR-4 Independent criteria, not separate PRs

A change cannot weaken its own correctness criteria to manufacture GREEN.
When it changes a gate, oracle, test/lane configuration or process rule, the
independent reviewer compares the old criterion, the proposed criterion and
their evidence in the same PR. A legitimate criterion change is recorded with
its reason; a weaker test hiding a product defect is a Fidelity blocker.
The reviewer reads the baseline rule from git, not only the edited rule.
This applies by what changed, never by declaring every `package.json` a judge.
No path classifier dictates PR boundaries.

## PR-5 User-asked PR

The user's requested packaging wins. State what it delivers and continue;
never make the user argue with the process about its container.

## PR-6 DoD

`AGENTS.md` §DoD stays binding: `pnpm pr:check`, real acceptance proof,
root-cause repairs, package CHANGELOGs. Lanes follow the CI diff classifier.
A red `test:run` reruns failed files once in isolation, reporting timeout counts;
a reproducing failure stays red. A passing rerun is reported and its diagnosis
recorded if unresolved; no speculative repair or hidden retry loop.
`check:pass-binding` runs after final review, immediately before merge and in
ready-PR CI. It is not a pre-review `pr:check` lane: tests precede review;
binding consumes that review. It checks the reviewed version on a product/test PR;
it does not turn a correctly shaped BLOCK into PASS (`REV-8`).
