# Chromium 108: COI Workbench owner boot (2026-11-26)

Run by the node-streams carrier unit (PR #467), checkout = main `e430522e8` + the carrier's commits
(tests, CI matrix, docs; no product source). Browser: Playwright 1.28.1's `chromium-1033` = Chromium 108.0.5359.29, macOS arm64, driven by
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
