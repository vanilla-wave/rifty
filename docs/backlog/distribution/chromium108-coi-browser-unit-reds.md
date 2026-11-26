---
area: distribution
status: draft
title: On Chromium 108 the COI Workbench boots, but 49 of 424 browser-unit cases stay red (Vite 8 config, fetch bodies, Error clone, OPFS padded names, URL IDNA, hangs)
created: 2026-11-26
why: ADR-0469's Chrome floor is 108; after the owner-boot fix the COI lane runs there, and these reds are what a 108 user meets next (Vite 8 build, fetch multipart/Hono, a space-padded storage namespace)
user_story: As a user on Chrome 108, I want a Workbench project with a Vite 8 build and a Hono app, but today `vite build` fails loading its config and Hono's request body throws `… is not async iterable`
sources: [docs/backlog/distribution/reference/chromium108-browser-unit-reds.txt, docs/backlog/runtime-js/reference/chromium108-workbench-owner-boot-evidence.md, docs/public/compat/browsers.md, docs/adr/distribution/0469-browser-support-tiers-and-evidence-legend.md]
code: [packages/workbench/src/workers/workbench-owner-storage.ts, packages/vfs/src/boot.ts, packages/runtime-js/src/builtins/fetch/generated/classes.js, tests/browser-unit/workbench-storage-namespace.spec.ts]
---

## Context

Run: the whole COI browser-unit lane (`playwright.browser-unit.config.ts` + `use.launchOptions.executablePath`
= Playwright 1.28.1's `chromium-1033`, 108.0.5359.29, macOS arm64, driven by Playwright 1.60), 2026-11-26
08:58–10:04. Revision: PR #470 branch at `5e064a606` (owner-boot fix in); the dev server serves live
source and `message-port-ref.ts` changed during the run (`5b8acd5dd`, probe built from the load-time
`ArrayBuffer`; briefly the pre-fix `main` file during a parity check) — no red carries the owner-boot
error, but the lane was not re-run whole at a later head. 424 cases: 373 passed, 49 failed, 2 skipped. Command: `RIFTY_PLAYGROUND_PORT=5398 npx playwright test --config <copy> [spec]` (binary install: `docs/backlog/runtime-js/reference/chromium108-workbench-owner-boot-evidence.md` §Fix run).
First error line per red only: `reference/chromium108-browser-unit-reds.txt`. Ambiguous reds re-run in
isolation on 108 and on the workspace Chromium (148.0.7778.96 per `browser.version()` in this session).
"Green on 148" below = these specs are in the gating CI browser-unit lane; not re-checked here per spec.
Feature versions cited from MDN BCD from memory, not re-read in this run (except `detached`, BCD 8.1.8).

Product, 108-specific (exact error, spec):

1. Vite 8: `failed to load config from /home/project/vite.config.js` ← rolldown wasm
   `Error: Failed to construct 'URL': Invalid URL` (`aggregateBindingErrorsIntoJsError`, via
   `napi_create_error`) — `esbuild-vite-contract` base `"./"` ×2, `project-location` ×2,
   `vite-build-failure-containment`, `vite-cli-upstream-bytes`. The URL input not isolated.
2. Async iteration of a WHATWG `ReadableStream` (Chrome 124): `TypeError: yield* (intermediate value)…
   is not async iterable` at `runtime-js/src/builtins/fetch/generated/classes.js:14`, `stream is not async
   iterable`, `request.body is not async iterable`, `.stream(...) … not async iterable` —
   `node-fetch-guest` ×2 (Hono, multipart, `clone-direct-stream`, `multipart-request-stream`),
   `host-async-keepalive` ×2 (`response-formdata-order`, `request-formdata-consumer`,
   `request-copy-formdata-consumer`, `blob-stream-async-iterator`, FormData-with-File).
3. `structuredClone` of Errors differs from Node: `clone-error-cause` accepted (Node `DataCloneError`),
   `clone-error-own-prop` `DataCloneError` (Node accepted), `clone-error-cycle`
   `TypeError: Cannot read properties of null (reading 'cause')` (Node accepted) — `node-fetch-guest:50`.
4. `(intermediate value).bytes is not a function` — the guest's `Blob#bytes()` (Node 24 has it;
   Chrome 132): `host-async-keepalive` blob-bytes row.
5. `node:url` legacy hosts: `399 rows off (358 pinned on Chromium 148.0.7778.96)`, e.g. rifty `fass.de`
   where Node gives `xn--fa-hia.de`; also `patched-intrinsics-idna` (`url-legacy`). Inferred: host IDNA
   follows the engine's URL parser.
6. OPFS `TypeError: Name is not allowed.` for a storage namespace with leading/trailing spaces
   (`' owner-A '`): `workbench-storage-namespace` — `preferred` runs memory-backed with
   `fallback.reason: "Name is not allowed."` (observed); `required` fails at that open with
   `Workspace owner startup and cleanup failed` — that its cause is the same OPFS refusal is
   inferred, not observed (the aggregate was not flattened); the default namespace under `required`
   opens durable on 108. The namespace reaches `getDirectoryHandle` as given
   (`workbench-owner-storage.ts:70`, `vfs/src/boot.ts:91`); which call throws not isolated. Same engine
   refusal in the orphan-scratch fixture's own setup (namespace `' recovery-A '`, raw OPFS, not the
   product path): `workbench-orphan-scratch-recovery` ×17, an 18th at owner startup, cause not flattened.
7. Hang, `owner-node-process-lifecycle` (all its `processLifecycleCases` as `node` lines on one
   Workbench owner); product vs harness not isolated. Probe at `daf92cd01` (same cases in order, each
   `terminal.run` raced against a 20 s page timer, `terminal.close()` against 30 s; output in
   `runtime-js/reference/chromium108-workbench-owner-boot-evidence.md` §Lifecycle sequence probe):
   the first 24 cases each exit (199–417 ms) and close in ≤ 1 ms (`exit-listener-timer` included:
   `exit 0 214ms closed 0ms`); at the 25th, `fatal-rejection`, the `page.evaluate` does not return
   before the 900 s test timeout. Inferred, not observed: the page stops answering (neither page timer
   resolved the race); a lost Playwright 1.60 ↔ Chromium 108 channel is not excluded.
   `fatal-rejection` alone on a fresh owner: 108 `exit 1 218ms closed 1ms`, 148 `exit 1 199ms closed 1ms`.
   Whole spec green on the local 148 re-run. Repro: the spec on 108. Which earlier case leaves the
   state, and what blocks, not isolated.
8. Hangs, root unisolated, reproduced in an isolated 108 re-run, green on the local 148 re-run:
   `workbench-vite-lifecycle` (300 s), `esbuild-upstream-twin` esbuild-wasm 0.21.5/0.25.12/0.28.2
   (page closed after timeout).
9. Message/stack text: `zlib-scenario` step 2 (unzipper 0.10.14, pinned) frame
   `at Async.drainQueues [as _onImmediate]`; `node-file-parity` `rethrow-in-catch` — the `JSON.parse`
   message lacks Node's `(line 1 column 2)`. Inferred: V8 108 text.

Guest programs that use a post-108 builtin (the program itself throws or differs):
`advanced-ipc` values — `ReferenceError: Float16Array is not defined` (then `timedOut`);
`node-file-parity` `fs-write-view-bytes-intrinsics` — `TypeError: a.transfer is not a function`
(`ArrayBuffer#transfer`, Chrome 114); `node-file-parity` `events-add-abort-listener` —
`keys=undefined` where Node prints `Symbol(Symbol.dispose)` (observed instance of
`runtime-js/guest-symbol-dispose-below-chromium-125`).

Not product, or not 108-specific:
- `child-fs-in-realm-lane`, `child-fs-product-lane`: `TypeError: … toSorted is not a function` in their
  fixtures (Chrome 110); their `.fault` specs fail on deep-equality (`posts: 0`, `rejected: false`) —
  inferred the same (`toSorted` in `fixtures/child-fs-*.ts` and `child-fs-in-realm-lane.fault.spec.ts:171`);
- `child-fs-orchestrator-cli` launches its own browser (`browserVersion: 148.0.7778.96`);
- `agent-core` ×2 (`Execution context was destroyed`) passed on the isolated 108 re-run — unclassified flake;
- `esbuild-upstream-twin` native ×3 (TTY spinner frame `⠙` missing) red on the local 148 re-run too —
  cause unclassified, not 108-specific.

Not measured: Chromium 109–112 (113.0.5672.53, Playwright 1.33.0's `chromium-1060` per its `--version`,
ran only `message-port-ref-keepalive{,.fault}` 11/11 and `streams-scenario` 21 + 1 declared skip); the
no-COI lane on 108 (SDK import fails first, `runtime-js/chromium108-sdk-sync-wasm-import`); Edge; Linux.

Related: the node-streams epic's unit 8 floor APIs (`epics/node-streams-as-in-node/map.md`).

Open:
- per item, rifty defect to repair at the floor or engine ceiling to declare (compat ⚠/❌ with
  reason) — the user's call against ADR-0469;
- the rolldown URL input (1), the throwing OPFS call (6), the hang causes (7, 8).
