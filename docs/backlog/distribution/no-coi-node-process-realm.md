---
area: distribution
status: draft
title: "Each no-COI `node` invocation starts in its own JS realm"
created: 2026-11-18
why: every no-COI project-command / runBin `node` shares the toolchain Worker's one realm (ADR-0418 §5), so state one command leaves (guest globals, builtin-module patches, intrinsics, `process` properties) reaches the next; Node starts every process fresh
user_story: As an agent trying unpdf and then pdfjs-dist in one no-COI session, I want the second `node` to start clean, but today it reuses unpdf's `globalThis.pdfjsWorker` and fails with "API version 6.5.438 does not match the Worker version 6.4.299"
sources: [docs/adr/distribution/0418-no-coi-project-files-and-invocation-commands.md, docs/adr/distribution/0376-no-coi-toolchain-operation-lifecycle-authority.md, docs/adr/runtime-js/0539-serve-no-coi-child-filesystem-calls-through-service-worker.md, docs/public/compat/process.md]
code: [packages/workbench/src/workers/no-coi-project-command.ts, packages/workbench/src/workers/no-coi-toolchain-owner.ts, tests/no-coi/no-coi-shared-realm.spec.ts]
---

## Context

Measured in Chromium against live Node 24.16.0
(`tests/no-coi/no-coi-shared-realm.spec.ts`, declared in compat process.md
"Shared realm across no-COI `node` invocations"): a later `node` sees an
earlier command's globals (an `-e` `var` too), builtin-module members added
(`node:fs`, `node:module`) or replaced (`fs.readFile`, through `require` and
`import`), builtin-module state (`events.defaultMaxListeners`; a
`diagnostics_channel` subscriber runs in the later process), `Array.prototype`
additions and `process` properties; `process.env`, `require.cache`, the ESM
registry, process/stdio listeners and timers are per invocation. The `-e`/`-p`
`[eval]` bindings are restored at invocation end (PR #408), not by a fresh realm.

`executeNode` (`no-coi-project-command.ts`) and `runInstalledBin`
(`no-coi-toolchain-owner.ts`) run `runNodeEntry` in place. COI runs each `node`
in its own kernel Worker (ADR-0011). ADR-0418 §5 states no fresh-realm promise;
its "Per-call Worker" alternative was killed by ADR-0376 (shared file
authority). ADR-0539 later gave no-COI native child Workers their own loader,
process and globals over live owner files — only with a controlling rifty
Service Worker (§1, user decision).

Not routes (measured or by construction): restoring `globalThis` own properties
cannot undo builtin-module, prototype, `Symbol.for` or non-configurable
mutations; the toolchain Worker has no DOM for an iframe realm.

## Question

owner: user — may every no-COI `node` command require the rifty Service Worker
(a child Worker per invocation over ADR-0539), against ADR-0539 §1 «остальные
функции без SW сохраняются»? Answer → superseding ADR for ADR-0418 §4/§5 and its
"Per-call Worker" line, dated correction in ADR-0376.

Unmeasured before a design (owner: agent): per-invocation Worker boot and
sync-fs latency over XHR→SW; sync stdin (`fs.md` no-COI children ❌
`readFileSync(0)`) for piped commands; Stop and `startBin` semantics in a child;
Chromium `ShadowRealm` availability.
