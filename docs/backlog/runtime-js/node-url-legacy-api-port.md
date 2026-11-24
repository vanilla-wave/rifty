---
area: runtime-js
status: ready
title: "`url.parse`, `url.resolve`, `url.resolveObject`, `url.format` and `querystring` give Node v24.16.0's results on every host, the isolate guest included, with no global `URL`"
created: 2026-11-24
why: In the isolate guest `url.resolve('https://example.com/a', 'b')` returns `'b'` and `url.parse` drops `auth`/`hostname`/`port`/`path` with no error. On every host rifty's legacy API is a WHATWG-`URL` approximation: 904 of the 1 313 legacy calls in Node's own url tests differ with a global `URL`, and 1 037 differ in the isolate
epic: isolate-guest-web-api
sources: [docs/backlog/epics/isolate-guest-web-api/reference/url-legacy/README.md, docs/backlog/runtime-js/isolate-web-globals-captured-at-load.md, docs/backlog/runtime-js/node-url-legacy-format-and-helpers.md, docs/adr/runtime-js/0541-run-node-fetch-classes-over-the-browser-i-o-boundary.md]
code: [packages/runtime-js/src/builtins/url.ts, packages/runtime-js/src/builtins/querystring.ts, packages/runtime-js/src/builtins/index.ts]
---

## Context

Node's legacy URL API is JS (`lib/url.js`, `lib/querystring.js`, `lib/internal/querystring.js`)
and needs no WHATWG `URL`. Native code appears only in `toASCII` (ada::idna, applied to every
hostname that is not IPv6) and in `isInsideNodeModules(4)`, which suppresses DEP0169 for callers
inside `node_modules`. rifty's `builtins/url.ts` instead runs `new URL(input)` inside a `try` and falls
back to a regex in an empty `catch`. In the isolate the `URL` it captured at load is `undefined`, so
every call takes the fallback. Probe 2026-11-24 (Node v24.16.0, `origin/main` 1c00c6292): the full
table and the commands are in the probe README. In short:

| lane | parse | format | resolve | resolveObject |
|---|---|---|---|---|
| isolate guest (`runCode`) | 436/436 differ | 177/431 | 201/223 | 223/223 (absent) |
| runtime-js with a global `URL` (browser-host code path) | 436/436 (226 even ignoring prototype, absent keys, `path`) | 187/431 (`o.search.startsWith is not a function` for a string) | 58/223 (`resolve('/foo/bar/baz', 'quux')` → `'quux'`) | 223/223 |

Also measured: rifty emits no DEP0169 or DEP0170 (Node: once per process). rifty's `querystring`
differs from Node's (`parse('=x&&y=')`, `unescape('%41%zz+')`). `tr46` 6.0.0 (Unicode 17.0, as
Node v24.16.0's ada 3.4.4) under ada's flags equals Node's `toASCII` on all 40 probe hostnames;
5.1.1 (Unicode 16) differs on the 5 Unicode-17 letters (`results-idna.txt`). tr46 + punycode:
241 KB min / 62 KB gzip. Callers that ship today: parseurl
1.3.3 (Express), node-fetch 2.7.0, request 2.88.2, http-proxy 1.18.1.

## User scenario

A model writes `/workspace/main.js` (CommonJS) for an isolate-host sandbox, with
parseurl 1.3.3 in `node_modules`:

```js
const url = require('url');
const parseurl = require('parseurl');
console.log(url.resolve('https://example.com/guide/a', '../img/b.png'));
const u = url.parse('http://u:p@a.com:8/b?c=d#e', true);
console.log(u.auth, u.host, u.hostname, u.port, u.path, JSON.stringify(u.query));
console.log(url.format(url.parse('HTTP://Ex.com/a b')));
console.log(url.parse('http://ñ.com/').hostname);
const p = parseurl({ url: 'http://a.com:8/x?y=1' });
console.log(p.host, p.pathname, p.query);
```

`sandbox.exec('main.js')` today gives stdout `../img/b.png` / `undefined u:p@a.com:8 undefined
undefined undefined {"c":"d"}` / `HTTP://Ex.com/a b` / `undefined` / `a.com:8 /x y=1`, empty stderr,
exit 0. `node main.js` over the same files gives `https://example.com/img/b.png` / `u:p a.com:8
a.com 8 /b?c=d {"c":"d"}` / `http://ex.com/a%20b` / `xn--ida.com` / `a.com:8 /x y=1`, with one DEP0169
warning on stderr. Target: the same file gives Node's output in a browser-host `node main.js`
(not measured there today; rifty emits no DEP0169 on any host).

## Acceptance

1. The scenario file: in an isolate-host sandbox and in a browser-host `node main.js` (Chromium
   lane), stdout, stderr and exit code equal `node main.js` over the same files; masked only: the
   pid in `(node:<pid>)` and the program name in the `(Use \`node --trace-deprecation …\`` hint
   (rifty's `argv0` `'rifty'`, `builtins/process-identity.ts:22`; declared by Acceptance 7) → scenario
2. Differential suite: every legacy `url` call of Node v24.16.0's `test-url-parse-format.js`,
   `test-url-format.js`, `test-url-relative.js`, `test-url-parse-invalid-input.js` and
   `test-url-parse-query.js` (the probe's `cases.json`, 1 313 calls; Node's real recorded result, not
   a hand-written expectation) gives the same record — own keys in order, values, prototype
   `Url`, thrown `name`/`code`/`message` — in the isolate guest and in runtime-js with a global
   `URL`: 0 differ (today 1 037 and 904) → scenario
3. The legacy API never reads the WHATWG `URL`: with `globalThis.URL` deleted before runtime-js
   loads, row 2 still gives 0 differences (rejects an implementation that keeps a `URL` fast path
   with a fallback) → scenario
4. `toASCII`: Unicode 17.0.0 `IdnaTestV2.txt` inputs used as hostnames through
   `url.parse('http://' + h + '/').hostname` (or the `ERR_INVALID_URL` throw) equal live Node on
   every input; a tr46/ada difference is a failing case fixed by a checked edit, never a pinned
   pass → scenario
5. `querystring`'s `parse`/`stringify`/`escape`/`unescape`/`unescapeBuffer`/`encode`/`decode` and
   their options (`maxKeys`, `decodeURIComponent`, `encodeURIComponent`, separators) equal Node on
   Node v24.16.0's `test-querystring*.js` calls, with the same corpus method as row 2 → scenario
6. Mechanism: generated from vendored, pinned Node v24.16.0 sources with checked edit anchors and
   a drift check that fails on any committed-output change (ADR first, draft in the probe README) → scenario
7. Compat: isolate-host.md row "`url.parse` / `url.resolve`" goes ✅ (row "Web globals absent
   when the runtime loads" unchanged) and its Identity row names `process.argv0` and the warning
   hint's program name; a `node:url`/`querystring` row in `docs/public/compat/modules.md` states
   what is Node's and names the gaps that remain (Out of scope) → scenario
8. Cost: tr46 is bundled but evaluated on the first hostname with a non-ASCII or `xn--` label
   (ASCII hostnames need only lower-casing under ada's flags); warm `runCode` median (40 calls)
   and guest/browser bundle bytes before/after recorded in the ADR and the host README;
   `client-bundle-budget` passes with today's ceilings (the user accepted them with 50% headroom,
   that file's header) — a bump, and any warm-call or guest-bundle growth while the goal's
   question 3 (cost) is unanswered, waits for the user's answer before merge → scenario
9. Out-of-scope members are loud: `url.domainToASCII`/`domainToUnicode`/`urlToHttpOptions`
   (today `undefined`) throw `NotImplementedError('url.<member>')`; `url.format(URL, options)`
   validates `options` as Node (a truthy non-object, array or function → `ERR_INVALID_ARG_TYPE`;
   a falsy one is ignored), returns `href` where Node does (no options, `{}`, defaults, options
   that change nothing for that URL) and throws `NotImplementedError('url.format.options')` only
   where an option changes Node's output (`fragment: false` with a `#` in `href`, `search: false`
   with a `?` in `href`, `auth: false` with userinfo, `unicode: true` with an `xn--` label) → scenario

## Parity cases

Node parity-runner (`tools/node-parity-runner/cases/url/`, `cases/querystring/`) plus the isolate
sandbox lane; each case is RED on main:

- `url.resolve` over a path-only base (`'/foo/bar/baz', 'quux'` → `/foo/bar/quux`) and over an
  absolute base with `..` → scenario
- `url.parse` record shape: a `Url` instance with all 12 keys in Node's order, `null` for absent
  parts, `path` = pathname + search → scenario
- `url.parse(s, true)`: `query` has a null prototype (Node's `querystring.parse`), and is `{}` when
  there is no search → scenario
- `url.parse` with `slashesDenoteHost` (`'//a.com/b'` with and without it) → scenario
- auth, port and IPv6 hosts (`http://[::1]:8/`), and invalid hosts that throw `ERR_INVALID_URL`
  (`http://[127.0.0.1\x00c8763]:8000/`, `http://­/bad.com/`) → scenario
- IDNA hostnames (`ñ.com` → `xn--ida.com`, `faß.de`, `aא.com` → `xn--a-0hc.com`, `xn--` →
  `ERR_INVALID_URL`) → scenario
- `url.format(string)` and `url.format(legacyObject)` with `query` objects, `auth` escaping and `#`
  in the pathname → scenario
- `url.resolveObject(url.parse(base), rel)` record, and `url.resolveObject('', 'foo')` → `'foo'` → scenario
- `new url.Url()`: its keys, `Url.prototype.parse`/`format`/`resolve`/`resolveObject` → scenario
- Errors: `url.parse(null)`, `url.format(1)` → `ERR_INVALID_ARG_TYPE` with Node's message → scenario
- DEP0169 by Node's 4-frame window (Reference contract): once per process for a call from user
  code; none from a caller in `node_modules` (parseurl); `url.resolve` from `node_modules`
  (`urlResolve` takes a window slot); a `node_modules` caller behind three `EventEmitter.emit`
  frames (window used up by builtin frames → warns; behind two → silent); a user frame first
  decides alone (`nm → w1 → w2 → w3 → url.parse` warns, `w1 → w2 → w3 → nm → url.parse` does not); a later user call still warns; the same with the guest's
  `Error.stackTraceLimit = 0` and a guest `Error.prepareStackTrace`; DEP0170 once for
  `http://a.com:xx/` → scenario
- global-`URL` lane only (the guest has no `URL` before map item 4): `url.format(new
  URL('http://u:p@a.com/?q#h'), { fragment: false })` → the named gap, `…, 1)` and `…, [])` →
  `ERR_INVALID_ARG_TYPE`; regression guard (passes on main): `…, {})` and `…, 0)` → `href`; every
  lane: `url.domainToASCII('a.com')` → the named gap → scenario
- parseurl 1.3.3 over a full URL and over a path, in the sandbox, against `node main.js` → scenario

## Reference contract

Node v24.16.0: `lib/url.js` (legacy part: `Url`, `urlParse`, `urlFormat` for a string or legacy
object, `urlResolve`, `urlResolveObject`, `Url.prototype.*`), `lib/querystring.js`,
`lib/internal/querystring.js`. Mechanism: vendored upstream text with the MIT notice; a generator
binds `primordials`, `ERR_*`, validators, `urlFormat`'s `instanceof URL` (the runtime's own
`URL` when one exists, else no value is a `URL`) and `bindingUrl.format` (Acceptance 9's
`format(URL, options)`), `toASCII` (pure-JS UTS46, `tr46` exact pin with ada's
legacy flags: `checkHyphens:false, checkBidi:false, checkJoiners:true, useSTD3ASCIIRules:false,
transitionalProcessing:false, verifyDNSLength:false`; tr46 6.0.0 exact, Unicode 17.0 = ada 3.4.4,
the pin shared with the guest `URL` unit's whatwg-url 15.1.0) and `isInsideNodeModules(4)`: a V8
stack walk through rifty's one `Error.prepareStackTrace` owner
(`builtins/vm/script-offsets.ts`) that ignores the guest's `stackTraceLimit`/`prepareStackTrace`,
and reproduces Node's window (`node_util.cc` `IsInsideNodeModules`: `CurrentStackTrace(isolate,
4)` — 4 frames in total, builtin ones included; frames with an empty or `node:` script name are
skipped; the first remaining frame decides; all 4 skipped → not inside, the warning fires). The
window counts rifty's builtin-module frames (recognised per host by the runtime's own script
names) one for one as Node's `node:` frames: the ported `node:url` functions have Node's frames by
construction; elsewhere (an `EventEmitter.emit` chain) rifty's builtin call depth decides, and a
case where it differs from Node's is a failing parity case or, if the depth cannot match, a
declared compat ⚠️ row naming it. Oracle: live Node v24.16.0 over
the recorded corpus. A Node re-pin regenerates and reruns the suite.

## Out of scope

- WHATWG members of `node:url` (`URL`, `URLSearchParams`, `pathToFileURL`, `fileURLToPath`) in
  the isolate: they stay in `runtime-js/isolate-web-globals-captured-at-load`
  (compat isolate-host.md "Web globals absent when the runtime loads").
- `url.domainToASCII`, `domainToUnicode`, `urlToHttpOptions` (WHATWG host parser, ada):
  `NotImplementedError('url.<member>')` (Acceptance 9), compat ❌; owner
  `runtime-js/node-url-legacy-format-and-helpers`.
- `url.format(URL, options)` where an option changes the output:
  `NotImplementedError('url.format.options')` (Acceptance 9), compat ❌; same owner.
- The `rifty --trace-deprecation` hint (Node: `node --trace-deprecation`): rifty's `argv0`,
  every warning, compat ⚠️ (identity row).

## Decisions

- 2026-11-24 — a real port on every host, not a named gap in the isolate: Node's legacy API needs
  no `URL`, so a gap would be a throw for working behaviour, and it would leave the browser hosts'
  904/1 313 wrong results.
- 2026-11-24 — `querystring` is ported in the same unit: `url.js` calls `querystring.parse`/
  `stringify` and `internal/querystring`'s `encodeStr`/`hexTable` through one module object (a guest
  that patches `querystring.unescape` changes `url.parse`), and rifty's `querystring` differs.
- rejected route: npm `url@0.11.4` (browserify's port of `lib/url.js`) — 127/1 313 calls differ
  (critic's scratch run 2026-11-24, not in the probe files) — violates Acceptance 2.
- 2026-11-24 — `toASCII` is pure-JS UTS46 (`tr46` 6.0.0 exact, Unicode 17.0 as ada 3.4.4) on
  every host, evaluated lazily (Acceptance 8). Rejected: the native
  `URL` host parser, which normalises IPv4, percent-decodes and checks Bidi where ada's `to_ascii`
  does not.
- 2026-11-24 — the mechanism is generated from vendored pinned sources with a drift check (the
  ADR-0541 pattern). A hand TS port is rejected: the same semantic copy without a drift check, and
  `lib/url.js` is 1 049 lines. An ADR comes first: semantic copy, `tr46` pin, bundle growth
  (tr46 + punycode standalone +241 KB min / 62 KB gzip, plus the ported `url`/`querystring` code
  less `url.ts`, not measured; rerun `client-bundle-budget` first — its
  headroom was last measured 2026-09-13).
- 2026-11-24 — goal `isolate-guest-web-api` map item 2, runnable before the acceptance carrier
  (item 1): it depends on none of the goal's open questions except the merge gate of
  Acceptance 8, and on no `URL` source.

## Challenge

challenge: 2026-11-24 — 12 problems (3 blocker, 4 concern, 5 nit) — fresh read-only critic over the
manager's request, alternatives I/II, this contract and the url-legacy probe; premise holds (npm
`url@0.11.4` measured: 127/1 313 differ; querystring necessary). Verified; dispositions:

- B1 tr46 5.1.1 is Unicode 16, Node v24.16.0's ada 3.4.4 is Unicode 17 (5 letters differ) — pin
  6.0.0 (40/40 equal, rerun `results-idna.txt`), shared with whatwg-url 15.1.0; Acceptance 4 pins
  IdnaTestV2 17.0.0 and says how a tr46/ada difference is handled.
- B2 stderr hint names `rifty` (`argv0`) — Acceptance 1 masks the program name in the hint
  (identity ceiling); Out of scope states it ⚠️.
- B3 omitted user choice: bundle cost on every host — Acceptance 8: within today's
  `client-bundle-budget` ceilings (accepted by the user with 50% headroom, that file) the growth is
  measured and recorded; a ceiling bump is the user's, asked before merge.
- C1 eager is not required — tr46 evaluated lazily (Acceptance 8, Decisions).
- C2 DEP0169 walk underspecified — Reference contract names the `prepareStackTrace` owner, ignores
  the guest's `stackTraceLimit`/`prepareStackTrace`; parity row added.
- C3 Out of scope members not loud — Acceptance 9 makes them `NotImplementedError`.
- C4 compat row wording — Acceptance 7 reworded (only the parse/resolve row changes).
- N1 browser-host sentence read as measured — marked as target. N2 npm `url` rejection — in
  Decisions. N3 querystring reason — in Decisions. N4 stale budget headroom — rerun before the ADR
  (Decisions). N5 row 6 traces to the ADR once numbered — kept `→ scenario` until then.

final-check: 2026-11-24 — verify pass (fresh reviewer) NOT PASS, 3 blockers + 4 concerns + 4 nits,
fixed (re-pass 2026-11-24: 4 concerns + 2 nits, fixed: rifty builtin frames count 1:1 in the
window with emit-chain rows, `format(URL, options)` row limited to the global-`URL` lane, `?`/`#`
in `href`, truthy-only validation, owner item and map wording): DEP0169 window restated from `node_util.cc` (4 frames incl. builtin, first non-skipped
decides) with window parity rows; Acceptance 9 narrowed to output-changing `format(URL, options)`
(no throw for working behaviour) with Node's `ERR_INVALID_ARG_TYPE`; Acceptance 8 gates merge on the
goal's question 3 for warm-call/guest-bundle growth, not only a budget bump; `instanceof URL` and
`bindingUrl.format` bindings named; Out of scope owners made consistent (probe ADR draft too);
`argv0` cited at `builtins/process-identity.ts:22`, declared via the Identity row (Acceptance 7);
budget citation; size wording; full 5.1.1 lines in `results-idna.txt`; «first unit» → map item 2;
compat page named (`modules.md`). Traces stay `→ scenario` (the goal's invariants are draft).
