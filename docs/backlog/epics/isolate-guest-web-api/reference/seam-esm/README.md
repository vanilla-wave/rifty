# Probe: the load-order seam and ES modules in the isolate guest

Questions (goal `isolate-guest-web-api`, manager's 2 and 4):
1. If a real `URL`/`URLSearchParams` is installed before the runtime loads, does the class
   "captured at load" (`backlog/runtime-js/isolate-web-globals-captured-at-load`) vanish for them?
   What about the globals that stay ceilings?
2. What does rifty's ES module loader need in the isolate besides `URL`?

Probe only. The implementation source (`core-js` here) is not this probe's question: it was the
fastest real `URL` to wire in (devDep of isolate-host). Measured 2026-11-24, HEAD `1c00c6292`,
Node v24.16.0 (oracle and host), isolated-vm 7.0.2, esbuild 0.28.0, core-js 3.51.0, nanoid 5.1.16,
M3 Pro, macOS; load average 2.6–4 (other agents on the machine).

## Run

```sh
pnpm install && pnpm --filter @riftydev/isolate-host build      # base dist at HEAD
P=docs/backlog/epics/isolate-guest-web-api/reference/seam-esm
node $P/build-variants.mjs            # variant dists under packages/isolate-host/node_modules/.web-api-probe/
(cd /tmp && npm pack nanoid@5 && tar -xzf nanoid-5.*.tgz)       # ESM-only package, → /tmp/package
node $P/run.mjs --nanoid /tmp/package --json $P/results.json    # table → results.txt
node $P/trace-load.mjs --json $P/results-trace-load.json        # ceiling reads before guest code
node $P/run.mjs --timing --n 40                                 # warm runCode('1'), → results-timing.jsonl
```

Variants (`build-variants.mjs`: `build-guest.mjs`'s esbuild config + an `onLoad` edit; prod sources
untouched):

| variant | edit |
|---|---|
| `base` | `packages/isolate-host/dist` as built |
| `url-first` | core-js `actual/url` + `actual/url-search-params` injected right after `web-shim.ts` (before every runtime module); `URL`, `URLSearchParams` out of `CEILING_GLOBALS` |
| `url-esm` | `url-first` + `declareNoEsmLoader(esmGap)` removed from `entry.ts` |
| `trace-load` | base; every `CEILING_GLOBALS` name and `crypto.subtle` a logging getter returning `undefined` until `setUp()` installs the ceilings |
| `ceilings-first` | base; `installCeilingGlobals()` also at the end of `web-shim.ts` (before the runtime) |
| `ceilings-first-ports-late`, `…-ports-subtle-late` | the same, `MessageChannel`/`MessagePort`/`BroadcastChannel` (and `crypto.subtle`) removed again after the early call |

Each case (`cases.mjs`) is files + an entry: `sandbox.exec(entry)` per variant (`runCode` for `-e`),
and real `node <entry>` over the same files in a temp dir (its path printed as `/workspace`).
Full output: `results.txt`, raw: `results.json`.

## 1. Seam: `URL` installed before the runtime

`url-first` vs `base` vs Node (stdout, exit 0 everywhere unless noted):

| case | base | url-first | node |
|---|---|---|---|
| `new URL`, `URLSearchParams`, `URL.canParse` | named gap; `canParse` `undefined` | = node | works |
| `import('file://…/c.cjs')` from a CJS file | `UNSUPPORTED_PROTOCOL … URLConstructor is not a constructor` | = node | namespace |
| `import('file://…/m.mjs')` from a CJS file | same leak | `isolate-host.esm` (the declared gap, honest) | namespace |
| `createRequire('file://…')` | `ERR_INVALID_ARG_VALUE` | = node | works |
| `url.pathToFileURL('/x y')`, `fileURLToPath('file:///x%20y')`, `fileURLToPath(URL)` | `URLConstructor is not a constructor` | = node | `file:///x%20y`, `/x y`, `/a/b` |
| `new url.URL`, `url.URL === URL`, `url.URLSearchParams` (same) | `is not a constructor`, `false` | = node | works, `true` |
| `fs.readFileSync(new URL('file://…/x.txt'))` | named gap (`isolate-host.URL`) | = node | `xtext` |
| `fs.readFileSync({})` | `Right-hand side of 'instanceof' is not an object` | `TypeError: fs path must be string, Buffer, or URL`, no code (the browser hosts' text, `runtime-js/fs-path-invalid-arg-type`) | `ERR_INVALID_ARG_TYPE` |
| `url.resolve('https://example.com/a','b')`, `('http://a.com/b/c','../d')` | `b`, `../d` (wrong, silent) | = node | `https://example.com/b`, `http://a.com/d` |
| `url.parse('http://u:p@a.com:8/b?c=d#e')` `[auth,host,hostname,port,path,href]` | `[null,'u:p@a.com:8',null,null,null,…]` | `['u:p','a.com:8','a.com','8',null,…]`: `path` missing (rifty's own legacy parser, every host); no DEP0169 warning | `path` `'/b?c=d'`; DEP0169 on stderr |

Answer: yes for `URL`/`URLSearchParams` — every URL row turns into Node's result or into the
browser hosts' behaviour, without a forwarder and without touching runtime-js. What is left is
rifty's own gaps, which are the same on every host (`fs` arg error code, legacy `url.parse`).
The one ESM row now gives the declared `isolate-host.esm` gap instead of the leak.

## 2. The globals that stay ceilings

### Where the runtime reads them before guest code (measured)

`trace-load.mjs`: 23 reads, all at module load, the same for `runCode` and `exec`; none in
`setUp()` (`results-trace-load.json`). Each place:

| place | names | kind | if the ceiling were installed before the runtime |
|---|---|---|---|
| `runtime-js/src/internal/posix-file-url.ts:1` `URLConstructor = globalThis.URL` | URL | capture | the named gap (`isolate-host.URL`) |
| `runtime-js/src/builtins/url.ts:15` | URLSearchParams | capture | the named gap |
| `runtime-js/src/builtins/buffer.ts:42-43` object literal | Blob, File | capture | **the named gap** (measured: `new buffer.Blob` → `isolate-host.Blob`) |
| `runtime-js/src/builtins/crypto.ts:504` `subtle: webcrypto?.subtle` | crypto.subtle | getter read at load | **runtime load fails** (measured: the getter throws during load) |
| `runtime-js/src/builtins/timers.ts:267` `typeof MessageChannel === 'function' ? new MessageChannel() : null` | MessageChannel | detection + use at load | **runtime load fails** (measured: `new MessageChannel()` hits the thrower); `setImmediate` would lose its fallback |
| `runtime-js/src/internal/node-ipc-advanced.ts:23` | structuredClone | capture, used at call (advanced IPC serialization) | the named gap there |
| `runtime-js/src/builtins/stream-web.ts:39` loop over 14 names | ReadableStream … TextDecoderStream | detection with a loud fallback (`stream/web.<Name>`) | re-exports the thrower by identity: `isolate-host.ReadableStream` at construction (measured: `typeof` `function`; `=== globalThis` true with one install — `false` in the probe only because `setUp()` installs a second set) |
| `io/src/streams/from-web-validation.ts:34,38` `typeof X === 'function' ? X.prototype…locked getter` | ReadableStream, WritableStream | detection with a fallback | the thrower's `prototype` has no `locked`: same as absent today |

Reads at call time (grep `typeof`/`globalThis.` over `packages/{runtime-js,io,vfs,kernel,net}/src`,
non-test; not traced): `zlib.ts:219,250` (`typeof CompressionStream`), `net/src/http/server.ts`,
`net/src/ws/*` (`typeof Blob`/`BroadcastChannel`/`WebSocket`), `message-port-ref.ts:174`,
`io/src/host-broadcast-channel.ts:13`, `io/src/host-fetch.ts:7`. These see the late-installed thrower
(a `function`), so they take the "present" branch into a named gap or an `instanceof` that is false.
They are not in the class. `host-async-keepalive.ts:16`, named by review round 3, is not read in the
guest: the trace has no frame there.

Not covered by the trace: `'X' in globalThis` checks (a getter cannot see them), and reads in
modules that load lazily after `setUp()`.

### Smoke on `ceilings-first-ports-subtle-late`

With ports and `crypto.subtle` late, the runtime loads. The smoke matches base line for line: hello,
`require` json, fs write/read, timers, `setImmediate`, microtask, `fs.promises`, `TextDecoder`,
`Buffer`, `util.inspect`. `fs.createReadStream` gives the same named `isolate-host.ReadableStream`
error. `new buffer.Blob` becomes the named gap. `crypto.subtle` stays the base leak (it was deferred).

Side observation (base, unchanged by every variant): the guest's order is `micro`,
`promises xtext`, stream error, `immediate`, `timer`. Node's is `micro`, `immediate`, `stream`,
`promises`, `timer`. So `fs.promises.readFile` settles before `setImmediate` here. Not followed up.

### Recommendation for the seam

- A real implementation installed before the runtime, in `web-shim`'s place, and the name taken
  out of `CEILING_GLOBALS`. The class disappears for that name (measured for `URL`). This needs no
  forwarder, so the `new.target`/`globalThis` defects of the removed `loadedGlobal` seam cannot come
  back. The runtime depends on the guest's own intrinsic, captured before guest code, exactly as on
  the browser hosts.
- Names that stay ceilings: install the thrower before the runtime too, except where the trace shows
  a use at load. Then the captures (`buffer.Blob`/`File`, `structuredClone`, `stream/web`) give the
  named gap instead of a leaked `undefined`. The two exceptions need a one-line runtime change each:
  - `crypto.ts:504`: read `subtle` lazily, as a getter on the module object;
  - `timers.ts:267`: test for a real channel, not a function; or keep `MessageChannel`'s ceiling late
    until the guest has a real one.
- Order of fixes: the moment a name gets a real implementation, it moves from "ceiling" to
  "installed first". No third state.

## 3. ES modules (`url-esm`)

`url-esm` vs Node. `=` means stdout and exit code are equal:

| case | url-esm | node |
|---|---|---|
| `.mjs` entry: default + named imports from `node:fs` and a local `.mjs`, `import.meta.url`/`dirname`/`filename`/`resolve` | = | `file:///workspace/main.mjs`, `/workspace`, … |
| `"type": "module"` package entry (`typeof require` `undefined`) | = | |
| typeless `.js` with ESM syntax | = | |
| `import def, {a, b}` and `import *` from CJS (`a,b,default,module.exports` keys) | = | |
| `await import()` of cjs, mjs, `node:fs` from ESM; `import()` of mjs/cjs from a CJS file | = | |
| top-level `await` over a timer | = | |
| `require('./m.mjs')`, `process.features.require_module` | = (`true`, works) | `true`, works |
| `createRequire(import.meta.url)` + JSON `require` | = | |
| `import data from './data.json' with { type: 'json' }` | = | |
| uncaught `throw` in ESM | = exit 1; stderr `Error: boom\n at eval (/workspace/main.mjs:8:7)` | `file:///workspace/main.mjs:3` header + caret, `at file:///workspace/main.mjs:3:7` |
| syntax error / missing named export | = exit 1; rifty's text (`ModuleLoadError … Unexpected token (2:6)`; `SyntaxError … '/workspace/m.mjs' … (imported by …)`) | Node's `SyntaxError` with source header |
| ESM-only `nanoid` 5.1.16 (`import` from ESM; `import()`/`require` from CJS) | **exit 1 `TypeError: Buffer.allocUnsafe(...) is not a function`** | `21 5` |
| `import('data:text/javascript,…')` | `ModuleLoadError: Protocol in 'data:…' is not supported in M2.` | `42` |
| `-e "import('node:fs')…"` (`runCode`) | `isolate-host.dynamic-import`, exit 1 (same as base) | `function` |
| `-e "import fs from 'node:fs'; …"` | `isolate-host.node-eval-esm`, exit 1 (same as base) | `function` |

Besides `URL`, ESM in the isolate needs the following (evidence in the rows):

1. **Nothing in the loader itself.** Removing `declareNoEsmLoader` is enough. The loader is
   rifty's source transform to generator functions through `new Function`
   (`module-loader/esm-job-preparation.ts:106,147`); bare V8 has it. Every module-shape case above
   matches Node, including `require(esm)` with Node 24's default `require_module: true`. The
   `--no-require-module` deviation (ADR-0557 2026-11-24 line) goes away with the declaration.
2. **An ASI bug in rifty's ESM transform (all hosts by source; browsers not run).**
   `renderImportBinding` (`module-loader/esm-declaration-plan.ts:218-225`) rewrites an imported
   binding as `(ns().name)`. When that binding starts a line after a statement without a
   semicolon, the `(` continues the previous expression as a call. Minimal case
   `esm-asi-imported-binding`: `let a\na = String(1)\ncrypto.getRandomValues(…)` with `crypto`
   imported → `TypeError: String(...) is not a function`. Node prints `asi ok 1 2`. This is
   nanoid's stop. With a `;` added in a copied nanoid (diagnostic, not a route), the ESM entry,
   `import()` and `require` from CJS all match Node. Every semicolon-less (`standard`-style) ES
   module is exposed. Not filed: outside this probe's scope.
3. **Diagnostics differ.** The ESM error stack has the wrong line (`main.mjs:8:7` where Node says
   `:3:7`: the transform's line offset), a path instead of a file URL, and no source-line header.
   Syntax and link errors use rifty's text. The exit code is Node's. This belongs to the
   diagnostics direction (ROADMAP M14 F); not checked on browser hosts.
4. **`data:` URL import is rifty's gap on every host** (`runtime-js/process-module-loader-surface`
   row `data:` URL ESM import), and its message is not a named `NotImplementedError`.
5. **`-e` is a separate path.** `runNodeEvalScript` (`module-loader/loader.ts:736-751`) runs the
   source through indirect eval with no rewrite. A native `import()` there reaches isolated-vm's
   `importModuleDynamically` (`isolate-host/src/child/main.ts:162-167`), which ends the run.
   Files go through the loader's `import()` rewrite instead, so `import()` from a CJS file works.
   ESM syntax in `-e` is a V8 `SyntaxError` that `entry.ts` `esmGapOf` names. To go away: (a) apply
   the files' `import()` rewrite to `-e` source; (b) Node's module detection for `-e`
   (`backlog/runtime-js/node-cli-esm-eval-context`). Both are runtime-js changes shared with the
   browser hosts.

Estimate: file-based ESM is cheap once `URL` is in. It is the `declareNoEsmLoader` removal plus its
compat/ADR lines, the parity rows above as tests, and the ASI fix, which is a runtime-js bug on
every host. `-e` (items a, b) and `data:` are separate runtime-js work; they can stay named gaps
without blocking file ESM.

## 4. Warm call

`runCode('1')`, median of 40 after 5 warm-up calls, base and variant pools alternating twice
(`results-timing.jsonl`, load average 2.6–4.1):

| variant | median ms (run 1 / run 2) | p10–p90 |
|---|---|---|
| base | 12.96 / 13.04 | 11.95–13.48 |
| url-first (core-js URL) | 15.44 / 16.01 | 14.91–17.27 |
| url-esm | 15.51 / 15.46 | 14.55–16.09 |

So core-js's `URL` costs about +2.5 ms per warm call (+19 %), and +196 KB of bundle (7 123 270 →
7 319 056 bytes). That is core-js's cost, with its shared-state bootstrap, not the cost of `URL` in
general (source choice: the sources probe). Removing the ESM declaration adds nothing measurable.
core-js also leaves a visible `__core-js_shared__` global (Node has none), and its
`Function.prototype.toString` reports `[native code]` (`/tmp`-only diff script, not kept). Rerun
`--timing` in a quiet machine before quoting.

## Not verified

- Browser hosts: the ASI bug, the ESM stack line offset and the `-e` `import()` path were read
  from shared source, not run there.
- `'X' in globalThis` detection and lazily loaded modules (outside the trace).
- A single installation of the ceilings before the runtime (the probe installs twice). Identity
  `stream/web.X === globalThis.X` under it is inferred.
- ESM: `import.meta.resolve` of a package, `exports` conditions (`import`/`module-sync`),
  CJS named-export detection beyond `exports.a =`, cycles, `.wasm`/`.node` imports.
- Timing under a quiet load, and on Linux.
