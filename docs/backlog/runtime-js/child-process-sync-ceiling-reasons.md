---
area: runtime-js
status: draft
title: "`child_process.spawnSync` / `execFileSync` ceilings name their working alternative or state there is none"
created: 2026-11-18
why: "Both throw a bare `Not implemented: child_process.<m>`, while async `spawn` / `execFile('node', …)` work in both tiers. PR #403 fixed this class for node:zlib: readers took the bare ceiling to mean the whole capability was absent"
sources: [docs/adr/runtime-js/0443-named-loud-builtin-members-for-linked-unsuppliable-edges.md, docs/public/compat/process.md]
code: [packages/runtime-js/src/builtins/loud-members.ts, packages/runtime-js/src/builtins/child_process-sync.ts, packages/runtime-js/src/ipc/handlers.ts]
---

## Context

This is a class sibling of PR #403 (node:zlib ceiling reasons), from the outside findings in its PR body.

The ceilings throw with no reason (`loud-members.ts:14` and `:18`). ADR-0443's
reason is that rifty has no sync-child protocol, and the execSync RPC carries
`node <script>` stdout only.

Rifty @ 39cf60307 (`runInRifty` probes, plain and SAB-modelled):
- Both members give the bare messages.
- `execSync` already carries a reason, and that reason is COI-only (`child_process-sync.ts:53`, `:73`).
- Async `spawn` / `execFile('node', …)` work in COI and no-COI: parity
  `child_process/exec-file` and `recursive-env` pass, and the no-COI spawn is
  asserted in `tests/no-coi/no-coi-sandbox-build-loop.spec.ts:1219`.
- Non-`node` executables exit with `spawn <cmd> ENOENT` / 127 in every tier
  (`child_process-exec.ts:138`).

Node v24.16.0: `spawnSync('node', ['show.js', 'two words'])` returns `status` 0
and stdout `["two words"]`. The execSync RPC splits argv on whitespace, with no quoting or
`$VAR` expansion (`handlers.ts:81`): `node show.js "two words"` →
`['"two', 'words"']`. It also has no `input`, which esbuild-wasm's `execFileSync`
needs.

Two docs are stale. `compat/process.md` says "`execFileSync` stays a link-time miss",
and `node-builtins-loud-stub-capability-gaps.md` lists it as absent. Both have been
false since 2026-10-20 (ADR-0443 correction; it throws `NotImplementedError` now).

The office-docs traces show 0 hits, so there is no observed demand.

## Question

What should the reason say?
- Async `execFile` / `spawn` for a `node` child; "none" for other executables.
- Should COI-only, argv-lossy `execSync` be named?
- One static string, or tier-dependent text (extra machinery, `REV-7`)?

Should `fs.statfsSync` / `process.memoryUsage` join (same class; their reason is likely "none")?

Owner: runtime-js. Trigger: a consumer or agent trace hitting these ceilings, or the next
loud-members unit.

Note: a reason string in a runtime-js builtin can rename hashed imports in the
typescript-worker and force an ADR-0391 SHA re-pin, as PR #403 did.
