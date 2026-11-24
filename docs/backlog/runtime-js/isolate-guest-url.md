---
area: runtime-js
status: draft
title: The isolate guest's `URL` and `URLSearchParams` are Node 24's, installed before the runtime loads
created: 2026-11-24
why: both are ceiling throwers in the guest, and runtime-js captured them as `undefined` at load — `pathToFileURL`, `import()` by `file:` URL, `createRequire('file:…')` leak `URLConstructor is not a constructor`
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/sources-native/README.md, docs/backlog/epics/isolate-guest-web-api/reference/seam-esm/README.md, docs/backlog/runtime-js/isolate-web-globals-captured-at-load.md]
code: [packages/isolate-guest/src/guest/web-shim.ts, packages/runtime-js/src/internal/posix-file-url.ts, packages/runtime-js/src/builtins/url.ts]
---

## Context

Probes 2026-11-24 (Node v24.16.0, bare isolated-vm 7.0.2 isolate): whatwg-url 15.1.0's parser
agrees with Node (ada) on 886/886 WPT `urltestdata.json` cases and 278/278 setters; its errors lack
Node's `ERR_INVALID_URL` code and `input` (275 cases), `new URLSearchParams(null)` gives `'null='`
(Node `''`) — Node's own JS wrapper (`lib/internal/url.js`) and `URLSearchParams` carry both. Cost:
402 KB unminified (tr46's table 272 KB), +3.8 ms per isolate eager, +0.8 ms with tr46 loaded on
the first non-`file:` parse (`file:` parse 0.6 ms, first http(s) 4.2 ms). whatwg-url 17.3.0 does not
load in the guest (`@exodus/bytes` constructs `TextDecoder('latin1')`, the guest has UTF-8 only).
core-js 3.51.0: 51 WPT differences. Host bridge: rejected (goal Decisions). With a real `URL`
installed before the runtime (`seam-esm` variant `url-first`), every `URL` row of the
captured-at-load table equals Node.

Host IDNA: whatwg-url's tr46 differs from Node's ada on 308/6 357 IdnaTestV2 17.0.0 hosts in
`new URL` (all Bidi; `reference/sources-native` §IDNA, `idna-url-host.cjs`), so the host step binds
a port of Node's `ada::idna` instead (tables 82–97 KB gzip, implementation thread's estimate; cost
is the goal's question 3); the WPT/setter numbers above are the parser's without that step.

Next: ADR (semantic copy of Node's wrapper over a pinned whatwg-url, `ada::idna` port shared with
`runtime-js/node-url-legacy-api-port` if its user choice is (d)), then the contract. Compat ❌ isolate-host.md ceiling row.
