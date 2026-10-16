# Evidence — esbuild upstream-twin refine (2026-10-16)

Goal: `docs/backlog/epics/esbuild-upstream-twin/`. Method for the guest
probes: scratch Playwright specs (not committed) over
`tests/e2e/helpers/playground.ts` (`bootProjectFiles`, `openShellTerminal`,
`runTerminalLineSettled`, `terminalBuffer`), starter `project-files`,
`--project=chromium-light`, `pnpm dev`; Playwright Chromium 148.0.7778.96;
worktree HEAD `9645c62bf`, tree clean before/after. No-COI arm:
`playwright.no-coi.config.ts`, SDK `createSandbox({requireCrossOriginIsolation:false})`
+ `toolchain.install({registryUrl:'/npm-registry'})` + `project.run`.
Oracle: Node v24.16.0, Darwin 25.6.0, same package bytes.
Logs lived in `/tmp/esbw-probe-*.log` (not committed); excerpts verbatim.

## Bytes in the guest

The Vite starter already carries `/node_modules/esbuild-wasm` (stock
acquisition of the substituted `esbuild`); guest `npm install esbuild-wasm@0.28.0`
→ `npm: + esbuild-wasm@0.28.0 (cached)` — the catalog substitutes by name
`esbuild` only. Guest sha256 equal host for all 6 files, e.g.
`9d99d51a…fa3b esbuild.wasm`, `c1d425c7…bf58 lib/main.js`;
`require.resolve('esbuild-wasm')` → `/node_modules/esbuild-wasm/lib/main.js`.
Probes call `esbuild-wasm` directly (never the `esbuild` name).

## Stock entry, unmodified (COI)

| step | command | rifty | Node 24.16.0 |
|---|---|---|---|
| a | `node node_modules/esbuild-wasm/bin/esbuild --version` | `0.28.0` then `fatal error: all goroutines are asleep - deadlock!` … `syscall.Write(0x1, …)` | TTY stdout: `0.28.0`, exit 0 |
| b | `echo 'let x: number = 1' \| node …/bin/esbuild --loader=ts` | `✘ [ERROR] Could not read from stdin: read /dev/stdin: Bad file number` + deadlock on `syscall.Write(0x2 …)` | TTY stdout: `let x = 1;`, exit 0 |
| c | `node -e "require('esbuild-wasm').transform('let x: number = 1',{loader:'ts'}).then(…)"` | `TypeError: child.unref is not a function at ensureServiceIsRunning (/node_modules/esbuild-wasm/lib/main.js:2106:9)` | `OK "let x = 1;\n"` |
| d | same, `build({stdin:{contents:'export const a=1'},bundle:true,write:false})` | same `child.unref` TypeError | `OK` bundle text |
| e | `node -e "try{…transformSync('let x=1')…}catch(e){console.log('SYNCERR',…)}"` | no output for 90 s, `^C` only | `let x = 1;` (~0.2 s) |

Upstream edge (Node oracle, Node 24.16.0/macOS): with a FILE stdout
esbuild-wasm's CLI writes nothing (`node …/bin/esbuild --version > f; wc -c < f`
→ `0`, exit 0); a pipe prints (`… --version | wc -c` → `7`; premise critic
5/5 runs, spawn/spawnSync over a pipe → `"0.28.0\n"`); a TTY prints
(`script -q`: `0.28.0` / `let x = 1;`). So `esbuild in.ts > out.js` writes an
empty file on Node — an upstream quirk the CLI differential pins as a row
(file stdout) beside pipe and TTY rows. Linux not checked.

Registry today (`npm view`, 2026-10-16): `esbuild-wasm` `latest` = `0.28.2`
(0.28.0, 0.28.1, 0.28.2 published); `vite@7.3.6` `dependencies.esbuild` =
`^0.27.0 || ^0.28.0`. The playground and `tests/no-coi/*` install through
`/npm-registry` → live registry (`apps/playground/vite.config.ts:95-99`), so a
fresh range resolution in COI picks 0.28.2, while the recipe pins 0.28.0
(`catalog-source.ts:457-488`).

## Discriminating layers (in-guest shims; experiments, not fixes; each inert on Node)

- f1 — stub `ChildProcess.prototype.ref/unref`: service starts, then
  `deadlock … syscall.Write(0x1…) main.runService service.go:107`,
  `[f1] child exit 2 null`, `ERR Error: The service was stopped`.
- f2 — child `process.stdout/stderr.write` honours the callback:
  `--version` → `0.28.0`, `EXIT0`; CLI b → clean EBADF error; API c →
  `[pre2] child exit 0 null`, `ERR Error: The service was stopped` (Go reads
  EBADF on fd 0 as EOF).
- f3 — `fs.read(0)` served from `process.stdin`: CLI b → `let x = 1;`, `EXIT0`;
  API c → `OK "let x = 1;\n"`; d → `OK "(() => {\n  // <stdin>\n  var a = 1;\n})();\n"`;
  parent never exits until `^C` → `[pre2] child exit null SIGTERM` (stub unref
  holds the loop).
- f4 — f3 + public `e.stop()`: `OK "let x = 1;\n"`, `PARENT_EXIT0`. A build
  resolving a file → `✘ [ERROR] panic: syscall/js: call of Value.Int on undefined`
  … `syscall.setStat (syscall/fs_js.go:184) syscall.Lstat`.
- f5 — numeric `fs.Stats` fields: transform + stdin-resolve build →
  `OK "let x = 1;\n" "// m.js\nvar a = 42;\n\n// <stdin>\nconsole.log(a);\n"`;
  `build({entryPoints:['entry.js'],bundle:true,outfile:'out/bundle.js',format:'esm'})`
  → `OK [] "// m.js\nvar a = 42;\n\n// entry.js\nconsole.log(a);\n"`;
  CLI `entry.js --bundle --format=esm` → same text, `EXIT0`; `PARENT_EXIT0`.
  Identical to Node.

## Node-surface gaps, isolated (COI, rifty vs Node 24.16.0)

| gap | probe | rifty | Node | source |
|---|---|---|---|---|
| stdio write callback | `node -e "process.stdout.write('a\n',()=>console.log('CB1'))"` | `a` | `a` `CB1` | `packages/runtime-js/src/builtins/process-stdio-writer.ts:89-103` (`write(chunk)` drops enc/cb) |
| stdio Writable shape | `console.log(s instanceof require('stream').Writable, typeof s.end, …, s.writableLength)` | `false undefined function 1 0 undefined` | `true function …` | same |
| fd 0 read | `echo hi \| node -e "require('fs').read(0,Buffer.alloc(10),0,10,null,(e,n,b)=>console.log('READ',e&&e.code,n,…))"` | `READ EBADF undefined undefined` | `READ null 3 hi` | `fs.ts:157-158` (`fdTable`, `nextFd = 3`), `getFd` `:428` |
| `readFileSync(0)` | `echo hi \| node -e "…readFileSync(0,'utf8')…"` | `RFSERR undefined fs path must be string, Buffer, or URL` | `"hi\n"` | `fs.ts` path coercion |
| fd 1 write | `node -e "require('fs').writeSync(1,'WS1\n')"` | `Error: EBADF: bad file descriptor, write` | `WS1` | `getFd` |
| child ref/unref | `const c=spawn('node',['-e','1']);console.log(typeof c.ref,typeof c.unref,typeof c.stdin.unref,typeof c.stdout.unref)` | `undefined undefined undefined undefined` | `function function function function` | `child_process.ts:122+` (keepalive held ctor→`'close'`) |
| Stats fields | `fs.lstat/stat/fstat` → keys not `number` (probed list; `birthtimeMs` not probed) | `dev,ino,mode,nlink,uid,gid,rdev,blksize,blocks,atimeMs,ctimeMs` | `ALL_NUMBERS` | `packages/runtime-js/src/builtins/fs-stats.ts:9-17` (`size`, `mtimeMs` only) |
| worker start vs `Atomics.wait` | `new Worker('./wk.cjs',{execArgv:[]})` + SAB post + `Atomics.wait(…,5000)` | `WAIT timed-out 5010` | `WAIT ok` | `runtime-js/worker-threads-prompt-start-atomics-wait` |
| port in workerData | `new Worker(require.resolve('esbuild-wasm'),{workerData:{workerPort:port2,…},transferList:[port2]})` | async `WERR Not implemented: worker_threads.workerData.structuredClone (kernel-backed Worker workerData currently supports only JSON-safe plain data)` | starts | `worker_threads.ts` `encodeWorkerData` |
| `receiveMessageOnPort` | `typeof w.receiveMessageOnPort` | `undefined` | `function` | `worker_threads.ts` exports |

Sync hang reading: esbuild's `*Sync` builds the Worker, posts, then blocks in
`Atomics.wait`; rifty reports the workerData refusal only as an async
`'error'` event the blocked parent never reaches.

Not blockers (refuted fears): sync `new WebAssembly.Module` of 13.9 MB works
(guest is a Worker); `delete process.env[k]` works; binary pipe protocol
byte-identical; a pending stdin read with a `'data'` listener holds the
child; `globalThis.require/fs` writes stay in the child realm under COI.

## No-COI arm

- a: `exitCode:2`, `stdout:"0.28.0\n"`, stderr deadlock (same as COI).
- c: `[rifty:child_process] Falling back to same-realm execution: child shares the parent event loop.`
  then `SyntaxError: Invalid or unexpected token` (shebang through `new Function`,
  `child_process-exec.ts:454`); with a shebang-free wrapper:
  `NotImplementedError: Not implemented: child_process.same-realm.require (same-realm child cannot require non-builtin node_modules/esbuild-wasm/bin/esbuild)`
  (`:506`).
- e: `SYNCERR Not implemented: worker_threads.Worker (no-COI toolchain Workers require a separate event loop; use cross-origin isolation and the kernel-backed runtime)` — loud.

## Today's cost of a version (code reading, HEAD `9645c62bf`)

- One recipe per name: `admission.ts:27-29` first match by `trigger.name`;
  `index.ts:44-50` redirects keyed by name; `runtime-adapters.ts:12-15` one
  adapter id, wasm size `13_918_738`, sha256 `9d99d51a…`.
- Generated client: 13 patch ids / 23-24 exact anchors
  (`tools/shadow-registry/tools/esbuild-exact-patcher.mjs:28-315`), replacement
  text `generate-esbuild-runtime.ts:92-342`, `:399` asserts `policy.version === '0.28.0'`;
  `esbuild-runtime-policy.json` hand-entered hashes; `esbuild-legacy-retirement.mjs:303-317`
  requires exactly one generated client.
- Oracle: `esbuild-contract-oracle.test.ts` runs native `esbuild@0.28.0`;
  fixtures `esbuild-0.28.0-*.json`; probe types the oracle `'esbuild@0.28.0'`
  (`esbuild-contract-probe.ts:228,1729`).
- `0.28.0` appears 628× in 132 tracked files; outside docs and CHANGELOGs
  `git grep -l 0.28.0 9645c62bf -- . ':!docs' ':!**/CHANGELOG.md' | wc -l` → `66`.
- Catalog digest sits in every lock substitution trace (`planner.ts:250-256`,
  `716-754`): any catalog change → existing lockfiles with a trace replay as
  `EBROKENLOCK` (`installer.ts:327`).
- Patch provenance: 6 ids (`node-callback-fs`, `channel-has-fs`,
  `runtime-default-wd`, `runtime-service-refs`, `transform-temp-fs`,
  `native-validation-provenance`) restore what `lib/main.js` gets from Node
  (`fs`, `process.cwd()`, `child.ref()/unref()`, `os.tmpdir()`,
  `readFileSync`); `inline-worker-startup` replaces `spawn('node', bin/esbuild)`;
  5 `gate-*` ids are scope; `native-target-errno` emulates native over wasm.
  Rollup/LightningCSS/Sass run upstream wasm/JS bytes unmodified (alias or
  facade only).
- Upstream fallback precedent: native `esbuild/lib/main.js:1920-1943`
  `knownWebAssemblyFallbackPackages` runs a wasm package via `node <binPath>`
  on platforms without a native binary.

## Vite

- Gate: `tools/shadow-registry/src/runtime/vite-esbuild-runtime.ts:31-35` —
  `7.3.6` → `start`, `/^8\./` → `skip-rolldown`, else plain
  `Error('vite esbuild runtime supports exact Vite 7.3.6; executed …')`; its
  only caller `vite-cli-prep.ts:184` (`prepareViteEsbuildRuntime` → requires
  the generated client in the realm). No other product `7.3.6` gate
  (`grep` over `tools/shadow-registry/src packages/*/src apps/playground/src`,
  tests/generated excluded).
- Install patch anchors (`vite-cli-install-policy.ts`) in upstream tarballs
  (`npm pack vite@6 vite@5`, 2026-10-16): `vite-6.4.4` (`esbuild ^0.25.0`)
  and `vite-5.4.21` (`esbuild ^0.21.3`) each contain `this.runMatchedCommand();`
  once in `dist/node/cli.js`, the Chokidar `DirEntry.add` needle in one
  chunk, and `resolved.id.slice(root.length)` in one file.
- Vite 5/6 were never run on rifty; runtime gaps beyond the gate are unknown.

## Older esbuild-wasm Node entries

`npm pack esbuild-wasm@0.21.5 esbuild-wasm@0.25.12` (2026-10-16):
- 0.21.5 `bin/esbuild:95` `Object.defineProperty(globalThis, 'crypto', {writable:true, configurable:true})`;
  `wasm_exec_node.js:17-27` builds `globalThis.performance` from
  `process.hrtime()` and `globalThis.crypto.getRandomValues` from
  `crypto.randomFillSync`.
- 0.25.12 `wasm_exec_node.js:17-19` uses `??=` like 0.28.0.
- Both `lib/main.js` call `child.unref()` (`:1814`), `execFileSync` (`:1887`)
  and `receiveMessageOnPort` (`:1947`). The spike ran 0.28.0 only.

## Side observations (filed as separate items)

- COI terminal: `ls node_modules | head -40; ls node_modules/esbuild-wasm; echo EXIT=$?`
  → `head: invalid option -- '40'` … `EXIT=$?` (literal) —
  `shell/head-numeric-count-option`, `shell/special-parameter-exit-status`.
- No-COI, consecutive `project.run` calls in one held toolchain Worker: run
  N+1 (`require('./pre2n.cjs')`) prints `[f1] spawned …` / `[f1] child exit 1 null`
  from run N's `pre1.cjs` spawn wrapper — `runtime-js/no-coi-toolchain-run-builtin-state-leak`.
