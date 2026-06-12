---
area: distribution
status: parked
title: Residual AI-agent sandbox snapshot/restore/fork API
created: 2026-06-11
why: ADR-0131 landed the public Worker-backed read/write FS slice; disk-state snapshot/restore/fork remains separate and needs its own public semantics
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0071, ADR-0076, ADR-0131]
code: [packages/rifty/src/sandbox.ts, packages/runtime-js/src/host.ts]
---

## Context

AI-agent execution backends commonly expose teardown + snapshot/fork. ADR-0131
lands only `sandbox.fs.readFile/writeFile`, backed by Worker RPC. Public
snapshot/restore/fork is still unresolved: ADR-0076's playground reverse mirror
is display-only and not a public disk-state API.

## Options or Next

- Decide disk-state-only vs process-state snapshot semantics.
- Decide snapshot format, quota posture, and restore overwrite/merge behavior.
- Decide whether fork means new Worker over copied VFS state or same realm with
  explicit restore.

## Reversibility

IRREVERSIBLE when taken up — expands public `Sandbox` API. Needs its own ADR.
