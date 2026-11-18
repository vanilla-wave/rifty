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
   its manifest declares no dependencies, peer or optional dependencies; no
   `node_modules/isolated-vm` exists; under plain `node` with only `PATH` its
   root imports with exactly the runtime exports `IMPORT_GAP`,
   `UNCOPYABLE_REJECTION`, `createHostBridge`, `exitStatus`, the subpath
   `@riftydev/isolate-guest/guest.js` resolves to the bundle, and no `.node`
   shared object is loaded (`embedder.test.ts`) → I3
2. The README's first `js` block, saved as the consumer's `embed.mjs` beside
   the consumer's own `isolated-vm@7.0.2`, runs every isolate-host corpus row
   (`packages/isolate-host/tests/corpus.ts`) in one plain-node process; each
   `{stdout, stderr, exitCode}` equals the live `node -e` oracle under
   `parityView`, ceiling rows stay expected failures as in `runCode` parity
   (`embedder.test.ts`) → I1, I4
3. `createHostBridge` functions `write`, `timerStart`, `timerClear`,
   `random` accept each argument only when the contract allows it (matrix of
   24 hostile values per argument); a refusal is a `TypeError` starting
   `isolate-host bridge: ` with no host path in its stack; only valid calls
   reach the embedder hook (`host-bridge.test.ts`) → I5
4. A throwing embedder hook reaches the guest as
   `TypeError: isolate-host bridge: write failed`, no host path
   (`host-bridge.test.ts`) → I5
5. Timers fire by id (one-shot once, repeat repeatedly, cleared never);
   after `close()` an armed one-shot never fires and `timerStart` arms nothing
   (`host-bridge.test.ts`) → I5
6. `exitStatus` returns an integer 0..255 unchanged and 1 for every other
   value (hostile matrix, fractions, 256, objects, a promise)
   (`host-bridge.test.ts`) → I5
7. isolate-host `dist/guest.js` is byte-identical to the resolved
   `@riftydev/isolate-guest/guest.js` (`guest-export.test.ts`) → I2
8. Every pre-existing isolate-host test passes with its assertions unchanged
   (relocations allowed), `runCode` stays the host root's only export
   (`parity.test.ts`), and the packed host installs by its unchanged README
   steps (`packed-consumer.test.ts`) → I2

## Reference contract

- Oracle: `node -e <code>`, `process.execPath` of the test run (Node
  v24.16.0), `env: {}`, fresh temp cwd (`packages/isolate-host/tests/support.ts`).
- Mechanism: `canonicalNodeCliEvalOutcome` (tools/node-parity-runner) for
  uncaught-error rows only, via `parityView` (`tests/corpus.ts`).

## Out of scope

- isolated-vm 6.2.0 and other embedders (declared ceilings, goal §Outcome).

## Decisions
