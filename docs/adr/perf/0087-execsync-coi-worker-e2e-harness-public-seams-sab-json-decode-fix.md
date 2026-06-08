# ADR 0087: Honest execSync-over-SAB COI-Worker e2e — public handler seam + SAB JSON-frame decode fix

Status: Accepted
Date: 2026-06

> TL;DR: add two public runtime-js subpaths (exec-sync-handler + builtins/child_process), a hash-gated playground e2e harness asserting byte-exact stdout over real SAB v2-frame execSync, and fix decodeReply/decodeRequest to slice the shared-backed view before TextDecoder.decode

## Context

`execSync` only works in a KERNEL-SPAWNED Worker realm where the sync API is
published (`child_process-sync.ts`: `readKernelSyncApi() !== null` +
`isSabIpcSupported()` + `getKernelWorkerUrl() !== null`). The conformance suites
(`tests/conformance/builtins/exec-sync-worker.test.ts`) wire the kernel in NODE,
but `sabReady = isSabIpcSupported() && getKernelWorkerUrl() !== null` is FALSE in
Node (no kernel-worker URL), so the SAB-blocking path `skipIf(!sabReady)` —
SKIPPED. Their docstring says it "executes for real in the browser e2e harness
once the playground spins up a child"; that harness did not exist. So the real
path — real SharedArrayBuffer + `Atomics.waitAsync` dispatcher wake + ADR-0084 v2
binary frame — had never run.

Topology (`ipc/sync-dispatch.ts` §"runs in the realm that owns the kernel"): a
guest's `execSync` publishes a request into ITS SAB ring and `Atomics.wait`s; the
`'execSync'` handler runs in the realm that called `spawnWorker` (the PAGE realm),
which owns the singleton `getKernelDispatcher()` and services every child's ring.
The handler's recursive runner spawns a fresh child Worker for the script and
writes its stdout BYTES back on a v2 binary frame.

Two facts made the playground page unable to run a guest `execSync` end-to-end:
1. The page realm never `require`s `child_process`, so the lazy first-require
   handler install (`builtins/child_process.ts` → `ensureExecSyncHandlerInstalled`)
   never fires on the DISPATCHER-OWNING realm. `installRuntimeJsExecSyncHandler`
   lived only in `ipc/handlers.ts` (no public subpath).
2. A spawned guest realm has `getKernelWorkerUrl() === null` (`setKernelWorkerUrl`
   is page-realm-only, in `main.tsx`), so the guest's own `execSync` capability
   gate fails.

Building the honest harness surfaced a real browser-only bug: `decodeReply` /
`decodeRequest` (`ipc/sync-rpc.ts`) call `TextDecoder.decode(body)` on a `subarray`
VIEW into the ring's SAB (ADR-0084 #18 zero-copy view). Browsers reject a
shared-backed view (`TypeError: The provided ArrayBufferView value must not be
shared`); Node is lax. Every Node unit + conformance test passed, yet the JSON
frame path threw the first time it ran in a real cross-origin-isolated Worker.

## Decision

**1. Add two public runtime-js subpath exports (Reversibility rule 1 — public API
between packages → IRREVERSIBLE):**
- `@riftydev/runtime-js/ipc/exec-sync-handler` — re-exports
  `installRuntimeJsExecSyncHandler` (+ `ExecSyncPayload` / `ScriptResolver` /
  `InstallRuntimeJsExecSyncOptions`). A host that owns the dispatcher registers
  the `'execSync'` handler on `getKernelDispatcher()` explicitly.
- `@riftydev/runtime-js/builtins/child_process` — the real `node:child_process`
  surface (`execSync`/`spawn`/`exec`/`fork`), so a `kind:'url'` guest entry (no
  module loader, hence no `require`) calls the genuine `execSync` client without
  re-implementing the SAB gate.
  Both via `tools/publishing/sync-publish-config.mjs` `addExports` (dev `exports`
  → `./src`, published → `./dist`, ADR-0070).

**2. Build the harness in `apps/playground` (host layer), e2e-gated on
`location.hash` `#test=execsync`:**
- `src/execsync-harness.ts` (page realm): seed `/child.js` (writes raw
  `[0xff,0xfe,0x00]`) + `/blocked.js` into the page sync mirror, register the
  handler on the page dispatcher (resolver reads the page mirror — same
  source-of-truth split as the conformance test: parent writes script, parent
  resolver reads it), `spawnWorker` the guest, read its stdout, paint results to
  DOM testids.
- `src/workers/execsync-harness-guest.ts` (guest realm): re-publish the
  page-forwarded kernel-worker URL via env (so the `getKernelWorkerUrl()` gate
  passes — the value is used ONLY for the gate; the recursive child runs on the
  PAGE dispatcher), then `execSync('node /blocked.js')` + `execSync('node
  /child.js')`, emitting `out` hex.
- `main.tsx` runs the harness ONLY under the hash (lazy-imported chunk); normal
  boot is byte-unchanged.
- `tests/e2e/execsync-sab.spec.ts` (chromium only — webkit/firefox SAB+SW is the
  historical flake source): assert `hex === 'fffe00'` + the `blocked-result`
  round-trip.

**3. Fix the SAB JSON-frame decode (Reversibility rule 1 — kernel public IPC,
cross-package; IRREVERSIBLE):** `decodeReply` / `decodeRequest` copy the body out
of the (possibly shared) view via `.slice()` before `TextDecoder.decode`. Bodies
are small JSON (requests, `{ok,value|error}` / error replies); the binary frame
fast-path already copied and is byte-unchanged.

### Why the byte-exact non-UTF-8 hex is the honesty bar

`hex === 'fffe00'` is producible ONLY by the real SAB + v2 binary-frame round-trip:
a broken frame (JSON/TextDecoder round-trip) mangles non-UTF-8 to U+FFFD →
`efbfbd...`; a broken dispatcher (no `waitAsync` wake) hangs → the result node
never paints → the spec times out. A stub cannot fake `fffe00` without doing the
real byte-exact round-trip. The spec FAILS if execSync is broken.

### Options considered

- **A — public handler seam + host-layer harness (CHOSEN).** Reuses existing
  public kernel API (`spawnWorker` / `setKernelWorkerUrl` / `getKernelDispatcher`)
  + a thin runtime-js re-export of the EXISTING `installRuntimeJsExecSyncHandler`.
  No new mechanism — surfaces an existing one. Harness is e2e-gated, zero impact
  on normal playground behaviour.
- B — re-implement the execSync handler + recursive runner inside the harness
  (REJECTED). A silent fork of `ipc/handlers.ts` behaviour; drifts from the real
  path, defeating the point of an honest e2e.
- C — make the page realm `require('child_process')` to trigger the lazy install
  (REJECTED). The page has no module loader/`require`; and it would ship the
  install side-effect into normal boot for a test-only need.
- For the decode fix: copy-before-decode (CHOSEN) vs. construct a non-fatal
  TextDecoder per call (REJECTED — still rejects shared views) vs. relax the SAB
  view to a copy at the ring layer (REJECTED — gives up ADR-0084 #18 zero-copy on
  the hot binary path for a JSON-only need).

## Consequences

- The real execSync-over-SAB path is now exercised in CI (chromium e2e), closing
  the gap the conformance docstrings flagged.
- New public surface: two runtime-js subpaths kept in lockstep with their source
  modules (pinned by the harness + the existing `ipc/handlers.test.ts`).
- The SAB JSON-frame decode is now browser-correct on BOTH peers (client reply +
  dispatcher request). The binary fast-path is untouched; one extra small copy on
  the JSON path (errors + non-binary replies/requests) — negligible vs. the SAB
  round-trip it rides.
- The guest's `getKernelWorkerUrl()` gate is satisfied by an env-forwarded URL —
  documents that the gate is a "kernel-managed realm" capability check, not a
  per-realm spawn dependency.
- Normal playground boot is unchanged (harness behind `#test=execsync`, lazy
  chunk).
- Follow-up: if more hosts need guest execSync, the env-forward of the worker URL
  could move into the kernel spawn spec so the gate self-satisfies.

## Acceptance criteria

- [x] `tests/e2e/execsync-sab.spec.ts` (chromium) asserts `hex === 'fffe00'` (real
  byte-exact non-UTF-8 v2-frame round-trip) + a `blocked-result` blocking call.
- [x] Observed in a real chromium run: `hex === 'fffe00'`, harness
  `data-status="pass"`.
- [x] Full chromium e2e: 19 passed / 1 skipped (prior 18/1 hold + the new spec).
- [x] `ipc/sync-rpc.test.ts` regression: decodeReply (value + error) + decodeRequest
  over a SharedArrayBuffer-backed view.
- [x] kernel IPC units (38) + conformance (317 pass / 8 skip) + unit suite (699
  pass) green after the decode fix.
- [x] `pnpm typecheck` / `pnpm lint` / `pnpm check:deps` clean; no `any` /
  `@ts-ignore`; no test weakened; `sw.js` untouched; normal playground boot
  unchanged (harness e2e-gated).
- [x] New public subpaths via `sync-publish-config.mjs` `addExports` (dev-src /
  publish-dist split intact).
