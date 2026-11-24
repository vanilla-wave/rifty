---
area: runtime-js
status: ready
title: "`url.parse`, `url.resolve`, `url.resolveObject`, `url.format` and `querystring` give Node v24.16.0's results on every host, the isolate guest included, with no global `URL` for ASCII hostnames (non-ASCII: Acceptance 4)"
created: 2026-11-24
why: In the isolate guest `url.resolve('https://example.com/a', 'b')` returns `'b'` and `url.parse` drops `auth`/`hostname`/`port`/`path` with no error. On every host rifty's legacy API is a WHATWG-`URL` approximation: 905 of the 1 314 legacy calls in Node's own url tests differ with a global `URL`, and 1 038 differ in the isolate (corpus `runtime-js/tests/fixtures/url-legacy`; the probe's 1 313 keyed `NaN` as `null`)
sources: [docs/backlog/runtime-js/reference/url-legacy/README.md, docs/backlog/runtime-js/reference/url-legacy/idna-step/README.md, docs/adr/runtime-js/0574-generate-legacy-node-url-and-node-querystring-from-pinned-node-sources.md, docs/backlog/runtime-js/isolate-web-globals-captured-at-load.md, docs/backlog/runtime-js/node-url-legacy-format-and-helpers.md, docs/adr/runtime-js/0541-run-node-fetch-classes-over-the-browser-i-o-boundary.md]
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
241 KB min / 62 KB gzip. Measured 2026-11-24 on Unicode 17.0.0 `IdnaTestV2.txt` (6 391 inputs as
`url.parse('http://' + h + '/')`, 6 276 reach `toASCII` with a non-ASCII or `xn--` label): `tr46` 6.0.0
differs from Node on 304 (all Bidi: ada always runs its own per-label, partial RFC 5893 check,
`is_label_valid`; `checkBidi:false` skips it, `checkBidi:true` rejects 124 others); Chromium 148's
`URL` alone differs on 2 226 (it validates no `xn--` label of an ASCII host); `URL` plus ada's
punycode round trip on 307 (305 Bidi, 2 IPv4 from mapped digits); probe hosts 1/40 (`aא.com`)
(the probe's step; the shipped step and its residual: Acceptance 4).
Commands: probe README, `idna-step/`. Callers that ship today: parseurl
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
   (rifty's `argv0` `'rifty'`, `builtins/process-identity.ts:22`; declared by Acceptance 7). Under
   Acceptance 4's default the isolate run stops at the `ñ.com` line with
   `NotImplementedError('url.toASCII')` (stderr, exit 1) after Node's first three lines; the browser
   host gives all five → scenario
2. Differential suite: every legacy `url` call of Node v24.16.0's `test-url-parse-format.js`,
   `test-url-format.js`, `test-url-relative.js`, `test-url-parse-invalid-input.js` and
   `test-url-parse-query.js` (`runtime-js/tests/fixtures/url-legacy/url-calls.json`, 1 314 calls; Node's real recorded result, not
   a hand-written expectation) gives the same record — own keys in order, values, prototype
   `Url`, thrown `name`/`code`/`message` — in the isolate guest and in runtime-js with a global
   `URL` and in a browser host (Chromium lane): 0 differ (main: 1 038, 905 and 906 in Chromium), except, in the
   isolate, the 44 `parse` calls whose hostname has a non-ASCII label: each throws
   `NotImplementedError('url.toASCII')` (Acceptance 4) → scenario
3. The legacy API reads the WHATWG `URL` only in the `toASCII` step, for a non-ASCII or `xn--`
   label, and only the `URL` captured when the runtime loads: with `globalThis.URL` absent at load
   (the isolate guest) row 2 gives the same result as there; a `URL` the guest assigns later is never
   called, on either host (rejects a `URL` fast path with a fallback) → scenario
4. `toASCII` (the user's choice 2026-11-24: «ок» to the manager's recommendation of the host-`URL` variant): Unicode
   17.0.0 `IdnaTestV2.txt` inputs used as hostnames through `url.parse('http://' + h + '/').hostname`
   (or the `ERR_INVALID_URL` throw) equal live Node on a browser host (Chromium lane) on every
   input except the declared residual, pinned row by row: each pinned row must still differ,
   outcome type and value compared exactly (the PR #435 pin rule). Measured on Chromium 148,
   2026-11-24 (review round 1), over 6 584 hostnames (IdnaTestV2 + probe hosts + every ASCII char
   after a non-ASCII label + number labels): 337 rows — 306 Bidi, 30 host code points the WHATWG
   parser forbids and ada passes (C0 controls, DEL, `*` on Chromium), 1 mapped `%` (`a％41.com`:
   Node `ERR_INVALID_URL`, rifty `aa.com`); IPv4 ("ends in a number") no longer applies (a neutral
   label is appended for the parse). The classes are what the corpus shows, not a proof that no
   other input differs; another browser version may differ. In the isolate guest every ASCII input equals Node and every input with a non-ASCII
   or `xn--` label throws `NotImplementedError('url.toASCII')` → scenario
5. `querystring`'s `parse`/`stringify`/`escape`/`unescape`/`unescapeBuffer`/`encode`/`decode` and
   their options (`maxKeys`, `decodeURIComponent`, `encodeURIComponent`, separators) equal Node on
   Node v24.16.0's `test-querystring*.js` calls, with the same corpus method as row 2 → scenario
6. Mechanism: generated from vendored, pinned Node v24.16.0 sources with checked edit anchors and
   a drift check that fails on any committed-output change (ADR first, draft in the probe README) → scenario
7. Compat: isolate-host.md row "`url.parse` / `url.resolve`" goes ✅ for ASCII hostnames, with a ❌
   row for non-ASCII/`xn--` hostname labels (`url.toASCII`) (row "Web globals absent
   when the runtime loads" unchanged); modules.md states the browser-host `toASCII` ⚠️ with the
   residual's count and classes and its Identity row names `process.argv0` and the warning
   hint's program name; a `node:url`/`querystring` row in `docs/public/compat/modules.md` states
   what is Node's and names the gaps that remain (Out of scope) → scenario
8. Cost: no new dependency; ASCII hostnames without an `xn--` label take no `URL` call (ada's
   ASCII path only lower-cases); warm `runCode` median (40 calls)
   and guest/browser bundle bytes before/after recorded in the ADR and the host README;
   `client-bundle-budget` passes with today's ceilings (the user accepted them with 50% headroom,
   that file's header) — a bump, and any warm-call or guest-bundle growth while the goal's
   question 3 (cost) is unanswered, waits for the user's answer before merge (this unit's guest-bundle
   growth, +47 KB, was shown to the user with the `toASCII` choice on 2026-11-24; the manager reads his
   «ок» as covering it, no objection followed) → scenario
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
`format(URL, options)`), `toASCII` (the user's choice, Acceptance 4: an ASCII hostname without
an `xn--` label is returned as is, ada's ASCII path; otherwise the `URL` captured at load parses
`http://<hostname>.x/` (a neutral last label: no IPv4 rule; `.x` cut), each `xn--` label of its hostname is decoded by ada's `punycode_to_utf32`
(an all-ASCII or out-of-range decoding is an error, as ada) and the decoded name must parse back to
the same hostname; a failure is ada's `''`; no `URL` at load → `NotImplementedError('url.toASCII')`) and `isInsideNodeModules(4)`: a V8
stack walk through rifty's one `Error.prepareStackTrace` owner
(`builtins/vm/script-offsets.ts`) that ignores the guest's `stackTraceLimit`/`prepareStackTrace`
(a guest frame is one rifty's loader compiled from guest source, V8 `CallSite.isEval()`; every
other frame is the runtime's and counts as Node's `node:` frame),
a lookup that never throws nor changes `Error` (an impossible walk → "unknown", no DEP0169; manager's
rule, review round 2),
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
- `toASCII` of a non-ASCII or `xn--` label without a `URL` at load (isolate guest):
  `NotImplementedError('url.toASCII')`, compat ❌; owner `runtime-js/isolate-web-globals-captured-at-load`
  (a guest `URL` there). Browser hosts: the residual of Acceptance 4, compat ⚠️, until the user's
  choice.
- The `rifty --trace-deprecation` hint (Node: `node --trace-deprecation`): rifty's `argv0`,
  every warning, compat ⚠️ (identity row).

## Decisions

- 2026-11-24 — a real port on every host, not a named gap in the isolate: Node's legacy API needs
  no `URL`, so a gap would be a throw for working behaviour, and it would leave the browser hosts'
  905/1 314 wrong results.
- 2026-11-24 — `querystring` is ported in the same unit: `url.js` calls `querystring.parse`/
  `stringify` and `internal/querystring`'s `encodeStr`/`hexTable` through one module object (a guest
  that patches `querystring.unescape` changes `url.parse`), and rifty's `querystring` differs.
- rejected route: npm `url@0.11.4` (browserify's port of `lib/url.js`) — 127/1 313 calls differ
  (critic's scratch run 2026-11-24, not in the probe files) — violates Acceptance 2.
- 2026-11-24 — (superseded the same day by the next line) `toASCII` as `tr46` 6.0.0 on every host.
- 2026-11-24 — the user's choice («ок» to the manager's recommendation; taken earlier the same day as the
  manager's reversible default):
  `toASCII` takes the host's `URL` captured at load plus ada's punycode round trip (Reference
  contract); no `URL` (isolate today) → `NotImplementedError('url.toASCII')` for a non-ASCII or
  `xn--` label. Measured (Context, `reference/url-legacy/idna-step/`): residual (probe form) 307/6 276
  IdnaTestV2 rows (305 Bidi, 2 IPv4) plus mapped `%` — shipped form: Acceptance 4, about 2 KB of code, no dependency; a switch
  to the candidate below replaces one function. Rejected: `tr46` 6.0.0 — 304 rows differ under
  every flag setting (ada's own Bidi check); the bare `URL` — 2 226 rows (no `xn--` check for an
  ASCII host). Not chosen now, a candidate of the isolate Web API goal together with its `URL`: generate `ada::idna` (`to_ascii`, punycode,
  `is_label_valid`, Unicode 17 tables) from Node v24.16.0's `deps/ada/ada.cpp` — Node's result by
  construction on every host, the isolate included; tables 230 KB raw, estimate 307 KB / 97 KB gzip
  as base64, 82 KB gzip / 47 KB brotli as binary, 109 KB raw / 53 KB gzip if NFC comes from
  `String.prototype.normalize` (valid only on a Unicode 17 ICU; not measured in a bundle).
- 2026-11-24 — publishing gate (review round 1, S3): the published packages carry no Node
  license notice (`generated/node.LICENSE` is not in `dist`; undici's too, ADR-0541): no package
  with this code is published before the unit that ships license notices of generated sources
  (manager's, all generated sources at once).
- 2026-11-24 — DEP0169 window: a guest frame is code rifty's loader compiled from guest source
  (V8 `CallSite.isEval()`: CJS, ESM and `-e` bodies are `Function`/indirect-eval code), not a
  per-host list of runtime script names — the runtime's bundles and chunks need no registry, and a
  dev lane with one script per source file counts the same.
- 2026-11-24 — the mechanism is generated from vendored pinned sources with a drift check (the
  ADR-0541 pattern). A hand TS port is rejected: the same semantic copy without a drift check, and
  `lib/url.js` is 1 049 lines. An ADR comes first: semantic copy, `toASCII` binding, bundle growth
  (the ported `url`/`querystring` code less `url.ts`; rerun `client-bundle-budget` first — its
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
