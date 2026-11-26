# Chromium 108: COI Workbench owner boot (2026-11-26)

Run by the node-streams carrier unit (PR #467), checkout = main `e430522e8` + the carrier's commits up to
`1c200d7ef` (tests, CI matrix, docs; no product source). Browser: Playwright 1.28.1's `chromium-1033` = Chromium 108.0.5359.29, macOS arm64, driven by
the workspace's Playwright 1.60 (`use.launchOptions.executablePath`), COI dev server of
`playwright.browser-unit.config.ts`.

Commands (config = `playwright.browser-unit.config.ts` with that `executablePath`, a throwaway copy):

```sh
RIFTY_PLAYGROUND_PORT=5399 npx playwright test --config <copy> tests/browser-unit/streams-scenario.spec.ts
```

21/21 run cases fail at `bootOwner` with `AggregateError: Workspace owner startup and cleanup failed`
(`packages/workbench/src/workbench/workbench-owner-port.ts`; stack lines below are the dev server's transformed lines). A one-test probe with
`attemptBootOwner(page, { workspaceId: 'bu-108', template: 'hidden-empty', persistence: 'ephemeral' })`
flattens the causes:

```
108.0.5359.29 {
 "ok": false,
 "messages": [
  "Workspace owner startup and cleanup failed",
  "Workbench owner exited unexpectedly (code 1, signal null)\nError: message-port-ref: no native detached getter\n    at nativeGetter (http://localhost:5399/@fs/<checkout>/packages/runtime-js/src/internal/message-port-ref.ts:35:29)"
 ]
}
```

The same carrier's SDK cases on that build (no-COI, `playwright.no-coi.config.ts` copy): 22/22 fail at
SDK import with the known `RangeError: WebAssembly.Compile is disallowed on the main thread, if the
buffer size is larger than 4KB` (`runtime-js/chromium108-sdk-sync-wasm-import`).

## Fix run (PR #470, 2026-11-26)

Same browser binary (Playwright 1.28.1 `chromium-1033` = 108.0.5359.29, macOS arm64, driven by Playwright 1.60),
installed as `tools/floor-lane/run.mjs` does (`npm install --prefix <dir> playwright@1.28.1`, then
`PLAYWRIGHT_BROWSERS_PATH=<dir>/browsers npx node@18.20.8 <dir>/node_modules/playwright/cli.js install chromium`).
Throwaway config = `playwright.browser-unit.config.ts` spread with `use.launchOptions.executablePath`:

```sh
RIFTY_PLAYGROUND_PORT=5398 npx playwright test --config <copy> tests/browser-unit/message-port-ref-keepalive.fault.spec.ts
```

- RED, branch at `87a8c76a7` (fault spec boots via `attemptBootOwner`, product untouched): 2/2 failed,
  `"Workspace owner startup and cleanup failed"`, `"Workbench owner exited unexpectedly (code 1, signal null)\nError: message-port-ref: no native detached getter"`.
- GREEN, `3b4cbbe49` (probe = 1-byte fixed-length buffer, native `byteLength` 0 ⇔ detached):
  `message-port-ref-keepalive{,.fault}.spec.ts` 10/10 on 108 (incl. the vite 8 rolldown/emnapi
  `worker_threads` case: owner, `node` child and Worker realms all install); 10/10 on 148.0.7778.96.
  `streams-scenario.spec.ts` on 108: 21 passed, 1 declared skip (`c-transform-big`, 4c) — was 21/21 failing at `bootOwner`.
- Mutant (verdict `=== -1`, i.e. never detached) on 148: `transfers that would hide a referenced port release fail by name`
  red, `PORT|ref-peer-transferred=no-throw`.

Predicate domain, raw getters on 148 / 108 / 113 (page realm, no COI so no `SharedArrayBuffer`):

| Buffer | 148 `detached` | 148 `byteLength` | 108 / 113 `byteLength` |
|---|---|---|---|
| fixed 1 B | false | 1 | 1 |
| fixed 1 B, `structuredClone` transfer | true | 0 | 0 |
| fixed 1 B, `postMessage` with a port | true | 0 | 0 |
| fixed 1 B, `postMessage` with a closed port | true | 0 | 0 |
| resizable, length 0 | false | 0 | 113: 0; 108: no resizable |

`byteLength === 0` is not a general detach test (last row); it is used only on the module's own probe,
built from the load-time `ArrayBuffer` (case `transfer-ignores-guest-array-buffer`: Node constructs no
guest-replaced `ArrayBuffer` on a port transfer; rifty constructed one before `5b8acd5dd`).

Same-class sweep (string-named reach of a post-108 feature, `packages/*/src`, `apps/playground/src`):
`message-port-ref.ts` `ArrayBuffer.prototype.detached` (fixed); `isolate-guest/src/guest/node-blob/byte-store.ts:26`
`ArrayBuffer.prototype.transfer` via `getOwnPropertyDescriptor(...)?.value`, every use under `!== undefined`,
copy fallback, isolate guest (Node's V8), not on a browser boot path — admitted by the extended `check:es-floor`.
Every other by-name read in the tree names a pre-108 member (`byteLength`, `onmessage`, `port1/2`, `locked`,
`bodyUsed`, `Atomics.*` …). Mutant: the pre-fix dist (`nativeGetter(ArrayBuffer.prototype, "detached")`) →
`check:es-floor` red at `runtime-js/dist/chunk-*.js` and `workbench/dist/assets/chunk-*.js`
(`ArrayBuffer.prototype.detached (by name)`); unit mutant on the real source in `tools/checks/es-floor.test.ts`.
