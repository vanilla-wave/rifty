# no-COI host-posture proof — 2026-09-04

Environment: Playwright 1.60.0, Chromium 148.0.7778.96. Headerless host
`127.0.0.1:5411`; second origin `127.0.0.1:5413`.

## Carrier

```sh
pnpm test:no-coi -g "host stays interactive while admitted install and run wait at network boundaries" --reporter=line
```

Restored tree: `1 passed (6.6s)`. The same document is sampled before boot,
while install is held, while run-bin is held and after completion. Each phase
proves live opener round-trip plus an image response from the second origin;
the server receipt records `Sec-Fetch-Mode: no-cors`, `Sec-Fetch-Site:
same-site` and `rifty_no_coi_sentinel=<page-token>`. Response headers omit
ACAO, CORP, COOP and COEP.

`pnpm typecheck`: 23/23 workspace projects PASS.
`pnpm test:no-coi --reporter=line`: 23/23 PASS in 1.9m.
`pnpm pr:check`: 24/24 PASS (`test:run` 222.8s, parity 79.0s).

## Mutant batch

Each mutation was applied alone, the carrier above executed, then the source
restored with `apply_patch`.

| mutation | result |
|---|---|
| resource receipt replaces the raw Cookie header with `null` | 1 failed at exact sentinel-cookie assertion |
| image response adds `Cross-Origin-Resource-Policy: cross-origin` | 1 failed at response-header absence assertion |
| harness substitutes `location.origin` for the configured second origin | 1 failed at bounded second-origin response wait |
| held install route continues before host checks | 1 failed because the carrier later performs the sole authorized release |

Final source restoration is certified by the restored-tree GREEN above.
