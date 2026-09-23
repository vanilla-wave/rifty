# Evidence — readable-pipe-never-ends-process-stdio (PICKUP 2026-09-23)

Contract: `docs/backlog/runtime-js/readable-pipe-never-ends-process-stdio.md`.
Base: `325ae797c` (branch `t3code/vitest-run-browser`). Oracle: host
`node --version` → `v24.16.0` (npm 11.17.0), macOS. Probe scripts live in the
session scratch dir; their bodies are summarized inline, the committed parity
cases re-run each claim against Node.

## Node mechanism (source, v24.16.0)

`node -e "const s=process.binding('natives')['internal/streams/readable'].split('\n'); …"`:

```
927:   const doEnd = (!pipeOpts || pipeOpts.end !== false) &&
928:               dest !== process.stdout &&
929:               dest !== process.stderr;
931:   const endFn = doEnd ? onend : unpipe;
932:   if ((state[kState] & kEndEmitted) !== 0)
933:     process.nextTick(endFn);
934:   else
935:     src.once('end', endFn);
1056:   function unpipe() {
1058:     src.unpipe(dest);
```

`internal/streams/pipeline` `pipe(src, dst, finish, …, { end })`:
`src.pipe(dst, { end: false }); // If end is true we already will have a listener to end dst.`
then `function endFn() { ended = true; dst.end(); }` on `src.once('end', …)` —
Node's pipeline ends its last stage itself, stdio included ("Now they allow it
but 'secretly' don't close the underlying fd": stdout `_destroy = dummyDestroy`
→ `_undestroy()`, `is_main_thread.js:157/179`).

`process` inside Node's internal modules is the bootstrap process object, not
a `globalThis` lookup (probe P6).

## Oracle probes (Node v24.16.0)

```
P1 $ node p1-stdout.cjs   (Readable.from(['a\n']).pipe(process.stdout); on 'end'+setImmediate write state)
   a
   still-writable ended=false end=function before=0,0,0,0,0,0 after=0,0,0,0,0,0 srcListeners=0,1   [exit 0]
   (same with stdout = pipe and = file; listener columns drain,error,close,finish,unpipe,end)
P2 $ node p2-during.cjs   (listener counts on process.stdout before / during / after a pipe)
   before=drain:0,error:0,close:0,finish:0,unpipe:0,pipe:0
   during=drain:0,error:1,close:1,finish:1,unpipe:1,pipe:0
   after=drain:0,error:0,close:0,finish:0,unpipe:0,pipe:0
   flowing=false                                                                                 [exit 0]
P3 $ node p3-events.cjs   (pipe(process.stdout, {end: true}); 'pipe'/'unpipe'/'finish' listeners on stdout)
   a
   events=pipe:true unpipe:true ended=false                                                      [exit 0]
P4 $ node p4-stderr.cjs 2>err.txt   (Readable.from(['b\n']).pipe(process.stderr); later stderr write)
   stdout: stdout-done   stderr: b / stderr-still-writable ended=false                          [exit 0]
P5 $ node p5-lookalike.cjs   (Writable with fd=1, _isStdio=true, isTTY=false; Readable.from(['x']).pipe(w))
   lookalike finished                                                                            [exit 0]
P6 $ node p6-forged.cjs   (globalThis.process = {stdout: w, stderr: w}; Readable.from(['x']).pipe(w))
   forged-global dest finished=true                                                              [exit 0]
P8 $ node p8-pipeline-spy.cjs   (spy on process.stdout.end; pipeline(Readable.from(['p\n']), process.stdout, cb))
   pipeline-cb err=undefined endCalls=1 ended=false finished=false                               [exit 0]
P9 $ node p9-promises.mjs   (stream/promises pipeline into process.stdout, same spy)
   promises-pipeline resolved endCalls=1 ended=false                                             [exit 0]
P11 $ node p11-dbg.cjs > o11.txt   (pipeline into stdout; log inside the end spy)
   end-called args=0 before ended=false / after end ended=true SyncWriteStream / stdout finish /
   pipeline-cb err=undefined ended=false / later ended=false                                     [exit 0]
P10 $ node p10-end-direct.cjs   (process.stdout.end('x\n'); then process.stdout.write(...))
   x / Error [ERR_STREAM_WRITE_AFTER_END]: write after end (Emitted 'error' on SyncWriteStream)   [exit 1]
Pf $ node case-endfalse.cjs   (Readable.from(['one']).pipe(w, {end:false}); after end)
   dest listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0 / dest ended false /
   dest still writable: one,two                                                                  [exit 0]
```

Reading: `Readable.pipe` never ends `process.stdout|stderr` (any `end` option)
and unpipes at source end — every pipe listener on both ends released, stream
writable. Identity only: fd/`_isStdio` lookalikes and a Writable behind a
reassigned `globalThis.process` still end. `pipeline(src, process.stdout)`
DOES call `stdout.end()` once (then un-destroys it). A direct `end()` really
ends stdout.

## vitest 4.1.11 path (static, `node_modules/vitest/dist/chunks/cli-api.CnMVyzaz.js`)

- `:1883` `constructor(ctx, outputStream = process.stdout, errorStream = process.stderr)` (Logger).
- forks pool `:3159` `this._fork.stdout.pipe(this.stdout)`, `:3163` stderr; stop `:3183/:3187` `unpipe`.
- threads pool `:3236/:3238` `this._thread.stdout|stderr.pipe(...)`; stop `:3242/:3244` `unpipe`.
- No `process.stdout.end`, `process.stderr.end` or `pipeline(…, process.std…)` in vitest/vite/@vitest dist.

## rifty baseline @ 325ae797c (RED)

`pnpm -s test:parity stream/pipe-process-stdio`:

```
✗ stream/pipe-process-stdio-end-calls.case.ts
    - Readable.pipe(process.stdout) end calls: 0
    + Readable.pipe(process.stdout) end calls: 1
    - Readable.pipe(process.stderr) end calls: 0
    + Readable.pipe(process.stderr) end calls: 1
✗ stream/pipe-process-stdio-exit.case.ts
    - "stdout": "piped to stdout\nstdout still writable\n",
    + "stdout": "piped to stdout\n",
    + "stderr": "TypeError: dest.end is not a function\n    at publishedConstructor.onEnd (…/packages/io/src/streams/readable.ts:768:29) …",
    - "code": 0,
    + "code": 1,            (same for the stderr invocation)
✗ stream/pipe-process-stdio.case.ts
    error: TypeError: dest.end is not a function
```

`pnpm -s test:parity fork-stdout-pipe-process-stdio` → `✗ … error: TypeError: dest.end is not a function`.
`pnpm -s test:parity stream/pipe-end-false-unpipe` →
`- dest listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0` /
`+ dest listener delta 0,0,1,1,1,0,0; source data/end listeners 1/1`.

Sibling gaps (temporary seeded/default cases, deleted after the run):

```
typeof process.stdout.end / writableEnded   → undefined undefined (Node: function false)
process.stdout.end()                        → TypeError: process.stdout.end is not a function
pipeline(Readable.from(['p\n']), process.stdout, cb) → TypeError: dest.end is not a function
fs.createReadStream('f.txt').pipe(process.stdout)    → TypeError: dest.end is not a function
                                              (fs-streams.ts:503 own pipe: always dest.end())
Writable 'pipe'/'unpipe' events on pipe()+unpipe()   → "" (Node: pipe,unpipe)
```

## Discrimination spike (disposable, reverted; not the implementation)

Candidate: `readable.ts` exemption from io's `loadBuiltin('process')` +
`else cleanup()` on end; `pipeline.ts` `pipe(dst, {end:false})` +
`src.once('end', () => dst.end())`.

- Exemption only (no unpipe, no pipeline change): end-calls case
  `pipeline … end calls: 0` (Node 1); stdio case
  `listener delta 0,0,1,1,1,0,0; source data/end listeners 1/1` (Node 0s).
- `globalThis.process` instead of the registry: stdio case misses
  `Writable behind a reassigned globalThis.process finished`.
- Full candidate: the four `pipe-process-stdio` cases ✓ in 3 repeated runs
  (~2.9 s each), `pipe-end-false-unpipe` ✓; `pnpm -s test:parity stream/`
  55/55 ✓; `vitest run packages/io/src/streams` 597/597 ✓.
- Mechanism probes P1–P11 are the scratch scripts summarized above; every row
  the contract asserts is re-executed against Node by a committed case.

## IMPLEMENT (2026-09-23, on `a7d892a3a`)

RED rerun before product change: 5/5 ✗ as above.

`opts.end` coercion (Node `pipeOpts.end !== false`, readable.js:927), host v24.16.0:

```
$ node -e "for (const end of [null,0,undefined,false]) { const w=new Writable(…); Readable.from(['x']).pipe(w,{end}); … w.writableEnded }"
end null writableEnded true / end 0 writableEnded true / end undefined writableEnded true / end false writableEnded false
```

rifty `opts.end ?? true` left `{end: 0}` open → new case `stream/pipe-end-option-coercion`
(RED on the old coercion: `- {end: 0} ended true` / `+ {end: 0} ended false`).

Mutants vs the hardened forged-global row (reassignment held through source end):
`globalThis.process` read lazily at end or eagerly at pipe →
`- Writable behind a reassigned globalThis.process finished` /
`+ … not finished`.

`pipeline(fs.createReadStream(f), dst)`: fs ReadStream's own `pipe` ignores
`{end: false}`, so dst gets a second same-tick chunkless `end()` — a no-op on
rifty `Writable` and `FileWriteStream` (probe: data, one `finish`, event order
identical to base). Base and impl both report cb `err=null` where Node passes
`undefined` (pre-existing).

Gate re-pin: after `pnpm build:libs`, `check:esbuild-legacy-retirement` →
`typescript-worker.js: published output exceeds the exact 2 MB carrier ceiling`;
`ls -l` 10022694 bytes (= pin), `shasum -a 256` `39b3991611f5…46ca0` (pin `018ea49b3a19…b422`);
`grep -c pipeCleanups typescript-worker.js` → 0; the file imports `chunk-XXXXXXXX.js`
by content-hashed name, so a changed io chunk changes its sha at equal length.

## Final+GREEN r1 reception (2026-09-23, on `bf44b7b36`)

Blocker: `pipe()` called `loadBuiltin('process')`, and the registry caches per
name. Inside a same-realm child (`child_process-exec.ts` `withChildProcess`
swaps the active bootstrap), the first pipe cached the child's process.

Oracle, host Node v24.16.0 (`/tmp/vgoal/u6/oracle/rv1/{main,child}.js`, the case's code verbatim):

```
$ node main.js < /dev/null
"child piped\n" close 0; require(node:process) === process true; pid match true; exitCode via require 3
parent piped
parent stdout still writable
exit=0
```

rifty @ bf44b7b36, carrier `child_process/same-realm-child-pipe-parent-process.case.ts`:

```
$ pnpm -s test:parity same-realm-child-pipe-parent-process
  ✗ child_process/same-realm-child-pipe-parent-process.case.ts
    error: TypeError: dest.end is not a function
```

The parent's own `pipe(process.stdout)` was no longer exempt. The same code
without the parent pipe (scratch probe) shows the identity loss:

```
- "child piped\n" close 0; require(node:process) === process true; pid match true; exitCode via require 3
+ "child piped\n" close 0; require(node:process) === process false; pid match false; exitCode via require 0
```

Fix: `readBuiltinUncached('process')` calls the factory and leaves the cache
untouched (ADR-0458). With it, the carrier passes, the reviewer's three
`fg1-same-realm-*` probes pass, and `pnpm -s test:parity pipe` passes 12/12
(two runs).

Sibling sweep (active-bootstrap swaps): `child_process-exec.ts:179`,
`child_process.ts:211`, `worker_threads.ts:386`,
`in-process-node-entry-runner.ts:72`. With the uncached read, pipe writes the
cache under none of them. The same-realm child's `require('process')` returns
`childProcess` without the registry (`child_process-exec.ts:484`). A loader
`require('node:process')` under the in-process runner's swap still caches. That
runner exists only for tests, and the behavior predates this unit.
