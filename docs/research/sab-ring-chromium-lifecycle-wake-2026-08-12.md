# SAB ring Chromium lifecycle wake — raw capture (2026-08-12)

Forensic record for the webpack-dev-server failure reported after leaving the deployed playground
tab open. This is evidence, not a proposed fix. The retained carrier is opt-in and absent from CI:
`tests/diagnostics/sab-ring-chromium-lifecycle-wake.spec.mjs`.

## Reproduction

Captured artifact:

- PR head: `2a9d88dd40a6283f24d161973144b6b300affef9`.
- Browser: `HeadlessChrome/148.0.7778.96`, revision
  `8625e066febc721e015ea99842da12901eb7ed73`.
- V8: `14.8.178.14`.
- Real webpack starter: webpack `5.109.2`, webpack-dev-server `5.2.6`, Watchpack `2.5.2`.

Original disposable capture command:

```sh
pnpm exec playwright test --config .codex-sab-probe.config.ts --project=chromium
```

Retained carrier command (the deployed origin is deliberately env-owned):

```sh
RIFTY_SAB_DIAGNOSTIC_URL="$PREVIEW_URL" \
  pnpm exec playwright test --config tests/diagnostics/playwright.config.mjs
```

The carrier recursively auto-attaches CDP before child bootstrap, installs the wrapper below in
every attached realm, and arms the existing emitted `consumeReply()` throw branch. It then boots
the real webpack starter and cycles the page through 30 seconds frozen / 30 seconds active.

```js
const nativeWait = Atomics.wait;
Atomics.wait = function () {
  const result = Reflect.apply(nativeWait, Atomics, arguments);
  globalThis.__riftySabLastWaitResult = result;
  return result;
};
```

The wrapper calls native `Atomics.wait` exactly once and only stores its primitive result. It adds
no atomic load, notify, synthetic wake, result substitution, or application-byte change. In the
blocked worker no other JavaScript runs between this return and `waitReply()`'s existing guard.

## Raw decisive capture

```text
elapsedMs: 220089
phase: frozen cycle 4, elapsed 8960ms
targetId: 56899158E834EB328C63573EC54F8291
target type: worker
target script: quickjs-kernel-worker-host-B1ROhT3R.js
process.pid: 2
process.argv: ["rifty", "/node_modules/.bin/webpack", "serve"]
sync call: fs.stat
path: /node_modules/semver

native Atomics.wait result: ok
consumeReply pre-guard snapshot:
  header: version=3 req=handling rep=idle reqLen=0 repLen=0
existing authoritative guard branch: reply state was not ready (idle)
header at debugger breakpoint:
  header: version=3 req=handling rep=ready reqLen=0 repLen=75
raw header at debugger breakpoint: [3, 2, 1, 0, 75]

stack:
  consumeReply
  waitReply
  SyncRpcClient.call (fs.stat)
  KernelSyncApi.call
  SyncRpcFsSync.statSync
  ProjectTerminalFsSync.statSync
  Watchpack stat path
```

The first terminal line arrived 33 ms after the primary breakpoint:

```text
Watchpack Error (stats): Error: sync-rpc call 'fs.stat' failed:
SabRing: cannot writeRequest while a previous reply is unread
(header: version=3 req=handling rep=ready reqLen=0 repLen=75)
(previous call on this ring: 'fs.stat' (failed))
```

A separate uninstrumented run failed before LIVE at 29.527 seconds on `fs.readChunk`, leaving an
unread 18,472-byte reply. The family therefore is not Watchpack-specific; freezing the live tab is
the reproducible carrier for the reported Watchpack manifestation.

## Result

This selects `ok + idle` and excludes `not-equal`. The exact browser actor remains unidentified,
but the runtime boundary is settled: a host wake is input, while shared `REP_STATE=ready` is the
only proof that bytes are consumable. The repair may therefore re-check that predicate and wait
again without adding a protocol actor, RPC retry, lifecycle branch, or recovery state.

Disposable `.codex-sab-*`, downloaded bundles, and Playwright result files were removed after the
capture. Product sources were byte-unchanged.
