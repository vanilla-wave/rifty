---
area: distribution
status: active
title: Public createSandbox → AI-agent sandbox contract + VFS snapshot/restore
created: 2026-06-11
why: the high-growth adoption surface for in-browser runtimes is the AI-agent execution backend; createSandbox half-matches the de-facto contract but exposes no FS-read and no snapshot/fork — the highest-EV M11 differentiator, browser-feasible, no shadow registry
sources: [M11, docs/research/open-webcontainers-alternative-2026-06.md, ADR-0071, ADR-0076]
code: [packages/rifty/src/sandbox.ts]
---

## Context

bolt.new / e2b / Cloudflare / CodeSandbox have made the AI-agent execution backend the dominant
embedding surface, with a de-facto contract: create → fs write/read → `exec` returning streamed
`{stdout,stderr,exitCode}` → server-ready / preview-URL → teardown + snapshot/fork. The public
`Sandbox` interface (ADR-0071, EPIC B) exposes write (`runtime.writeFile`) + dispose but no FS read
and no snapshot/restore. ADR-0076 already does a cross-realm reverse-VFS snapshot for the playground
explorer, but it is one-way / display-only / playground-private — not a public disk-state fork API.
Crucially, Cloudflare's GA fork is disk-state-only today, which a browser VFS can match exactly. This
is the highest-leverage, on-mission (no remote cloud, no shadow registry), browser-feasible M11 bet.

## Options or Next

- Decide the public contract: align `Sandbox` to create / write / read / `exec(stream)` / preview /
  teardown.
- Add VFS snapshot/restore (disk-state) as a public capability, distinct from ADR-0076's display-only
  mirror; decide the write-back path + realm-scoping (VFS is a cross-package singleton — ADR-0070).
- Sub-split if useful: FS-read in the public API; `exec` streaming shape; snapshot/restore.

## Reversibility

IRREVERSIBLE when taken up — expands the `@riftydev/sdk` public `Sandbox` API (reversibility rule 1).
Needs its own ADR recording the contract + snapshot semantics. Recorded here until then.
