# Probe: is a builtin-export sweep a completeness proof for the web-globals class?

Question (goal `isolate-guest-web-api`, manager question 3; proposals of
`backlog/runtime-js/isolate-web-globals-captured-at-load` §Question): (1) sweep every export of
every builtin module one level deep, `typeof` plus identity with the same-named global, against
live Node; (2) a static pass over every `catch` around a ceiling-global use. What does each catch
today, what can it never catch, what would it cost as a test.

Measured 2026-11-24, `origin/main` 1c00c6292 (guest built from it), Node v24.16.0, macOS arm64.

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build
node docs/backlog/epics/isolate-guest-web-api/reference/enumerate/enumerate.mjs   # writes results-*.json, diff.json
node docs/backlog/epics/isolate-guest-web-api/reference/enumerate/catch-pass.mjs --json docs/backlog/epics/isolate-guest-web-api/reference/enumerate/catch-pass.json
```

`sweep.cjs` runs unchanged in four places: `node sweep.cjs`, `node -e`, a sandbox `exec`, `runCode`.
Input lists are live Node's: `require('module').builtinModules` (72 ids) and
`Object.getOwnPropertyNames(globalThis)` of `node -e` (181 names). Per module: `require` (error
recorded), each own key: `typeof` (a function also its `prototype`'s), a throwing read recorded,
and `=global`/`!=global` where the key is also a global name. Per global: `typeof`.

## What already exists (not duplicated)

- `parity.test.ts` "every global node -e defines exists in the guest": global names only.
- `ceiling-modules.test.ts`: every key of `zlib`/`child_process`/`worker_threads` read and
  subclassed.
- names sweep (PR #425, `runtime-js/reference/guest-builtin-names-baseline.md`): a function's
  `name` (113 of 404 differ).
- `bundle-public-names.test.ts`: bundler-suffixed declarations in `guest.js`.

None compares kind or identity of every builtin export.

## Result (`diff.json`)

1 541 Node exports swept; the guest has 930 (file) / 929 (`-e`). Rows differing from Node, by class:

| class | file | `-e` | what |
|---|---|---|---|
| a1 exported key holds `undefined`, Node a value | 5 | 4 | `buffer.Blob`, `buffer.File`, `url.URL`, `url.URLSearchParams`, `crypto.subtle` (file run only) |
| a2 read throws a named gap where Node's value is the global | 14 | 14 | `stream/web.*` (14 classes): `NotImplementedError: stream/web.ReadableStream`, not the global's `isolate-host.ReadableStream`; identity with the global lost |
| a3 same kind, another identity than the global | 1 | 1 | `perf_hooks.PerformanceObserver` (rifty's class, loud `observe`) `!==` the guest's `PerformanceObserver` (the ceiling thrower) |
| b declared loud (unregistered module, loud read) | 23 | 29 | the 21 unregistered ids (`domain`, `_stream_*`, `node:sqlite`, …; compat row "`require` of a Node builtin rifty does not register"); `-e`: their lazy globals too, and `crypto.subtle` |
| c1 key Node has, guest lacks | 486 | 487 | rifty surface gaps on every host (`crypto` 57, `process` 54, `dns` 45, `fs` 40, `sys` 34, …); web-API ones: `perf_hooks.Performance`/`Entry`/`Mark`/`Measure`/`ObserverEntryList`/`ResourceTiming`, `url.URLPattern`, `stream/web.CompressionStream`/`DecompressionStream`/`ReadableStreamBYOBRequest` |
| c2 other `typeof`/`prototype` kind | 82 | 83 | method-vs-function shapes (`dns.lookup`, `crypto.getHashes`, `assert.strict`), `module` an object (Node a function) |
| c3 key only the guest has | 16 | 16 | `process.send`/`channel`/… holding `undefined`, … |

Globals: 0 of 181 differ in `typeof`. A ceiling thrower is an ordinary function with a
`prototype`, like the real class, so `typeof` cannot see a ceiling at all.

The same key depends on when its module first evaluates: `crypto.subtle` is `undefined` in a file
run, and the named gap `isolate-host.crypto.subtle` under `-e`, where the builtin's lazy global
loads it after the ceilings. Why the file run loads `crypto` earlier: not verified.

### Identity form (the class's own invariant)

Node makes 49 builtin exports identical to a global (`url.URL === URL`, `buffer.Blob === Blob`,
`stream/web.* === globalThis.*`, `perf_hooks.Performance*`, `timers.setTimeout`, `util.TextEncoder`,
`worker_threads.MessageChannel`, `http.WebSocket`, …). The guest holds 18 of them and fails 31.
29 of the 31 are web-API names: `buffer.Blob`/`File`, `perf_hooks` ×7, `stream/web` ×17, `url` ×3.
The other two are `sys.TextDecoder`/`TextEncoder` (rifty's `sys` stub). A ceiling kept as a
ceiling passes this form when its export is the global thrower by identity
(`http.WebSocket`, `worker_threads.MessageChannel` do today).

### Table of `isolate-web-globals-captured-at-load` vs the sweep

| table row | sweep |
|---|---|
| `url.URL`, `url.URLSearchParams` | caught (a1) |
| `buffer.Blob`, `buffer.File` | caught (a1) |
| `crypto.subtle` | caught in a file run (a1); `-e` sees the named gap |
| `stream/web` "a gap under another name" (round 3, not measured) | caught, measured: 14 × a2, 3 missing |
| `import('file:…')` (`resolver.ts`), `createRequire('file:…')`, `url.pathToFileURL`/`fileURLToPath` | **not caught**: the functions exist, fail on call |
| `fs.readFileSync({})` (`instanceof` against `undefined`) | **not caught**: an internal use |
| `url.parse`/`url.resolve` wrong values | **not caught**: a value, not a shape |
| — | new: `perf_hooks.PerformanceObserver` identity (a3); `perf_hooks.Performance*`, `url.URLPattern`, `stream/web.CompressionStream`/`DecompressionStream`/`ReadableStreamBYOBRequest` absent on every host (c1, by source: `perf_hooks.ts` exports only `performance` + `PerformanceObserver`; `stream-web.ts` lists 14 names) |

Method boundary: the sweep proves shape and identity of exported values. It cannot see a runtime
path that uses a captured global internally: a call that throws, or a silent wrong value. 4 of the
table's 9 rows are of that kind.

## Static pass (`catch-pass.json`)

19 `try { … } catch` sites in `packages/{runtime-js,io,vfs,kernel,net}/src` (262 prod files) whose
try body names a ceiling global or runtime-js's URL helpers. In the guest bundle (esbuild path
comment `// ../<file>` in `guest.js`): 7. The other 12 are browser/net code not bundled (`net/src/*`,
`kernel/src/worker-entry.ts`, `runtime-js/src/builtins/fetch/platform.ts`).

| site (bundled) | uses | catch does | in the isolate today |
|---|---|---|---|
| `runtime-js/src/builtins/url.ts:59` `parse` | `URL` | silent regex fallback | **wrong value** (measured) |
| `runtime-js/src/builtins/url.ts:158` `resolve` | `URL` | `return to` | **wrong value** (measured) |
| `runtime-js/src/internal/create-require-path.ts:7` | `fileURLToPathPosix` | swallow → `ERR_INVALID_ARG_VALUE` | **another error** (measured) |
| `runtime-js/src/module-loader/resolver.ts:251` | `URLConstructor` | rethrow as `UNSUPPORTED_PROTOCOL` with the inner message | leaked internal name (measured) |
| `runtime-js/src/module-loader/import-meta-resolve-parent.ts:19` | `URL` | `null` → `ERR_UNSUPPORTED_RESOLVE_REQUEST` / `ERR_INVALID_URL` | another error, latent: ESM + `--experimental-import-meta-resolve` only, no ESM loader in the isolate |
| `runtime-js/src/ipc/no-coi-child-process.ts:65` | `MessageEvent` | rethrow | unreachable (no-COI browser child) |
| `kernel/src/spawn-worker.ts:364` | `MessageChannel` | rethrow | unreachable (`child_process` loud) |

This pass finds all four silent or converting catches in the table, plus one latent catch.
Boundary: it is textual. It misses a ceiling use one call deeper than the try body (a helper not
in its name list), `.catch(` on promises, and `instanceof`/property reads outside any try
(`fs-path.ts:33`).

## Cost

- Run time: guest sandbox `exec` 146–154 ms, `runCode` 21–22 ms, Node 42–45 ms per run.
- Code: `sweep.cjs` 44 lines, driver 101, catch pass 59.
- Oracle: live `node`, as `parity.test.ts` already does. CI's test lanes pin Node 24.16.0
  (`.github/workflows/ci.yml`, `run`/`parity` suites). A different Node patch moves the key lists, so a live oracle needs no
  stored snapshot, only the pinned version.
- As a test: one `packages/isolate-host/tests/builtin-global-identity.test.ts` of about 40 lines.
  Its identity form, for every Node export `=== global`: the guest's export `===` the guest's
  global. Plus `crypto.subtle === crypto.webcrypto.subtle === globalThis.crypto.subtle`, which is
  outside the one-level sweep. 31 known failures today (29 web-API, 2 `sys`); 0 web-API failures
  once the goal ships. A ceiling that stays a ceiling passes through identity.
- The full kind diff as a test would need about 620 pins today (c1/c2/c3: rifty-wide surface gaps
  on every host). That is noise for this goal: another owner, not a completeness proof.

## Recommendation (for the map)

- Invariant of completeness = the identity form (guest, file entry and `-e`). Cheap, by
  construction for every future capture of a global into an export.
- Not a proof for internal uses: those need (a) the catch pass as a review list now (7 bundled
  sites, 4 real), and (b) the real globals installed before the runtime loads (seam, question 2).
  Then the "captured at load" capture cannot happen, whatever the internal use. For globals that
  stay ceilings, each internal use found by the pass needs its own parity row.
- The kind diff (c1/c2) stays a probe artifact. Rows that matter go to their owners' backlog, not
  this goal.

## Not verified

- Browser hosts (the sweep was run in the isolate guest only; `stream-web.ts` re-exports by
  identity where a global exists, by source).
- Why a file run evaluates `crypto` before the ceilings and `-e` after.
- Symbol-keyed exports, prototype members, nested namespaces (`util.types` one level only, as a
  module of its own).
- The catch pass's text matcher on code that hides braces in regex literals (spot-checked the 19
  sites by hand, not the whole tree).
