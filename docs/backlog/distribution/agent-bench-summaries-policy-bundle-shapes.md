---
area: distribution
status: draft
title: "summaries-policy guard admits bundle-shaped .json.gz files under 8 MiB"
created: 2026-10-17
why: Independent review of PR #375 (round 3, C4) — a real workspace/source bundle renamed to `<name>.json.gz` and kept under 8 MiB passes the committed-summary guard that ADR-0532 relies on to keep campaign binaries out of git
sources: [docs/adr/distribution/0532-commit-evaluation-summaries-as-text-core-only.md, docs/backlog/distribution/reference/pr-375-final-green.json]
code: [tools/agent-bench/src/summaries-policy.test.ts]
---

## Context

ADR-0532 decision 1 names the text core (`report`, `statistics`, `summary`, `README`,
small PNG) and rejects `.zip`/`.part-NN`/`browser.*` and files above 8 MiB. The guard
checks suffix and size only: the reviewer's mutant (`/tmp/pr375-r3-summary-policy-mutant-source.json`,
a workspace archive and a `source-artifacts` bundle below 8 MiB) is admitted.

Pickup: an allow-list of the four text-core names (plus `*.png`) instead of a deny-list
of binary suffixes; RED with the reviewer's two bundle shapes. No new policy mechanism.
