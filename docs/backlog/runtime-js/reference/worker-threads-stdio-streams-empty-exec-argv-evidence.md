# worker-threads-stdio-streams-empty-exec-argv — evidence (PICKUP + Contract+RED, 2026-09-25)

Unit: `docs/backlog/runtime-js/worker-threads-stdio-streams-empty-exec-argv.md`. Decision: ADR-0449.
BASE `b5b385c6c1085f8df6248c0b44bd5eb5be9c79db`. Oracle host: Node v24.16.0, npm 11.17.0
(macOS arm64; `node --version` → `v24.16.0`, `npm --version` → `11.17.0`). Browser:
Playwright Chromium (browser-unit, e2e-prod). Probe scripts run as `node <file>`
from one scratch directory (`<o1>` options probes, `<o2>` stdio probes); `<node>`
is the host binary path. Each probe ran at least 3 times with identical output
unless noted. Committed carriers (parity cases, browser-unit fixtures, prod spec)
are their own Node artifacts: their sources are in the tree and their Node
outputs are pinned below.

## vitest 4.1.11 pool launch shapes (consumer)

Static, `node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js` (npm 11.17.0 install
of the goal scenario manifest, vite 8.0.16):

- `:3150-3163` `ForksPoolWorker.start`: `fork(this.entrypoint, [], { env, execArgv, stdio: "pipe", serialization: "advanced" })`, then `this._fork.stdout.pipe(this.stdout)` / `stderr.pipe(...)` with `setMaxListeners(1 + getMaxListeners())`.
- `:3228-3237` `ThreadsPoolWorker.start`: `new Worker(this.entrypoint, { env, execArgv, stdout: true, stderr: true })`, then `this._thread.stdout.pipe(this.stdout)` / `stderr.pipe(...)`; `stop()` (`:3238-3244`) `terminate()`s, then `unpipe`s.
- `:3798-3811` `resolveOptions`: `execArgv: [...process.execArgv.filter(--cpu-prof|--heap-prof|--diagnostic-dir), "--experimental-import-meta-resolve", ...(Deno || pnp ? [] : ["--require", suppressWarningsPath])]`.
- `:3812-3831` `resolveConditions`: vite ≥ 6 `ssr.resolve.conditions` → `--conditions <c>` pairs (`development|production` → `development` outside production); `:3727-3735` appends `project.config.execArgv`.
- `suppress-warnings.cjs` (verbatim in `tools/node-parity-runner/cases/process/startup-options-program.ts`) replaces `process.emit` to drop six experimental-feature warnings by message.
- A second `import.meta.resolve` argument: `startVitestModuleRunner.DB-7oCpn.js:471-474` (a test module's `import.meta.resolve`), `init.k9zZ9sLh.js:53` (custom environments), `nativeModuleMocker.BkNfQMkH.js:165,171`.

Live capture (goal scenario project; a test file prints its own `process.execArgv`, cwd replaced by `<root>`), under `env -u AI_AGENT -u CLAUDECODE -u CLAUDE_CODE -u CODEX_SANDBOX -u CODEX_THREAD_ID -u CURSOR_AGENT -u GEMINI_CLI -u OPENCODE -u REPL_ID -u NO_COLOR -u FORCE_COLOR -u CI` (traps vitest-oracle-agent-env):

```text
$ node node_modules/vitest/vitest.mjs run src/argv.test.ts
EXECARGV fork ["--experimental-import-meta-resolve","--require","<root>/node_modules/vitest/suppress-warnings.cjs","--conditions","node","--conditions","development"]
IMR function
 Test Files  1 passed (1)
$ node node_modules/vitest/vitest.mjs run --pool=threads src/argv.test.ts
EXECARGV thread ["--experimental-import-meta-resolve","--require","<root>/node_modules/vitest/suppress-warnings.cjs","--conditions","node","--conditions","development"]
IMR function
 Test Files  1 passed (1)
```

## Node's Worker stdio model (source)

`process.binding('natives')['internal/worker']`, Node v24.16.0:

- `:209-210` `if (options.execArgv) validateArray(options.execArgv, 'options.execArgv')`: only a truthy value is validated; a falsy one inherits.
- `:284-286` `if (this[kHandle].invalidExecArgv) throw new ERR_WORKER_INVALID_EXEC_ARGV(...)`.
- `:304-318` `stdin = options.stdin ? new WritableWorkerStdio(...) : null`; `stdout`/`stderr` are always `ReadableWorkerStdio`; `if (!options.stdout) { stdout[kIncrementsPortRef] = false; pipeWithoutWarning(stdout, process.stdout); }` (same for stderr).
- `:385-402` `[kOnExit]`: drains both ports (queued `STDIO_PAYLOAD` chunks are pushed), unrefs, `[kDispose]()` (`stdout.push(null)` / `stderr.push(null)` unless ended), then `emit('exit', code)`.
- `:523-534` `stdin`/`stdout`/`stderr` are prototype getters.
- `internal/worker/io:250-277` `ReadableWorkerStdio._read` refs the port while a `stdout: true` stream is read (`kIncrementsPortRef`).

## Stdio probes

Worker scripts in `<o2>`: `w-log.cjs` (`console.log('from-worker'); console.error('err-worker'); process.stdout.write('raw-out\n')`), `w-burst.cjs` (1000 `process.stdout.write` lines, then `process.exit(3)`), `w-stream.cjs` (a `setInterval` write every 5 ms), `w-late.cjs` (`console.log('w1'); parentPort.postMessage('m1'); console.log('w2')`), `w-slow.cjs` (`setTimeout(() => console.log('slow-out'), 300)`). s1 constructs a default and a `{ stdout: true, stderr: true, stdin: true }` Worker and prints types; s2 runs the burst with `stdout: true` and terminates `w-stream` after its third chunk; s3 runs the burst with default options; s4 records `'data'`/`'message'`/`'exit'` order; s5 runs `w-slow` with `stdout: true` never read (`unread`), `unref()` + read (`unref-read`), `unref()` only, or default + `unref()`; s6 is vitest's shape (`{ env: process.env, execArgv: [], stdout: true, stderr: true }`, pipe, `unpipe` a tick after `'exit'`).

```text
$ node s1-types.cjs  (stderr shown separately)
default true true null function
capture true true true true
own false proto-getter function
from-worker
raw-out
default-exit 0
capture-exit 0 ["out:from-worker\n","err:err-worker\n","out:raw-out\n"]
[stderr] err-worker

$ node s2-order.cjs (x3)
burst-exit 3 lines=1000|burst-end lines=1000|burst-close|term-exit 1|term-end|terminate-resolved 1|after-terminate-chunks>0 false|
burst-exit 3 lines=1000|burst-end lines=1000|burst-close|term-exit 1|term-end|terminate-resolved 1|after-terminate-chunks>0 false|
burst-exit 3 lines=1000|burst-end lines=1000|burst-close|term-exit 1|term-end|terminate-resolved 1|after-terminate-chunks>0 false|

$ node s3-default.cjs | tail -2 ; wc -l
line 999
exit 3
    1001

$ node s4-msg.cjs (x5: stdout vs message order)
data "w1\n"|message m1|data "w2\n"|exit 0|
data "w1\n"|data "w2\n"|message m1|exit 0|
data "w1\n"|message m1|data "w2\n"|exit 0|
data "w1\n"|message m1|data "w2\n"|exit 0|
data "w1\n"|message m1|data "w2\n"|exit 0|

$ node s5-keep.cjs <mode>
== unread
exit 0
process-exit
== unref-read
got slow-out
process-exit
== unref-noread
process-exit
== default-unref
process-exit

$ node s6-vitest.cjs
from-worker
raw-out
exit 0 ended false false
after-tick ended true stdout-writable true
still-writable
```

- s1: every Worker has Readable `stdout`/`stderr` (prototype getters); `stdin` is `null` unless `stdin: true`; default output reaches the parent's streams, captured output does not.
- s2/s3: all 1000 lines arrive before `'exit'` 3; `'end'` follows `'exit'`; `terminate()` mid-output gives `'exit'` 1, then `'end'`, then the promise resolves 1.
- s4: the order between a worker's stdout chunks and its `'message'` events varies run to run: not claimed.
- s5: an unread `stdout: true` stream holds nothing (`unread` → `exit 0`); an `unref()`'d Worker whose captured stream is read keeps the parent until data arrives, but its `'exit'` is not delivered (`unref-read`): timing-dependent, not claimed.
- s6: vitest's shape: output arrives once through the pipe; `readableEnded` is `false` in `'exit'` and `true` a tick later; the parent's stdout stays writable after `unpipe`.

## Startup options — CLI spellings, conditions, preloads

`node_modules/cpkg/package.json`: `{"name":"cpkg","exports":{".":{"custom":"./custom.js","development":"./dev.js","import":"./imp.mjs","require":"./req.js","default":"./def.js"},"./sub":{"custom":"./custom-sub.js","default":"./def-sub.js"}},"imports":{}}` (each target exports its own name). `node_modules/ipkg/package.json`: `{"name":"ipkg","type":"commonjs","imports":{"#dep":{"custom":"./i-custom.js","default":"./i-def.js"}},"exports":"./main.js"}`.

- `cond.cjs`: `const r = require('cpkg'); const rr = require.resolve('cpkg/sub').replace(process.cwd(), '<cwd>'); import('cpkg').then((m) => {   console.log('require', r, 'require.resolve', rr, 'dynamic-import', m.default, 'execArgv', JSON.stringify(process.execArgv)); });`
- `cond.mjs`: `import s from 'cpkg'; import sub from 'cpkg/sub'; const d = await import('cpkg'); console.log('static', s, 'sub', sub, 'dynamic', d.default, 'meta', import.meta.resolve('cpkg').replace(process.cwd(), '<cwd>').replace(/^.*\//, ''));`
- `pre.cjs` (CLI probe): `console.log('preload', 'main-undefined', require.main === undefined, 'module.id', module.id === require.resolve('./pre.cjs') ? 'abs' : module.id, 'argv1', require('node:path').basename(process.argv[1] || ''), 'execArgv', JSON.stringify(process.execArgv)); globalThis.__pre = (globalThis.__pre || []).concat('pre');`; `pre2.cjs` prints `preload2` and pushes `'pre2'`; `main.cjs`: `console.log('main', JSON.stringify(globalThis.__pre), 'require.main===module', require.main === module);`; `precond.cjs`: `console.log('pre-cond', require('cpkg'), require('node:path').basename(require.resolve('cpkg')));`.

```text
$ node --version
v24.16.0

$ bash cond.sh   # node [flags] cond.cjs; node [flags] cond.mjs
== []
require req require.resolve <cwd>/node_modules/cpkg/def-sub.js dynamic-import imp execArgv []
static imp sub def-sub dynamic imp meta imp.mjs
== [--conditions custom]
require custom require.resolve <cwd>/node_modules/cpkg/custom-sub.js dynamic-import custom execArgv ["--conditions","custom"]
static custom sub custom-sub dynamic custom meta custom.js
== [-C custom]
require custom require.resolve <cwd>/node_modules/cpkg/custom-sub.js dynamic-import custom execArgv ["-C","custom"]
static custom sub custom-sub dynamic custom meta custom.js
== [--conditions=custom]
require custom require.resolve <cwd>/node_modules/cpkg/custom-sub.js dynamic-import custom execArgv ["--conditions=custom"]
static custom sub custom-sub dynamic custom meta custom.js
== [-C=custom]
node: bad option: -C=custom
node: bad option: -C=custom
== [-Ccustom]
node: bad option: -Ccustom
node: bad option: -Ccustom
== [--conditions development]
require dev require.resolve <cwd>/node_modules/cpkg/def-sub.js dynamic-import dev execArgv ["--conditions","development"]
static dev sub def-sub dynamic dev meta dev.js
== [--conditions node --conditions development]
require dev require.resolve <cwd>/node_modules/cpkg/def-sub.js dynamic-import dev execArgv ["--conditions","node","--conditions","development"]
static dev sub def-sub dynamic dev meta dev.js
== [--conditions development --conditions custom]
require custom require.resolve <cwd>/node_modules/cpkg/custom-sub.js dynamic-import custom execArgv ["--conditions","development","--conditions","custom"]
static custom sub custom-sub dynamic custom meta custom.js

$ node precond probe: node -C custom -r ./precond.cjs -e 0
pre-cond custom custom.js

$ bash pre.sh   # node [flags] main.cjs
== [--require ./pre.cjs]
preload main-undefined true module.id abs argv1 main.cjs execArgv ["--require","./pre.cjs"]
main ["pre"] require.main===module true
exit 0
== [-r ./pre.cjs]
preload main-undefined true module.id abs argv1 main.cjs execArgv ["-r","./pre.cjs"]
main ["pre"] require.main===module true
exit 0
== [--require=./pre.cjs]
preload main-undefined true module.id abs argv1 main.cjs execArgv ["--require=./pre.cjs"]
main ["pre"] require.main===module true
exit 0
== [-r=./pre.cjs]
node: bad option: -r=./pre.cjs
exit 9
== [--require pre.cjs]
node:internal/modules/cjs/loader:1503
  throw err;
  ^

Error: Cannot find module 'pre.cjs'
exit 1
== [--require prepkg]
prepkg-preload
main ["prepkg"] require.main===module true
exit 0
== [--require ./pre.cjs --require ./pre2.cjs]
preload main-undefined true module.id abs argv1 main.cjs execArgv ["--require","./pre.cjs","--require","./pre2.cjs"]
preload2
main ["pre","pre2"] require.main===module true
exit 0
== [--require ./missing.cjs]
node:internal/modules/cjs/loader:1503
  throw err;
  ^

Error: Cannot find module './missing.cjs'
exit 1
== [--require]
node:internal/modules/cjs/loader:1503
  throw err;
  ^

Error: Cannot find module 'main.cjs'
exit 1
== esm entry
preload main-undefined true module.id abs argv1 main.mjs execArgv ["--require","./pre.cjs"]
main-esm ["pre"]
```

- Accepted spellings: `--conditions <c>`, `-C <c>`, `--conditions=<c>`, `--require <s>`, `-r <s>`, `--require=<s>`. `-C=<c>`, `-Ccustom` and `-r=<s>` are `bad option` (exit 9). `process.execArgv` keeps the exact tokens.
- The package's `exports` key order decides (`custom` is listed before `development`, so both flags select `custom`). Conditions reach require, `require.resolve`, static and dynamic import, `import.meta.resolve`, package `imports` (below) and the preload's own resolution (`pre-cond custom`).
- A preload runs before the entry, in order, with `require.main === undefined` and `process.argv`/`process.execArgv` already set. `./x` resolves from the cwd, a bare name from the cwd's `node_modules`; a missing one is `Error: Cannot find module …` (`Require stack: - internal/preload`), exit 1.

## Startup options — import.meta.resolve, preload errors, Worker operands

- `imr.mjs`: `console.log('one-arg', import.meta.resolve('./a.mjs').replace(process.cwd(), '<cwd>')); try { console.log('two-arg', import.meta.resolve('./a.mjs', new URL('./sub/x.mjs', import.meta.url).href).replace(process.cwd(), '<cwd>')); } catch (e) { console.log('two-arg-throw', e.code, e.message); } console.log('pkg', import.meta.resolve('cpkg').replace(process.cwd(), '<cwd>'));`
- `imr2.mjs`: `show(label, f)` prints the result relative to `<o1>/` or `throw name code message`, for: url-object `import.meta.resolve('./a.mjs', new URL('./sub/x.mjs', import.meta.url))`, dir-parent `('./a.mjs', new URL('./sub/', import.meta.url).href)`, bad-parent `('./a.mjs', 'not a url')`, bare-parent `('cpkg', <sub URL>)`, undefined-parent `('./a.mjs', undefined)`, missing `('./nope.mjs', <sub URL>)`, builtin `('node:fs', <sub URL>)`, ipkg `('ipkg')`.

```text
$ node imr.mjs / --experimental-import-meta-resolve / + --conditions custom
== no flag
one-arg file://<cwd>/a.mjs
two-arg file://<cwd>/a.mjs
pkg file://<cwd>/node_modules/cpkg/imp.mjs
== flag
one-arg file://<cwd>/a.mjs
two-arg file://<cwd>/sub/a.mjs
pkg file://<cwd>/node_modules/cpkg/imp.mjs
== flag + conditions custom
one-arg file://<cwd>/a.mjs
two-arg file://<cwd>/sub/a.mjs
pkg file://<cwd>/node_modules/cpkg/custom.js

$ node [--experimental-import-meta-resolve] imr2.mjs
== flag
url-object sub/a.mjs
dir-parent sub/a.mjs
bad-parent throw TypeError ERR_UNSUPPORTED_RESOLVE_REQUEST Failed to resolve module specifier "./a.mjs" from "not a url": Invalid relative URL or base scheme is not hierarchical.
bare-parent node_modules/cpkg/imp.mjs
undefined-parent a.mjs
missing sub/nope.mjs
builtin node:fs
ipkg node_modules/ipkg/main.js
== noflag
url-object a.mjs
dir-parent a.mjs
bad-parent a.mjs
bare-parent node_modules/cpkg/imp.mjs
undefined-parent a.mjs
missing nope.mjs
builtin node:fs
ipkg node_modules/ipkg/main.js
$ package imports (#dep) with -C custom / without
i-custom
i-def

$ Worker operand edge cases
["--require","--conditions","custom"] throw ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --require requires an argument
["-C","-r","./pre.cjs"] throw ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: -C requires an argument
["--conditions","-"] throw ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --conditions requires an argument
["--require=","x"] throw ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --require= requires an argument
["--conditions="] throw ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --conditions= requires an argument
["--require",""] error-event ERR_INVALID_ARG_VALUE The argument 'id' must be a non-empty string. Received ''
["--require",""] exit 1

$ missing / throwing preload
fork {"code":1,"err":"node:internal/modules/cjs/loader:1503|  throw err;|  ^||Error: Cannot find module './missing.cjs'|Require stack:|- internal/preload|    at Module._resolveFilename (node:internal/modules/cjs/loader:1500:15)"}
worker error Error MODULE_NOT_FOUND "Cannot find module './missing.cjs'\nRequire stack:\n- internal/preload" ["internal/preload"]
worker exit 1
worker error Error pre-boom
worker exit 1
```

- Without `--experimental-import-meta-resolve`, Node 24 ignores the second argument. With it, the argument (a string or a URL) is the parent; an unparsable parent is `TypeError` `ERR_UNSUPPORTED_RESOLVE_REQUEST`.
- Worker operand errors: an absent operand, one starting with `-`, or an empty `=` value throws `ERR_WORKER_INVALID_EXEC_ARGV` `<flag> requires an argument` from the constructor.
- A missing Worker preload gives `'error'` (`MODULE_NOT_FOUND`, `requireStack: ['internal/preload']`), then `'exit'` 1; a throwing one gives `'error'` (the thrown Error), then `'exit'` 1. rifty's kernel path emits no `'error'` for a worker-runtime throw (existing gap `runtime-js/worker-threads-kernel-error-event`), so only the exit code is claimed.

## Startup options — Worker

`wchild.cjs`: `const { parentPort } = require('node:worker_threads'); console.log('worker', JSON.stringify(process.execArgv), 'pre', JSON.stringify(globalThis.__pre ?? null), 'cond', require('cpkg'));`. `wchild.mjs`: `import c from 'cpkg'; const d = await import('cpkg'); console.log('worker-esm', JSON.stringify(process.execArgv), 'pre', JSON.stringify(globalThis.__pre ?? null), 'static', c, 'dynamic', d.default, 'meta', import.meta.resolve('cpkg').replace(/^.*\//, ''), 'two-arg', import.meta.resolve('./a.mjs', new URL('./sub/x.mjs', import.meta.url).href).replace(/^.*\/o1\//, ''));`. `wnest.cjs`: `const { Worker, isMainThread } = require('node:worker_threads'); const path = require('node:path'); new Worker(path.resolve('wchild.cjs')).on('exit', (c) => console.log('nested exit', c));`.

`worker-explicit.cjs` runs `new Worker(path.resolve(file), { execArgv })` sequentially for `[wchild.cjs, []]`, `[wchild.cjs, ['--require','./pre.cjs']]`, `[wchild.cjs, ['-r','./pre.cjs','-C','custom']]`, `[wchild.mjs, ['--require=./pre.cjs','--conditions=custom','--experimental-import-meta-resolve']]`, `[wchild.mjs, vitest's four flags with ./pre.cjs]`, `[wchild.mjs, []]`. `worker-invalid.cjs` constructs one Worker per `execArgv` value in `[['--foo'], ['--require'], ['-r'], ['--conditions'], ['-C'], ['--no-warnings'], ['--enable-source-maps'], ['--import','./a.mjs'], ['--experimental-vm-modules'], ['--max-old-space-size=100'], ['--inspect'], ['-e','x'], ['--title=x'], ['--require','./missing.cjs'], 'str', 5, null, 0, '', {}, [1], ['-r=./pre.cjs'], ['--conditions','']]`. `worker-default.cjs <label>` creates `new Worker(path.resolve('wchild.cjs'))`, after `process.execArgv.push('--conditions=custom')` (`mutated`) or `process.execArgv = ['--conditions=custom']` (`replaced`); the parent runs as `node worker-default.cjs plain`, `node --require ./pre2.cjs … req`, `node -C custom … cond`, `node … mutated`, `node … replaced`, `node --conditions=custom … mutated`.

```text
$ node worker-explicit.cjs
worker [] pre null cond req
exit 0
preload main-undefined true module.id abs argv1  execArgv ["--require","./pre.cjs"]
worker ["--require","./pre.cjs"] pre ["pre"] cond req
exit 0
preload main-undefined true module.id abs argv1  execArgv ["-r","./pre.cjs","-C","custom"]
worker ["-r","./pre.cjs","-C","custom"] pre ["pre"] cond custom
exit 0
preload main-undefined true module.id abs argv1  execArgv ["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"]
worker-esm ["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"] pre ["pre"] static custom dynamic custom meta custom.js two-arg sub/a.mjs
exit 0
preload main-undefined true module.id abs argv1  execArgv ["--experimental-import-meta-resolve","--require","./pre.cjs","--conditions","node","--conditions","development"]
worker-esm ["--experimental-import-meta-resolve","--require","./pre.cjs","--conditions","node","--conditions","development"] pre ["pre"] static dev dynamic dev meta dev.js two-arg sub/a.mjs
exit 0
worker-esm [] pre null static imp dynamic imp meta imp.mjs two-arg a.mjs
exit 0

$ node worker-invalid.cjs
["--foo"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --foo
["--require"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --require requires an argument
["-r"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: -r requires an argument
["--conditions"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --conditions requires an argument
["-C"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: -C requires an argument
worker ["--no-warnings"] pre null cond req
["--no-warnings"] exit 0
worker ["--enable-source-maps"] pre null cond req
["--enable-source-maps"] exit 0
worker ["--import","./a.mjs"] pre null cond req
["--import","./a.mjs"] exit 0
worker ["--experimental-vm-modules"] pre null cond req
["--experimental-vm-modules"] exit 0
["--max-old-space-size=100"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --max-old-space-size=100
worker ["--inspect"] pre null cond req
["--inspect"] exit 0
worker ["-e","x"] pre null cond req
["-e","x"] exit 0
["--title=x"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: --title=x
["--require","./missing.cjs"] error-event MODULE_NOT_FOUND Cannot find module './missing.cjs'
["--require","./missing.cjs"] exit 1
"str" throw TypeError ERR_INVALID_ARG_TYPE The "options.execArgv" property must be an instance of Array. Received type string ('str')
5 throw TypeError ERR_INVALID_ARG_TYPE The "options.execArgv" property must be an instance of Array. Received type number (5)
worker [] pre null cond req
null exit 0
worker [] pre null cond req
0 exit 0
worker [] pre null cond req
"" exit 0
{} throw TypeError ERR_INVALID_ARG_TYPE The "options.execArgv" property must be an instance of Array. Received an instance of Object
worker [] pre null cond req
[1] exit 0
["-r=./pre.cjs"] throw Error ERR_WORKER_INVALID_EXEC_ARGV Initiated Worker with invalid execArgv flags: -r=./pre.cjs
worker ["--conditions",""] pre null cond req
["--conditions",""] exit 0

$ worker default inheritance
worker [] pre null cond req
plain exit 0
preload2
preload2
worker ["--require","./pre2.cjs"] pre ["pre2"] cond req
req exit 0
worker ["-C","custom"] pre null cond custom
cond exit 0
worker [] pre null cond req
mutated exit 0
worker [] pre null cond req
replaced exit 0
worker ["--conditions=custom"] pre null cond custom
mutated exit 0
$ node -e "new Worker(wchild.cjs)"
worker ["-e","<src>"] pre null cond req
exit 0
$ nested: outer Worker(wnest.cjs, {execArgv:[--require ./pre2.cjs -C custom]}) -> inner Worker(wchild.cjs) default
preload2
preload2
worker ["--require","./pre2.cjs","-C","custom"] pre ["pre2"] cond custom
nested exit 0
outer exit 0
```

- An explicit `execArgv` becomes the worker's exact `process.execArgv`; preloads and conditions apply in the worker (CJS and ESM entries).
- A falsy or omitted `execArgv` inherits the parent thread's original startup options: mutating or replacing the parent's public `process.execArgv` changes nothing, and nested Workers inherit from their parent Worker. An eval parent's worker inherits `["-e","<src>"]` and still runs its file (draft `runtime-js/worker-threads-inherited-exec-argv`).
- Node rejects some flags for Workers (`--foo`, `--max-old-space-size=100`, `--title=x`, `-r=./pre.cjs`) and accepts others (`--no-warnings`, `--enable-source-maps`, `--import`, `--experimental-vm-modules`, `--inspect`, `-e`). rifty names every flag outside the three families (§Unsupported flags).
- A truthy non-array is `ERR_INVALID_ARG_TYPE`; `null`, `0` and `''` inherit; `[1]` runs with `[]` (not claimed: rifty names a non-string entry).

## Startup options — fork

`fchild.cjs`: `console.log('child', JSON.stringify(process.execArgv), 'pre', JSON.stringify(globalThis.__pre ?? null), 'cond', require('cpkg'));`. `fork-explicit.cjs` forks `./fchild.cjs` once per `execArgv` in `[[], ['--require','./pre.cjs'], ['-r','./pre.cjs','-C','custom'], ['--require=./pre.cjs','--conditions=custom','--experimental-import-meta-resolve'], vitest's four flags with ./pre.cjs]`. `fork-cwd.cjs`: `const { fork } = require('node:child_process'); const path = require('node:path'); const c = fork(path.resolve('fchild.cjs'), [], { cwd: 'sub', execArgv: ['--require', './pre.cjs'] }); c.on('exit', (code) => console.log('exit', code));` (`sub/pre.cjs` prints `preload-sub`). `fork-default.cjs <label>` forks `./fchild.cjs` without `execArgv` (`mutated` pushes `--conditions=custom` first); it runs as `node fork-default.cjs plain`, `node --require ./pre2.cjs fork-default.cjs req`, `node -C custom fork-default.cjs cond`, `node fork-default.cjs mutated`. `fork-misc.cjs` forks with `execArgv` in `[['--require'], ['--require','./missing.cjs'], ['--no-warnings'], ['--foo'], 'str', ['--require','--conditions','custom']]` and piped stdio.

```text
$ node fork-explicit.cjs
child [] pre null cond req
exit 0
preload main-undefined true module.id abs argv1 fchild.cjs execArgv ["--require","./pre.cjs"]
child ["--require","./pre.cjs"] pre ["pre"] cond req
exit 0
preload main-undefined true module.id abs argv1 fchild.cjs execArgv ["-r","./pre.cjs","-C","custom"]
child ["-r","./pre.cjs","-C","custom"] pre ["pre"] cond custom
exit 0
preload main-undefined true module.id abs argv1 fchild.cjs execArgv ["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"]
child ["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"] pre ["pre"] cond custom
exit 0
preload main-undefined true module.id abs argv1 fchild.cjs execArgv ["--experimental-import-meta-resolve","--require","./pre.cjs","--conditions","node","--conditions","development"]
child ["--experimental-import-meta-resolve","--require","./pre.cjs","--conditions","node","--conditions","development"] pre ["pre"] cond dev
exit 0

$ node fork-cwd.cjs  # fork(abs fchild.cjs, [], {cwd: "sub", execArgv: ["--require","./pre.cjs"]})
preload-sub main-undefined true module.id abs argv1 fchild.cjs execArgv ["--require","./pre.cjs"]
child ["--require","./pre.cjs"] pre ["pre"] cond req
exit 0

$ fork default inheritance
child [] pre null cond req
plain exit 0
preload2
preload2
child ["--require","./pre2.cjs"] pre ["pre2"] cond req
req exit 0
child ["-C","custom"] pre null cond custom
cond exit 0
child ["--conditions=custom"] pre null cond custom
mutated exit 0
$ node -e "fork(./fchild.cjs)"
parent ["-e","<src>"] string
child [] pre null cond req
exit 0
$ node -r ./pre2.cjs -e "fork(./fchild.cjs)"
preload2
preload2
child ["-r","./pre2.cjs"] pre ["pre2"] cond req
exit 0

$ node fork-misc.cjs
["--require"] exit 0 out "child [\"--require\",\"./fchild.cjs\"] pre null cond req\n" err ""
["--require","./missing.cjs"] exit 1 out "" err "node:internal/modules/cjs/loader:1503|  throw err;|  ^||Error: Cannot find module './missing.cjs'|Require stack:"
["--no-warnings"] exit 0 out "child [\"--no-warnings\"] pre null cond req\n" err ""
["--foo"] exit 9 out "" err "<node>: bad option: --foo|"
"str" exit 1 out "" err "node:internal/modules/cjs/loader:1503|  throw err;|  ^||Error: Cannot find module '<o1>/s'|    at Module._resolveFilename (node:internal/modules/cjs/loader:1500:15)"
["--require","--conditions","custom"] exit 9 out "" err "<node>: --require requires an argument|"
```

- fork prepends `execArgv` to the child's node argv: the child's exact `process.execArgv`, preloads from the child's cwd (the `cwd` option), conditions everywhere.
- Default: the parent's public `process.execArgv` at the call (a pushed token is inherited), minus the eval pair (`node -e` → `[]`; `node -r ./pre2.cjs -e` → `["-r","./pre2.cjs"]`). `process._eval` is the source string.
- Usage errors belong to the child: `bad option` and `requires an argument` exit 9. `['--require']` is not one: it takes the module path as the preload (§fork operands). A string is spread into characters. rifty names each (§Unsupported flags).

## Startup options — fork operands, eval-pair identity, rejected Worker allocation

Contract+RED r1 reception (the review found the contract claiming Node's fork child exits 9 for an absent operand). Scratch directory `<dir>`; `fop-child.cjs`: `process.stdout.write('child ' + JSON.stringify(process.execArgv) + ' argv ' + JSON.stringify(process.argv.slice(1)) + ' main ' + (require.main === module) + '\n');`; `fprint.cjs`: `console.log('eval ' + process.argv[2] + ' child ' + JSON.stringify(process.execArgv));`; `w.cjs` is empty. `fork-operands.cjs` forks the absolute `<dir>/fop-child.cjs` once per `execArgv` in the rows below with `stdio: ['pipe','pipe','pipe','ipc']`, ending the child's stdin at once. `fork-operand-stdin.cjs` forks it with `['--require']`, `['--conditions']` and `['-C']`, once writing a one-line program to the child's stdin and ending it (`src`), once leaving stdin open and killing the child after 1500 ms (`open`). `tid.cjs` constructs Workers with `execArgv` `['--require']`, `['--conditions=']`, `['-C','-']` and `'str'`, then a valid one (`['--require','./missing.cjs']`), and prints its `threadId` and its `'exit'` code. `nohold.cjs` runs the same four, then prints `process.getActiveResourcesInfo()` and its own `'exit'` code. The last `exit` line of each block is the shell's `$?`. Three runs each gave identical output (Node v24.16.0):

```text
$ node fork-operands.cjs
["--require"] exit 0 null out "child [\"--require\",\"<dir>/fop-child.cjs\"] argv [] main false\n" err ""
["-r"] exit 0 null out "child [\"-r\",\"<dir>/fop-child.cjs\"] argv [] main false\n" err ""
["--conditions"] exit 0 null out "" err ""
["-C"] exit 0 null out "" err ""
["--require","--conditions","custom"] exit 9 null out "" err "<node>: --require requires an argument"
["-r","-x"] exit 9 null out "" err "<node>: -r requires an argument"
["-C","-"] exit 9 null out "" err "<node>: -C requires an argument"
["--conditions","-"] exit 9 null out "" err "<node>: --conditions requires an argument"
["--conditions="] exit 9 null out "" err "<node>: --conditions= requires an argument"
["--require="] exit 9 null out "" err "<node>: --require= requires an argument"
["--require=","x"] exit 9 null out "" err "<node>: --require= requires an argument"
["-r=./x.cjs"] exit 9 null out "" err "<node>: bad option: -r=./x.cjs"
["-C","custom","--require"] exit 0 null out "child [\"-C\",\"custom\",\"--require\",\"<dir>/fop-child.cjs\"] argv [] main false\n" err ""
exit 0

$ node fork-operand-stdin.cjs
["--require"] src exit 0 null out "child [\"--require\",\"<dir>/fop-child.cjs\"] argv [] main false\nstdin-program [\"--require\",\"<dir>/fop-child.cjs\"] argv []\n" err ""
["--require"] open still running after 1500ms, out "child [\"--require\",\"<dir>/fop-child.cjs\"] argv [] main false\n"
["--require"] open exit null SIGTERM out "child [\"--require\",\"<dir>/fop-child.cjs\"] argv [] main false\n" err ""
["--conditions"] src exit 0 null out "stdin-program [\"--conditions\",\"<dir>/fop-child.cjs\"] argv []\n" err ""
["--conditions"] open still running after 1500ms, out ""
["--conditions"] open exit null SIGTERM out "" err ""
["-C"] src exit 0 null out "stdin-program [\"-C\",\"<dir>/fop-child.cjs\"] argv []\n" err ""
["-C"] open still running after 1500ms, out ""
["-C"] open exit null SIGTERM out "" err ""
exit 0

$ node -e "const { fork } = require('node:child_process'); fork('./fprint.cjs', ['default']).on('exit', () => fork('./fprint.cjs', ['explicit'], { execArgv: process.execArgv }))"
eval default child []
eval explicit child []
exit 0
$ node -e "if (process.argv.length > 1) console.log('copy child re-ran the eval source; argv', JSON.stringify(process.argv.slice(1)), 'execArgv[0]', process.execArgv[0]); else require('node:child_process').fork('./fprint.cjs', ['copy'], { execArgv: [...process.execArgv] })"
copy child re-ran the eval source; argv ["./fprint.cjs","copy"] execArgv[0] -e
exit 0
$ node tid.cjs
["--require"] throw ERR_WORKER_INVALID_EXEC_ARGV
["--conditions="] throw ERR_WORKER_INVALID_EXEC_ARGV
["-C","-"] throw ERR_WORKER_INVALID_EXEC_ARGV
"str" throw ERR_INVALID_ARG_TYPE
next threadId 1
exit 1
exit 0

$ node nohold.cjs
["--require"] throw ERR_WORKER_INVALID_EXEC_ARGV
["--conditions="] throw ERR_WORKER_INVALID_EXEC_ARGV
["-C","-"] throw ERR_WORKER_INVALID_EXEC_ARGV
"str" throw ERR_INVALID_ARG_TYPE
active resources []
exit 0
exit 0
```

Source (`process.binding('natives').child_process`, `fork`, v24.16.0):

```js
  execArgv = options.execArgv || process.execArgv;
  validateArgumentsNullCheck(execArgv, 'options.execArgv');

  if (execArgv === process.execArgv && process._eval != null) {
    const index = ArrayPrototypeLastIndexOf(execArgv, process._eval);
    if (index > 0) {
      // Remove the -e switch to avoid fork bombing ourselves.
      execArgv = ArrayPrototypeSlice(execArgv);
      ArrayPrototypeSplice(execArgv, index - 1, 2);
    }
  }

  args = [...execArgv, modulePath, ...args];
```

- fork puts the module path right after `execArgv`, so a trailing flag never lacks an operand. `--require`/`-r` take the module path as a preload (it runs with `require.main !== module`); `--conditions`/`-C` take it as a condition (it never runs). The child then has no entry and runs the program it reads from stdin: exit 0 once stdin ends, still running while it stays open. Only a `-`-leading operand or an empty `=` value is the child's usage error (`<flag> requires an argument`, exit 9). rifty names all of them (ADR-0449 §2; ceiling test).
- The eval pair is dropped by identity. An omitted `execArgv` and an explicit `{ execArgv: process.execArgv }` both give `[]`. A copy keeps `-e <src>`, so the child re-runs the eval source; without the probe's guard it forks again without end.
- A Worker `execArgv` that Node rejects allocates no thread id (the next Worker gets 1) and holds nothing (no active resources; exit 0).

## Unsupported flags (rifty ceiling)

Node accepts `--no-warnings`, `--import`, `--experimental-vm-modules`, `--inspect` and `-e` for Workers (§Worker) and any valid node option for fork (§fork: `--no-warnings` exits 0). rifty carries only the three families; every other token is `NotImplementedError('worker_threads.Worker.execArgv' | 'child_process.fork.execArgv')` naming it (ADR-0449 §2). vitest's `vmThreads`/`vmForks` pools add `--experimental-vm-modules` (map §Out of scope: loud).

## Parity cases — Node artifacts

`npx tsx /tmp/vgoal/u11/node-only.mts <case>` runs a case's Node side through the runner's own `runInNode` and compares it with `expected`. Five repetitions each gave 35/35 `expected-match=true`:

```text
== worker_threads/stdio-streams.case.ts run 0 expected-match=true
== worker_threads/stdio-exit-order.case.ts run 0 expected-match=true
== worker_threads/exec-argv-startup.case.ts run 0 expected-match=true
== worker_threads/exec-argv-validation.case.ts run 0 expected-match=true
== child_process/fork-exec-argv.case.ts run 0 expected-match=true
== worker_threads/vitest-pool-shape.case.ts run 0 expected-match=true
== child_process/vitest-pool-shape.case.ts run 0 expected-match=true
```

## Browser-unit and prod programs — Node artifacts

`runStartupProgramInNode` from `tests/browser-unit/fixtures/worker-stdio-exec-argv-cases.ts` (the spec's live oracle); rows are the lines starting `SX|`, `pool `, `thread ` or `fork `:

```text
== worker-default-stdout v24.16.0 code 0
SX|from-worker console.log
SX|from-worker stdout.write
SX|exit 0
== nested-worker-inherit v24.16.0 code 0
SX|inner {"execArgv":["--require","./pre.cjs","-C","custom"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs","-C","custom"],"cpkg":"custom"},"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"custom"}
SX|outer exit 0
== nested-fork-inherit v24.16.0 code 0
SX|inner {"execArgv":["--require","./pre.cjs","-C","custom"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs","-C","custom"],"cpkg":"custom"},"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"custom"}
SX|outer exit 0
== eval-parent-fork v24.16.0 code 0
SX|eval default child []
SX|eval explicit child []
== vitest-threads-shape v24.16.0 code 0
pool execArgv ["--experimental-import-meta-resolve","--require","<abs>/suppress-warnings.cjs","--conditions","node","--conditions","development"]
pool cpkg dev meta sub/a.mjs
pool warnings ["other warning"]
thread exit 0; parent stdout still writable
== vitest-forks-shape v24.16.0 code 0
pool execArgv ["--experimental-import-meta-resolve","--require","<abs>/suppress-warnings.cjs","--conditions","node","--conditions","development"]
pool cpkg dev meta sub/a.mjs
pool warnings ["other warning"]
fork exit 0; parent stdout still writable
```

### Prod program

`tests/e2e-prod/worker-stdio-exec-argv.spec.ts` FILES, written with the same `echo '…' > file` lines into a scratch directory:

```text
$ node main.cjs
SP|worker default out
SP|captured true "SP|worker default out\n"
SP|worker --require ./pre.cjs -C custom,pre,custom
SP|fork --require ./pre.cjs -C custom,pre,custom
SP|done 0
exit 0
```

## RED at BASE

Parity (`pnpm test:parity <filter>`, BASE + this unit's carriers):

```text
node-parity-runner: 1 case(s) matching 'stdio-streams'
  ✗ worker_threads/stdio-streams.case.ts
    diff (- node / + rifty):
      - default true true null true
      + default false false undefined true
      - from-worker
      + default-exit 0
      - raw-out
      + capture false false undefined
      - default-exit 0
      + capture-exit 0 "" ""
      - capture true true null
      + unread-exit 0
      - capture-exit 0 "from-worker\nraw-out\n" "err-worker\n"
      + 
      - unread-exit 0
      + 
1 case(s) failed
node-parity-runner: 1 case(s) matching 'stdio-exit-order'
  ✗ worker_threads/stdio-exit-order.case.ts
    diff (- node / + rifty):
      - burst exit 3 lines=1000 ended=false | end lines=1000 | tick ended=true
      + burst exit 3 lines=0 ended=undefined | tick ended=undefined
      - terminate exit 1 | end | chunks>=3=true | resolved=1
      + terminate exit 1 | chunks>=3=false | resolved=1
1 case(s) failed
node-parity-runner: 1 case(s) matching 'exec-argv-startup'
  ✗ worker_threads/exec-argv-startup.case.ts
    error: Error: physical-worker parity expected 9 typed-bootstrap Workers, 0 stdio ACKs, authenticated private order witnesses, and no public IPC messages; constructed 1, initialized 1, acknowledged 0, witnessed [], published []
    node:   ""
    rifty:  ""
1 case(s) failed
node-parity-runner: 1 case(s) matching 'exec-argv-validation'
  ✗ worker_threads/exec-argv-validation.case.ts
    error: Error: physical-worker parity expected 1 typed-bootstrap Workers, 0 stdio ACKs, authenticated private order witnesses, and no public IPC messages; constructed 0, initialized 0, acknowledged 0, witnessed [], published []
    node:   ""
    rifty:  ""
1 case(s) failed
node-parity-runner: 1 case(s) matching 'fork-exec-argv'
  ✗ child_process/fork-exec-argv.case.ts
    diff (- node / + rifty):
      - require exit 0 {"execArgv":["--require","./pre.cjs"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs"],"cpkg":"req"},"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","i
      + require exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","o
      - short exit 0 {"execArgv":["-r","./pre.cjs","-C","custom"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["-r","./pre.cjs","-C","custom"],"cpkg":"custom"},"require":"custom","requireResolve":"node_modules/c
      + short exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","oth
      - order-child-cwd exit 0 {"execArgv":["--require","./pre.cjs","--require","../pre2.cjs"],"pre":["pre-sub","pre2"],"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":[
      + order-child-cwd exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any 
      - inline-esm exit 0 {"execArgv":["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require=./pre.cjs","--conditions=custom","
      + inline-esm exit 0 {"execArgv":[],"pre":null,"preFacts":null,"static":"imp","staticSub":"def-sub","dynamicImport":"imp","metaBare":"node_modules/cpkg/imp.mjs","metaParent":"a.mjs","metaParentUrl":"a.mjs","metaParentInvalid"
      - missing-preload exit 1 null Error: Cannot find module './missing.cjs'
      + missing-preload exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any 
      - default-mutated exit 0 {"execArgv":["--conditions=custom"],"pre":null,"preFacts":null,"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental fe
      + default-mutated exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any 
1 case(s) failed
node-parity-runner: 2 case(s) matching 'vitest-pool-shape'
  ✗ child_process/vitest-pool-shape.case.ts
    diff (- node / + rifty):
      - pool execArgv ["--experimental-import-meta-resolve","--require","<abs>/suppress-warnings.cjs","--conditions","node","--conditions","development"]
      + pool execArgv []
      - pool cpkg dev meta sub/a.mjs
      + pool cpkg imp meta a.mjs
      - pool warnings ["other warning"]
      + pool warnings ["VM Modules is an experimental feature and might change at any time","other warning"]
  ✗ worker_threads/vitest-pool-shape.case.ts
    error: Error: physical-worker parity expected 1 typed-bootstrap Workers, 0 stdio ACKs, authenticated private order witnesses, and no public IPC messages; constructed 0, initialized 0, acknowledged 0, witnessed [], published []
    node:   ""
    rifty:  ""
2 case(s) failed
```

Parity cases 3, 4 and 6 (`worker-env`) stop on the physical-Worker count, because the constructor throws before any Worker exists. Their rows at BASE, from the same case run through `runInRifty` with the count set to what BASE constructs (`exec-argv-startup` count 1) or as `kind: 'cjs'` (the throws are synchronous):

```text
$ exec-argv-startup (expectedPhysicalWorkers 1)
empty throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
require throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
short throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
order throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
inline-esm throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
development throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
no-flag-esm throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
falsy throw NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
inherit-mutated exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature an
$ exec-argv-validation (kind cjs)
"str" NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
{} NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
["--require"] NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
["-C","-r","./pre.cjs"] NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
["--conditions","-"] NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
["--conditions="] NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
["--require=","x"] NotImplementedError undefined Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
missing-preload NotImplementedError Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
$ worker_threads/vitest-pool-shape (kind cjs)
thread throw NotImplementedError: Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)
```

Unit (`npx vitest run packages/runtime-js/src/builtins/startup-options-ceiling.test.ts`): 21 failed of 21. Worker execArgv tokens are not named (the BASE message is `node-entry v3 cannot preserve worker-thread execArgv identity`), and Node's own execArgv errors are that `NotImplementedError` instead of Node's code; `stdin: true`, same-realm `stdout: true` and stream reads construct silently; every `fork` case spawns (no throw). The thread-id/hold assertions (`afterRejection`) hold at BASE, because BASE throws before allocating: with the name/code assertion removed, the nine Worker `execArgv` rows pass; the same helper fails the `stdin: true` row, whose BASE constructor starts a Worker (next id 2). Scratch copies, deleted after the run (`-t` filters, `--reporter=verbose`):

```text
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--no-warnings"] before allocat
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--require","./pre.cjs","--impo
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--experimental-vm-modules"] be
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["-e","42"] before allocating a 
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv [42] before allocating a thread
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["--require"] with ERR_WORKER
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["--conditions="] with ERR_WO
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["-C","-"] with ERR_WORKER_IN
 ✓ |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv "str" with ERR_INVALID_ARG_TY
      Tests  9 passed | 12 skipped (21)
 × |unit| packages/runtime-js/src/builtins/<scratch copy>.test.ts > worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names `stdin: true` (the parent-to-worker stdin stream is n
   → expected { holds: +0, nextThreadId: 2 } to deeply equal { holds: +0, nextThreadId: 1 }
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯
      Tests  1 failed | 20 skipped (21)
```

The committed file at BASE:

```text
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--no-warnings"] before allocating a thread 6ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--require","./pre.cjs","--import","./hook.mjs"] before allocating a thread 1ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["--experimental-vm-modules"] before allocating a thread 1ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv ["-e","42"] before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names unsupported execArgv [42] before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["--require"] with ERR_WORKER_INVALID_EXEC_ARGV before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["--conditions="] with ERR_WORKER_INVALID_EXEC_ARGV before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv ["-C","-"] with ERR_WORKER_INVALID_EXEC_ARGV before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > rejects Node-invalid execArgv "str" with ERR_INVALID_ARG_TYPE before allocating a thread 0ms
     → expected NotImplementedError: Not implemented: wor… { feature: '…' } to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names `stdin: true` (the parent-to-worker stdin stream is not carried) 1ms
     → expected undefined to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names captured stdio and startup options on the same-realm fallback 0ms
     → expected undefined to deeply equal ObjectContaining{…}
   × worker_threads.Worker startup-option and stdio ceilings (ADR-0449) > names reading a same-realm Worker stream (its output shares the parent streams) 0ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv ["--no-warnings"] before spawning 3ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv ["--import","./hook.mjs"] before spawning 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv ["--require"] before spawning 1ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv ["--require","--conditions","custom"] before spawning 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv ["--conditions="] before spawning 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv [42] before spawning 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names unsupported or malformed execArgv "--require" before spawning 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names an inherited parent flag it cannot carry 2ms
     → expected undefined to deeply equal ObjectContaining{…}
   × child_process.fork startup-option ceilings (ADR-0449) > names startup options on the same-realm fallback instead of dropping them 2ms
     → expected undefined to deeply equal ObjectContaining{…}
⎯⎯⎯⎯⎯⎯ Failed Tests 21 ⎯⎯⎯⎯⎯⎯⎯
      Tests  21 failed (21)
```

`npx vitest run packages/runtime-js/src/builtins/node-entry-startup-options.test.ts`: 4 failed, 5 passed. Failing: the protocol is `rifty.node-entry/v5`; program and worker-thread launches reject the field (`node-entry bootstrap program launch has unexpected field execArgv`); a v5 envelope is accepted. Passing guards: the five rejection rows (BASE has no field at all).

```text
   × node-entry v6 startup tokens (ADR-0449) > is the one atomic node-entry v6 wire contract 3ms
     → expected 'rifty.node-entry/v5' to be 'rifty.node-entry/v6' // Object.is equality
   × node-entry v6 startup tokens (ADR-0449) > carries an exact snapshot of program launch execArgv through decode 1ms
     → node-entry bootstrap program launch has unexpected field execArgv
   × node-entry v6 startup tokens (ADR-0449) > carries an exact snapshot of worker-thread launch execArgv through decode 0ms
     → node-entry bootstrap worker-thread launch has unexpected field execArgv
   × node-entry v6 startup tokens (ADR-0449) > rejects a v5 envelope (no dual reader) 1ms
     → expected [Function] to throw an error
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯
      Tests  4 failed | 5 passed (9)
```

Browser-unit (`RIFTY_PLAYGROUND_PORT=5411 pnpm test:browser-unit tests/browser-unit/worker-stdio-exec-argv.spec.ts`, real Chromium). `eval-parent-fork` (both rows) matches (a guard: BASE fork drops every `execArgv`). Rerun after the r1 reception, same diff as the first run:

```text
  ✘  1 tests/browser-unit/worker-stdio-exec-argv.spec.ts:37:1 › Worker stdio and fork/Worker startup options match live Node (Chromium child realm) (3.7s)
    - Expected  - 15
    + Received  +  7
    -       "SX|from-worker console.log",
    -       "SX|from-worker stdout.write",
    -     "exit": 0,
    +     "exit": 1,
    -     "rows": Array [
    -       "SX|inner {\"execArgv\":[\"--require\",\"./pre.cjs\",\"-C\",\"custom\"],\"pre\":[\"pre\"],\"preFacts\":{\"requireMain\":\"undefined\",\"execArgv\":[\"--require\",\"./pre.cjs\",\"-C\",\"custom\"],\"cpkg\":\"cu
    -       "SX|outer exit 0",
    -     ],
    +     "rows": Array [],
    -       "SX|inner {\"execArgv\":[\"--require\",\"./pre.cjs\",\"-C\",\"custom\"],\"pre\":[\"pre\"],\"preFacts\":{\"requireMain\":\"undefined\",\"execArgv\":[\"--require\",\"./pre.cjs\",\"-C\",\"custom\"],\"cpkg\":\"cu
    +       "SX|inner {\"execArgv\":[],\"pre\":null,\"preFacts\":null,\"require\":\"req\",\"requireResolve\":\"node_modules/cpkg/def-sub.js\",\"imports\":\"i-def\",\"warnings\":[\"VM Modules is an experimental feature an
    -       "pool execArgv [\"--experimental-import-meta-resolve\",\"--require\",\"<abs>/suppress-warnings.cjs\",\"--conditions\",\"node\",\"--conditions\",\"development\"]",
    -       "pool cpkg dev meta sub/a.mjs",
    -       "pool warnings [\"other warning\"]",
    -       "thread exit 0; parent stdout still writable",
    +       "thread throw NotImplementedError: Not implemented: worker_threads.Worker.execArgv (node-entry v3 cannot preserve worker-thread execArgv identity)",
    -       "pool execArgv [\"--experimental-import-meta-resolve\",\"--require\",\"<abs>/suppress-warnings.cjs\",\"--conditions\",\"node\",\"--conditions\",\"development\"]",
    -       "pool cpkg dev meta sub/a.mjs",
    -       "pool warnings [\"other warning\"]",
    +       "pool execArgv []",
    +       "pool cpkg imp meta a.mjs",
    +       "pool warnings [\"VM Modules is an experimental feature and might change at any time\",\"other warning\"]",
    test-results/worker-stdio-exec-argv-Wor-b51a4--Node-Chromium-child-realm-/test-failed-1.png
  1 failed
[ELIFECYCLE] Command failed with exit code 1.
```

Production build (`RIFTY_PLAYGROUND_PORT=5411 pnpm test:e2e:prod tests/e2e-prod/worker-stdio-exec-argv.spec.ts`). The terminal shows `Uncaught TypeError: Cannot read properties of undefined (reading 'on')` (`b.stdout.on`), and the default Worker's line never prints:

```text
  ✘  1 [chromium] › tests/e2e-prod/worker-stdio-exec-argv.spec.ts:67:3 › production build — Worker stdio and fork/Worker startup options (ADR-0449) › node main.cjs prints what Node prints and exits 0 (1.1m)
    - Expected  - 7
    + Received  + 1
    - Array [
    -   "SP|worker default out",
    -   "SP|captured true \"SP|worker default out\\n\"",
    -   "SP|worker --require ./pre.cjs -C custom,pre,custom",
    -   "SP|fork --require ./pre.cjs -C custom,pre,custom",
    -   "SP|done 0",
    - ]
    + Array []
    test-results/worker-stdio-exec-argv-pro-4876e-hat-Node-prints-and-exits-0-chromium/test-failed-1.png
  1 failed
[ELIFECYCLE] Command failed with exit code 1.
```

## Discoveries (route at land, REV-12)

- `spawn('node', ['--require', './pre.cjs', 'c.cjs'])`: Node runs `c.cjs` with the preload (`spawn-flags 0 "child [\"--require\",\"./pre.cjs\"] pre\n"`). rifty treats the first flag as the entry path (`spawn-flags 1 "" "Error: Cannot find module '/project/--require'"`; `child_process-worker.ts` `buildChildExecutionPlan(…, args[0])`). Overlaps draft `runtime-js/node-cli-preload-import-flags`.
- `import.meta.resolve('./nope.mjs')` (an absent file): Node returns the URL (`missing nope.mjs`); rifty throws `ModuleLoadError MODULE_NOT_FOUND`. vitest's `vm.CXMd5FHa.js:652` (the vm pools, out of scope) relies on Node's behavior.
- `process.emitWarning` is absent in rifty (`grep -rln emitWarning packages/` finds nothing). vitest's `test.DNmyFkvJ.js:272` guards the call.
- The parity runner's `child-worker` program launches bypass the rifty console: a child's `console.log` reaches the host stdout, not the kernel stdout port (`pool-probe.mjs` switched to `process.stdout.write`). That is a harness gap, and it hides console routing from program parity.
- In the `child-worker` parent, `process.stdout.writable` is `undefined` (Node: `true`); compare draft `runtime-js/process-stdio-writable-end-surface`.
- Worker `argv`, `resourceLimits`, `name`, `transferList` and `trackUnmanagedFds` options are ignored silently (`WorkerOptions` in `worker_threads.ts` has only `workerData`, `env`, `eval`, `execArgv`). This was found by reading the code, not a probe.
