---
area: distribution
status: draft
title: Isolate guest export acceptance carrier — packed export install, README embedder over the parity corpus, hostile bridge arguments, host bundle identity
created: 2026-11-18
why: First unit of goal isolate-guest-embed; the scenario must be executable and RED before the export exists.
epic: isolate-guest-embed
blocked_by: []
sources: [docs/backlog/epics/isolate-guest-embed/goal.md, docs/adr/distribution/0557-run-guest-code-in-a-disposable-child-process-holding-a-rifty-v8-isolate-isolated-vm.md]
code: [packages/isolate-guest/tests, packages/isolate-host/tests]
---

## Context

The goal's `## User scenario` as tests, vitest project `isolate-host` (global
setup = the real builds). Real packed tarball, real npm install, real
isolated-vm 7.0.2 installed by the test as the consumer's own, live `node -e`
oracle; no mocks. Committed with every case marked expected-failure
(`carrier = it.fails`); the export unit flips `carrier` to `it`.

## Challenge

challenge: 2026-11-18 — inherits the goal premise check (`goal.md` §Challenge)

## Acceptance

1. The packed `@riftydev/isolate-guest` installs alone into a clean project:
   its manifest declares no dependencies, peer or optional dependencies and no
   `preinstall`/`install`/`postinstall` script; the installed package holds no
   `*.node` file; no `node_modules/isolated-vm` exists; under plain `node`
   with only `PATH` its root imports with exactly the runtime exports
   `IMPORT_GAP`, `UNCOPYABLE_REJECTION`, `createHostBridge`, `exitStatus`, the
   subpath `@riftydev/isolate-guest/guest.js` resolves to the bundle, and no
   `.node` shared object is loaded (`embedder.test.ts`) → I3
2. The README's first `js` block is an ES module exporting
   `async run(code) → {stdout, stderr, exitCode}` that imports only
   `@riftydev/isolate-guest`, `@riftydev/isolate-guest/guest.js`,
   `isolated-vm` and `node:*`. Saved as the consumer's `embed.mjs` beside the
   consumer's own `isolated-vm@7.0.2` and run under
   `node --no-node-snapshot` (isolated-vm's own requirement) with only `PATH`,
   it runs every isolate-host corpus row (`packages/isolate-host/tests/corpus.ts`)
   in one process; each `{stdout, stderr, exitCode}` equals the live
   `node -e` oracle under `parityView`; ceiling rows stay expected failures as
   in `runCode` parity (`embedder.test.ts`) → I1, I4
3. Unhandled rejections with reasons isolated-vm cannot copy
   (`Promise.reject({ f() {} })`, `Promise.reject(Symbol())`) and a plain one
   (`Promise.reject(1)`) through the README embedder: stdout and status equal
   Node's (`embedder.test.ts`) → I1
4. `createHostBridge(hooks).functions` holds exactly `write`, `timerStart`,
   `timerClear`, `now`, `random`; each argument is accepted only when the
   contract allows it (24 hostile values per argument); a refusal is a
   `TypeError` starting `isolate-host bridge: ` with no host path in its
   stack; only valid calls reach the embedder hook; `now()` tracks the host
   clock (`host-bridge.test.ts`) → I5
5. A throwing `write` hook reaches the guest as
   `TypeError: isolate-host bridge: write failed`, no host path; a throwing
   `fire` hook (a disposed isolate) raises no uncaught host error and ends
   that timer (`host-bridge.test.ts`) → I5, scenario
6. Timers fire by id (one-shot once, repeat repeatedly, cleared never);
   `close()` removes every host timer of the bridge (active `Timeout` count),
   and after it `timerStart` is a no-op that arms and fires nothing
   (`host-bridge.test.ts`) → I5
7. `exitStatus` returns an integer 0..255 unchanged and 1 for every other
   value (hostile matrix, fractions, 256, objects, a promise)
   (`host-bridge.test.ts`) → I5
8. isolate-host `dist/guest.js` is byte-identical to the resolved
   `@riftydev/isolate-guest/guest.js` (`guest-export.test.ts`) → I2
9. Every pre-existing isolate-host test passes with its assertions unchanged
   (relocations allowed), `runCode` stays the host root's only export
   (`parity.test.ts`), and the packed host installs by its unchanged README
   steps (`packed-consumer.test.ts`) → I2
10. The export README documents, review-read: per bridge function
    (`write`, `timerStart`, `timerClear`, `now`, `random`, `timeOrigin`) and
    guest entry (`run`, `fire`, `rejection`) its arguments, who controls them
    and what the embedder must check; the call lifecycle; the two embedder
    hooks (`onUnhandledRejection`, `importModuleDynamically`) with what is lost
    without them; that time/heap/RSS/output limits, the kill, the process
    boundary and the isolate-escape posture are the embedder's; the tested
    isolated-vm 7.0.2 and the 6.2.0 / other-embedder ceilings; the unstable
    status and what it means for versions. `embedder.test.ts` pins that each
    name appears → I4, scenario

## Reference contract

- Oracle: `node -e <code>`, `process.execPath` of the test run (Node
  v24.16.0), `env: {}`, fresh temp cwd (`packages/isolate-host/tests/support.ts`).
- Mechanism: `canonicalNodeCliEvalOutcome` (tools/node-parity-runner) for
  uncaught-error rows only, via `parityView` (`tests/corpus.ts`).

## Out of scope

- isolated-vm 6.2.0 and other embedders (declared ceilings, goal §Outcome).

## Decisions
