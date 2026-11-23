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
Residue a fresh realm would also remove (compat row): a non-configurable guest
`__dirname` left by one command makes a later `-e` exit 1 (`Cannot redefine
property`; the define-vs-assign difference itself is
`runtime-js/node-eval-bindings-assign-not-define`); after a guest claimed
`require`, a non-extensible `globalThis` stays and a later `-e` exits 1. The
invocation scope does not retire the `diagnostics_channel` subscriber above
(PR #408 outside finding 6).

2026-11-23, PR #421 external review round 4 (observed by the review, not
reproduced here): a guest listener on the Worker global
(`globalThis.addEventListener('error', …)` in one `project.run` command)
stays alive in later commands — their uncaught errors run it;
`unhandledrejection` listeners the same way (code reading). Same residue class;
the compat row's list does not name Worker-global listeners (this Context's
"listeners are per invocation" means `process`/stdio ones). Code reading
(ADR-0445 2026-11-23 rollback applied): a cancelling listener left by an earlier
command suppresses the browser's Worker error report of a later file entry's
uncaught throw, which then stays nonterminal (ADR-0340) — no report; `beginFatal`
already set `exitCode = 1`, so the final status and whether later timers run
are unprobed. Node v24.16.0 has no such listener at all:
`node -e "globalThis.addEventListener('error', () => {})"` → `TypeError:
globalThis.addEventListener is not a function`, exit 1 — command 1 itself has
no Node counterpart, so if `runtime-js/guest-browser-only-globals` hides the
API (its fork) this residue cannot arise. Open fork, owner: agent — scope
Worker-global listeners per invocation (as `process` listeners already are)
or leave them to this item's fresh-realm Question. Acceptance target: a
`no-coi-shared-realm.spec.ts` row — command 1 adds a logging, cancelling
`error` listener; command 2 `setTimeout(() => { throw new Error('x') })` as a
file → the report and status 1 of command 2 run alone in Node, the listener
never runs. Blocked by `distribution/no-coi-command-unhandled-rejection-exit`:
command 2 alone crashes the toolchain Worker today (no report, no status).
Cancel semantics inside one command:
`runtime-js/guest-unhandledrejection-prevent-default`.

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
