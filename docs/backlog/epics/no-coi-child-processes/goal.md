---
kind: epic
status: ready
title: No-COI child processes run scripts that load node_modules
created: 2026-10-16
tier: works
value: A developer on a no-COI host (ADR-0375) runs npm CLIs that spawn a Node helper — first upstream esbuild-wasm's `spawn('node', bin/esbuild)` — as on Node, so the generated 0.28.0 esbuild client retained there (`esbuild-upstream-twin` I4) can be deleted.
user_story: As a developer on a no-COI SDK host, I want `require('esbuild-wasm').transform(...)` (and any CLI spawning `node <node_modules script>`) to work as on Node, but today the child falls back to same-realm execution and fails with `child_process.same-realm.require`
---

## Outcome

A no-COI `spawn('node', script)` child gets its own realm, module loader
and globals and can `require` the project's `node_modules`, with async stdio
pipes. Upstream esbuild-wasm's Node entry runs there; the generated
0.28.0 client and its adapter leave the no-COI execution and emitted boot graph.
The shared COI client remains owned by `epics/esbuild-upstream-twin`.

## User scenario

On a no-COI SDK host (`createSandbox({requireCrossOriginIsolation:false})`)
with an active rifty Service Worker:
`node -e "require('esbuild-wasm').transform('let x: number = 1',{loader:'ts'}).then(r=>console.log(r.code))"`
prints `let x = 1;` as real Node. A CLI spawning a Node helper from
`node_modules` uses its own globals/builtins, live project files and async
stdin/stdout/stderr. No COOP/COEP or SharedArrayBuffer is introduced.

## Invariants

Baseline: 2026-10-20, 3207b33ac; raw upstream esbuild acceptance reaches
same-realm shebang SyntaxError and missing child.unref; Node v24.16.0 prints
`let x = 1;`. Carriers: `tests/no-coi/no-coi-child-processes.spec.ts`.

- I1. Upstream esbuild-wasm's Node entry completes transform in a no-COI SDK sandbox with the same output as Node, without runtime package-byte adaptation.
- I2. A spawned Node helper has separate globals, builtin state and module loader; loads project node_modules; reads/writes the one live project VFS and exchanges async stdio as Node does.
- I3. No-COI execution and emitted boot graphs no longer load the generated esbuild 0.28.0 client or activate its adapter; no-COI adaptation debt is retired. The shared COI client remains for the separate upstream-twin goal.
- I4. No-COI child processes require an active rifty SW, with a loud named failure when unavailable; other SDK functions remain usable without SW.

## Challenge

challenge: 2026-10-20 — clear after user resolves the SW prerequisite.

Independent critic: sync XHR → SW → VFS owner is the simplest honest candidate;
SW is currently optional, so making it a child-process prerequisite needs a
user decision. Snapshot/mirror loses live filesystem semantics; OPFS mailbox
adds storage dependency and polling; QuickJS changes the guest engine and
WebAssembly boundary. Owner CPU work can delay child FS requests.

## Decisions

- amend: 2026-10-20 — user: «В этом ПР убрать legacy из no-COI; COI-клиент оставить до отдельной цели». I3 is explicitly no-COI retirement; shared COI source/artifacts remain. No dependency on PR #379.

- 2026-10-20 — user: «Да: child_processes требуют SW; остальные функции без SW сохраняются». SW is required only for no-COI child processes; unavailable transport never silently runs the child in the parent realm.
- 2026-10-20 — tier works: real happy-path parity; transport/Worker failures remain loud. No new fault-tolerance/retry promise.
- 2026-10-20 — one PR for the entire goal, per user request.
- rejected route: snapshot VFS or same-realm eval — violates I2.
- rejected route: retain generated esbuild client in no-COI — violates I3.
