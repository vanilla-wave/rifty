# node-parity-runner

Golden-image harness: takes a "case" (setup + code + expected stdout), runs it both in real Node and in our runtime, diffs.

This is the **gold standard** described in PROJECT_PLAN.md §5.2 — every Node-compatible behaviour gets a parity case where practical. Cases drift toward the conformance suite when a behaviour is well understood; they stay here when we want a head-to-head against Node.

## Status (M0)

Skeleton — runner stub + a couple of smoke cases. Will gain real diff/output normalisation and an integration with the Vitest workspace in M3 alongside the first batch of built-in tests.
