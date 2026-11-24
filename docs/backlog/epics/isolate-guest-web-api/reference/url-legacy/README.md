# Probe: rifty's legacy `node:url` against Node v24.16.0

Question (manager, goal `isolate-guest-web-api` question 5): in the isolate `url.parse` and
`url.resolve` return wrong values with no error. Is the fix a real port of Node's legacy API on
every host, or a loud named gap? Measured 2026-11-24 at `origin/main` 1c00c6292, Node v24.16.0,
darwin-arm64. Contract: `docs/backlog/runtime-js/node-url-legacy-api-port.md`.

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
P=docs/backlog/epics/isolate-guest-web-api/reference/url-legacy
# Node sources (lib + url tests) into a scratch dir; only needed to regenerate cases.json
node $P/fetch-node-src.mjs https://raw.githubusercontent.com/nodejs/node/v24.16.0 /tmp/node-src
node $P/collect.cjs /tmp/node-src $P/cases.json          # 1 313 calls + live Node's results
node $P/compare.mjs --json $P/results.json               # isolate + "URL present" lanes vs Node
# IDNA: tr46 vs Node's toASCII (tr46 installed in a scratch dir)
mkdir /tmp/t && (cd /tmp/t && npm init -y && npm i tr46@6.0.0) && node $P/idna.cjs /tmp/t
# user scenario (parseurl 1.3.3 in a scratch dir)
mkdir /tmp/p && (cd /tmp/p && npm init -y && npm i parseurl@1.3.3) && node $P/scenario.mjs /tmp/p
```

`collect.cjs` runs Node's own url tests with a recording `url` (their asserts run against real
Node and pass) and keeps every top-level `parse`/`format`/`resolve`/`resolveObject` call with
JSON-representable arguments. A legacy `Url` argument replays as `url.parse(href)`, and calls with
a WHATWG `URL` argument are skipped. Each record (`normalize.cjs`) holds own keys in order, values,
prototype name, or the thrown `name`/`code`/`message`. Lanes: (a) the isolate guest bundle
(`runCode`), where `URL` is absent when the runtime loads; (b) `packages/runtime-js/src/builtins/url.ts`
bundled by esbuild and loaded in Node, whose global `URL` stands in for the browser hosts' native one.

## Result

`results-compare.txt`, `results.json` (examples per function):

| lane | total | parse | format | resolve | resolveObject |
|---|---|---|---|---|---|
| isolate | 1 037/1 313 | 436/436 | 177/431 | 201/223 | 223/223 (function absent) |
| URL present | 904/1 313 | 436/436 (226 ignoring prototype, absent keys and `path`) | 187/431 | 58/223 | 223/223 |

- parse: rifty returns a plain object without `path` and with `undefined` keys, where Node returns
  a `Url` with 12 keys and `null`. In the isolate every call takes the regex fallback (no
  `auth`/`hostname`/`port`).
- resolve with a path-only base is wrong on every host (`resolve('/foo/bar/baz', 'quux')` →
  `'quux'`, Node `/foo/bar/quux`). In the isolate every resolve with an absolute base returns the
  relative part.
- format(string) throws `o.search.startsWith is not a function` on every host.
- Warnings: Node prints DEP0169 once per process for a call whose first non-`node:` frame is
  outside `node_modules` (`isInsideNodeModules(4)`, `src/node_util.cc`). A call from
  `node_modules` does not set the once-flag, so a later user call still warns. DEP0170 is printed
  once for an invalid port (`http://a.com:xx/`). rifty prints neither. Measured with live node.
- `querystring`: rifty differs from Node on `parse('=x&&y=')` (rifty `{"":["x",""]}`, Node `{"":"x"}`)
  and `unescape('%41%zz+')` (rifty leaves `%41`). Ad-hoc run, not in `results.json`.
- IDNA (`results-idna.txt`, rerun 2026-11-24 after the critic): `tr46` 6.0.0 (Unicode 17.0 = Node
  v24.16.0's ada 3.4.4) with `checkBidi:false, checkJoiners:true, checkHyphens:false,
  useSTD3ASCIIRules:false, transitionalProcessing:false, verifyDNSLength:false` equals Node on
  40/40 hostnames; 5.1.1 (Unicode 16) differs on the 5 Unicode-17 letters. With `checkBidi:true` 1 differs (`aא.com`); with `checkJoiners:false` 1 differs
  (`a‍b.com`). Size: esbuild minified IIFE of `tr46` 6.0.0 + `punycode`, 241 481 B, 62 038 B gzip (5.1.1: 238 909 / 61 455).
- Scenario (`results-scenario.json`): 4 of 5 stdout lines wrong in the sandbox and no DEP0169;
  the parseurl line matches by accident (the fallback's `host`).
- Node's sources: `lib/url.js` 1 049 lines. Native code is `toASCII` (encoding_binding, ada::idna,
  every hostname that is not IPv6, ASCII included: `xn--` labels are validated) and
  `isInsideNodeModules`. `internal/url` provides only the re-exported WHATWG members and
  `format(URL)` (`bindingUrl.format`). `lib/querystring.js` (484 lines) and `internal/querystring.js`
  (119) are JS over `Buffer`.
- Callers that ship today (code reading of the published tarballs): parseurl 1.3.3 `url.parse`
  (Express' parser), node-fetch 2.7.0 `Url.parse`/`Url.format`, request 2.88.2
  `url.parse`/`resolve`/`format`, http-proxy 1.18.1 `url.parse`. In the repo's own `node_modules`:
  dependency-cruiser, simple-get, vite.

Verdict: port (I), not a gap (II). (II) would throw for behaviour Node delivers without `URL`
(AGENTS.md "No throw for working behavior"). It would also leave the browser hosts' 904 wrong
results, and today's browser IDNA case (`ñ.com`) that works would regress.

## ADR draft (first step of the unit; `pnpm adr:new runtime-js "…"`)

Title: generate rifty's legacy `node:url` and `node:querystring` from pinned Node sources.

1. Pin Node v24.16.0. Vendor the upstream text of the legacy part of `lib/url.js` (`Url`,
   `urlParse`, `urlFormat` for a string or legacy object, `urlResolve`, `urlResolveObject`,
   `Url.prototype.*`), `lib/querystring.js` and `lib/internal/querystring.js`, with the MIT notice.
   A generator with checked edit anchors writes them to a `generated/` dir, and
   `check:legacy-url-drift` checks the committed output (the ADR-0541 pattern). Portability edits
   only bind inputs; parsing, formatting, resolution and escaping stay upstream's.
2. Bindings: `primordials` → intrinsics captured at load; `ERR_*` → rifty's Node errors with the same
   code, class and message; validators → rifty's; `toASCII` → `tr46` 6.0.0 (exact pin, bundled,
   evaluated on the first non-ASCII or `xn--` label) with the flags above; `isInsideNodeModules(4)`
   → Node's window as stated in the contract's Reference contract; `instanceof URL` → the
   runtime's `URL` if any. `URL`, `fileURLToPath`, `pathToFileURL`, `URLPattern` keep rifty's
   current members; `domainTo*`, `urlToHttpOptions` and output-changing `format(URL, options)`
   become named gaps (contract Acceptance 9).
3. Differential suites: `cases.json` (regenerated by `collect.cjs` at a re-pin), Unicode
   IdnaTestV2 hostnames, and the `test-querystring*.js` calls, each against live Node, in the isolate
   guest and in runtime-js with and without a global `URL`.
4. Alternatives rejected. A hand TS port: the same semantic copy without a drift check, and
   `lib/url.js` would have to be split under the 800-line cap. A named isolate gap: see the verdict.
   Native `URL` for IDNA on the browser hosts: the WHATWG host parser normalises IPv4 (`0x7f.1`),
   percent-decodes, and Chromium checks Bidi.
5. Consequences: +~241 KB minified / 62 KB gzip (all of it tr46 + punycode) in every bundle that
   holds `node:url`; evaluated lazily on the first non-ASCII or `xn--` label (critic 2026-11-24:
   synchronous lazy evaluation is possible, eager is not required). Measure it against `tools/checks/client-bundle-budget.mjs`; on
   2026-09-13 the `generic` headroom was ~375 KB min and ~111 KB gzip. A pure-JS `URL` in the
   isolate can share the same UTS46.

## Not verified

- A browser host run (Chromium): lane (b) is runtime-js in Node with Node's `URL`, not Chromium's.
- IDNA beyond 40 hostnames (no IdnaTestV2 run).
- The `test-querystring*.js` corpus (only 9 ad-hoc lines run).
- Bundle growth inside rifty's real bundles (only the standalone esbuild size).
- How rifty's frames look to a stack walk on each host (the DEP0169 rule's input).
