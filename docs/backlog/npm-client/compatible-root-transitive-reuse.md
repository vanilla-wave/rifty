---
area: npm-client
status: draft
title: Ordinary compatible root reuse versus newer nested dependency
created: 2026-10-13
why: a newer nested icon version changed the frozen build workload although the explicitly pinned root version satisfies the transitive request
sources: [docs/backlog/distribution/reference/pr-341-ci-harness-repair-proof.json.gz]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/linker.ts]
---

## Context

PR341 actual child-fs program:root @gravity-ui/icons2.22.0,uikit7.48.1,
Vite7.3.6. Fresh Node24.16/npm11 install reuses rooticons2.22.0; current
COI/no-COI install instead retains root2.22.0 plus uikit-nested2.22.1.
Both Rifty installed-version maps match; their build outputs are byteequal,
but both transform2980 modules instead of earlier2180. Fresh native build
transforms2195. Actual locks/commands/output retained in the source artifact.
An ordinary visible npm override forces rootversion throughout this test's
workload; bothRifty return2180 and retain all original byte-parity assertions.
This fixes the test input; general resolver placement is not repaired.

Dedup:existing npm-11-peer-placement-authority owns four peer graphs; this
observed ordinary compatible-root case has no peer premise. No same draft or
declined concept found in npm-client backlog/ADR index. Not an obligation of
the completed evaluation goal or CI harness repair.

## Question

What npm11 traversal/placement authority should ordinary compatible-root reuse
follow, including nested resolution and lock replay? The actual observed case
is evidence; no generalized algorithm or coordination mechanism prescribed.
Owner:npm-client maintainer. Trigger:next ordinary-placement parity pickup or
before claiming identical native/Rifty installed graphs for these inputs.
