# Legacy `node:url` / `node:querystring` corpora (ADR-0574)

Inputs only; the oracle is live Node v24.16.0 running `program.cjs` over the same file.

- `url-calls.json` — every top-level `parse`/`format`/`resolve`/`resolveObject` call of Node
  v24.16.0's `test-url-parse-format.js`, `test-url-format.js`, `test-url-relative.js`,
  `test-url-parse-invalid-input.js`, `test-url-parse-query.js` with replayable arguments (1 314;
  the probe's 1 313 keyed `NaN` as `null`). A `Url` argument replays as `url.parse(href)`; calls
  with a WHATWG `URL` argument are skipped.
- `querystring-calls.json` — the same over `test-querystring*.js` (4 files). Function arguments
  replay from their source; objects as plain or null-prototype objects (a test's `qs.unescape`
  override is a parity case, not a corpus call).
- `hosts.json` — Unicode 17.0.0 `IdnaTestV2.txt` source column (sha256 in the file), then
  `probe-hosts.json` (the probe's 40 hosts + punycode/mapping corners), each as
  `url.parse('http://' + h + '/').hostname`.
- `codec.cjs` (argument encoding, record shape), `replay.cjs` + `program.cjs` (replay; CLI), `collect.cjs`
  (regenerate:
  `node --expose-internals collect.cjs <Node test/parallel dir> <Node lib/url.js> <IdnaTestV2.txt>`; sources via `docs/backlog/runtime-js/reference/url-legacy/fetch-node-src.mjs` plus the four querystring
  files).

IdnaTestV2 data: © Unicode, Inc., Unicode License v3 (https://www.unicode.org/license.txt). Node
test sources: MIT, © Node.js contributors.
