# Evidence — absent-builtin-members-loud-throws

Unit: `docs/backlog/runtime-js/absent-builtin-members-loud-throws.md`
(goal `vitest-run-in-browser`, I6). Oracle: host Node v24.16.0 / npm 11.17.0,
Darwin arm64, run 2026-09-23. Rifty baseline: BASE
`c2ab221de27d8051bb3a14fbbb541c0fdb97c891`. Scratch: `/tmp/vgoal/u4/probes`
(probe scripts quoted below), `/tmp/vgoal/u4/oracle` (vitest tree).

## O1 — Node owns the members (descriptors)

```
$ node --version; npm --version; uname -sm
v24.16.0
11.17.0
Darwin arm64
$ node -e "
const fs=require('node:fs'), cp=require('node:child_process');
const d=(o,k)=>{const x=Object.getOwnPropertyDescriptor(o,k);return x?('value' in x?'data w='+x.writable:'accessor')+' e='+x.enumerable+' c='+x.configurable+' type='+typeof(x.value??x.get):'NOT-OWN'};
for (const [n,o,k] of [['fs','statfsSync'],['fs','statfs'],['fs.promises','statfs'],['child_process','spawnSync'],['child_process','execFileSync'],['process','memoryUsage']].map(([n,k])=>[n,n==='fs'?fs:n==='fs.promises'?fs.promises:n==='child_process'?cp:process,k])) console.log(n+'.'+k, d(o,k), Object.keys(o).includes(k));
console.log('memoryUsage.rss', d(process.memoryUsage,'rss'), Object.keys(process.memoryUsage));
console.log('bind', typeof process.memoryUsage.bind(process), process.memoryUsage.bind(process).name);
"
fs.statfsSync data w=true e=true c=true type=function true
fs.statfs data w=true e=true c=true type=function true
fs.promises.statfs data w=true e=true c=true type=function true
child_process.spawnSync data w=true e=true c=true type=function true
child_process.execFileSync data w=true e=true c=true type=function true
process.memoryUsage data w=true e=true c=true type=function true
memoryUsage.rss data w=true e=true c=true type=function [ 'rss' ]
bind function bound memoryUsage
```

## O2 — named imports link (= parity `modules/builtin-loud-members-link`)

The case `code`, extracted verbatim to `case-link.mjs`
(`npx tsx extract-case.mts <case> case-link.mjs`):

```
$ node case-link.mjs
{"statfsSync":["function",["function",true,true,true,true],true,true],"spawnSync":["function",["function",true,true,true,true],true,true],"memoryUsage":["function",["function",true,true,true,true],true,true],"rss":["function",true,true,true,true],"bound":"function"}
```

## O3 — forked ESM child links and binds (= parity `child_process/pool-worker-loud-members`)

Case setup file + `code` extracted verbatim to `pool/project/{pool-worker.mjs,main.js}`:

```
$ cd pool/project && node main.js
{"code":0,"signal":null,"stdout":"[\"function\",\"function\",\"function\",\"function\",true]","stderr":false}
```

## O4 — Node returns host values the browser has no source for

```
$ node -e "
const s=require('node:fs').statfsSync('/tmp'); console.log('statfsSync', s.constructor.name, Object.keys(s).join(','));
const r=require('node:child_process').spawnSync(process.execPath,['-e','process.stdout.write(\"o\");process.stderr.write(\"e\");process.exit(3)']); console.log('spawnSync', Object.keys(r).join(','), r.status, r.signal, String(r.stdout), String(r.stderr));
const g=require('node:child_process').spawnSync('definitely-not-a-binary-u4'); console.log('spawnSync-missing', g.error && g.error.code, g.status);
const m=process.memoryUsage(); console.log('memoryUsage', Object.keys(m).join(','), Object.values(m).every(v=>typeof v==='number'&&v>0));
console.log('rss', typeof process.memoryUsage.rss(), process.memoryUsage.rss()>0);
"
statfsSync StatFs type,bsize,frsize,blocks,bfree,bavail,files,ffree
spawnSync status,signal,output,pid,stdout,stderr 3 null o e
spawnSync-missing ENOENT null
memoryUsage rss,heapTotal,heapUsed,external,arrayBuffers true
rss number true
```

Host filesystem block/inode statistics and process RSS / V8 heap statistics
have no browser-realm source. Rifty's only synchronous child path is the
`execSync` sync RPC: `node <script>` only, stdout bytes only
(`packages/runtime-js/src/ipc/handlers.ts:81-82`, `packages/runtime-js/src/builtins/child_process-sync.ts`) —
no status, stderr, signal or non-`node` command result for `spawnSync`.

Invalid arguments (not claimed; rifty throws the named error for every call):

```
$ node -e "
for (const [n,f] of [['statfsSync(1)',()=>require('node:fs').statfsSync(1)],['spawnSync(1)',()=>require('node:child_process').spawnSync(1)],['memoryUsage(1)',()=>process.memoryUsage(1)]]) { try { const r=f(); console.log(n,'returns',typeof r); } catch(e){ console.log(n,'throws',e.code||e.name); } }
"
statfsSync(1) throws ERR_INVALID_ARG_TYPE
spawnSync(1) throws ERR_INVALID_ARG_TYPE
memoryUsage(1) returns object
```

## V1 — where vitest 4.1.11 reaches the members

```
$ cd /tmp/vgoal/u4/oracle && cat package.json
{"name":"u4-oracle","private":true,"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}
$ npm install --ignore-scripts --no-audit --no-fund   → added 45 packages
$ node -p "…vitest, vite, tinyexec versions"          → 4.1.11 8.0.16 1.3.1
$ grep -rn -E "statfs|spawnSync|memoryUsage|execFileSync" node_modules --include='*.js' --include='*.mjs' --include='*.cjs'
rolldown/dist/shared/binding-CXquf8ay.mjs:41: childProcess.execFileSync("pnpm", ["i", bindingPkg], {
vitest/dist/chunks/test.DNmyFkvJ.js:4307: if (this.config.logHeapUsage && …) suite.result.heap = process.memoryUsage().heapUsed;
vitest/dist/chunks/test.DNmyFkvJ.js:4327: if (this.config.logHeapUsage && …) test.result.heap = process.memoryUsage().heapUsed;
vitest/dist/chunks/init.k9zZ9sLh.js:197: const memoryUsage = process.memoryUsage.bind(process);
vitest/dist/chunks/init.k9zZ9sLh.js:268: usedMemory: reportMemory ? memoryUsage().heapUsed : void 0   (also :288 :312 :332)
vitest/dist/chunks/cli-api.CnMVyzaz.js:1: import fs, { promises, existsSync, mkdirSync, readFileSync, statfsSync, statSync, readdirSync, writeFileSync } from 'node:fs';
vitest/dist/chunks/cli-api.CnMVyzaz.js:2691: const fsStats = statfsSync(tempDirectory);   (also :2716)
tinyexec/dist/main.mjs:1: import { spawn, spawnSync } from "node:child_process";
tinyexec/dist/main.mjs:366: const spawnResult = spawnSync(crossResult.command, crossResult.args, crossResult.options);
vite/dist/node/chunks/node.js:12310: const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
```

Call gates: `statfsSync` sits in `maybeCollectChromiumGarbage` (browser mode,
playwright chromium, `cli-api:2671`, gate `:2674`); `init.js` `reportMemory` is `true` only on
`VmForksPoolWorker` / `VmThreadsPoolWorker` (`cli-api:3429`, `:3447`), else
`false` (`:2983`); `test.js` calls need `logHeapUsage`. tinyexec's `spawnSync`
is inside `xSync` (`main.mjs:353`); vitest imports only `x` from tinyexec
(`cli-api:63`, `index.CMESou6r.js:5`, `creator.DgVhQm5q.js:6`,
`index.UpGiHP7g.js:17`), and `--changed` runs git through async `x`
(`cli-api:12792`, `:12844`), i.e. `spawn`, not `spawnSync`. vite's cross-spawn
reads `cp.spawnSync` at call time (not a link edge).

## O5 — the claimed scenario never calls them under Node (both pools)

Scenario files in `/tmp/vgoal/u4/oracle` (goal §User scenario 1):
`vitest.config.ts` (`include: ['src/**/*.test.ts']`), `src/sum.ts`,
`src/sum.test.ts` (one pass, one fail). `trap.mjs` wraps the three members on
their owner objects, calls `syncBuiltinESMExports()`, and appends
`trap-installed` / `CALL <member>` lines with pid + thread to `$U4_TRAP_LOG`:

```js
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { isMainThread, threadId } from 'node:worker_threads';
const LOG = process.env.U4_TRAP_LOG;
const log = (line) => fs.appendFileSync(LOG, `${line} pid=${process.pid} thread=${isMainThread ? 'main' : threadId}\n`);
log('trap-installed');
const wrap = (owner, key, label) => {
  const real = owner[key];
  owner[key] = function (...args) { log(`CALL ${label}`); return real.apply(this, args); };
};
wrap(fs, 'statfsSync', 'fs.statfsSync');
wrap(cp, 'spawnSync', 'child_process.spawnSync');
wrap(process, 'memoryUsage', 'process.memoryUsage');
syncBuiltinESMExports();
```

```
$ U4_TRAP_LOG=trap-forks.log NODE_OPTIONS="--import trap.mjs" npx vitest run --pool=forks     → Tests 1 failed | 1 passed (2) [exit 1]
$ cat trap-forks.log
trap-installed pid=83029 thread=main
trap-installed pid=83051 thread=main
trap-installed pid=83067 thread=main
$ U4_TRAP_LOG=trap-threads.log NODE_OPTIONS="--import trap.mjs" npx vitest run --pool=threads → Tests 1 failed | 1 passed (2) [exit 1]
$ cat trap-threads.log
trap-installed pid=83074 thread=main
trap-installed pid=83091 thread=main
trap-installed pid=83091 thread=1
```

The trap runs in the CLI, the forks child and the threads worker; no `CALL`
line. Controls — the trap records calls when they happen:

```
$ U4_TRAP_LOG=trap-control.log NODE_OPTIONS="--import trap.mjs" npx vitest run --logHeapUsage → "12 MB heap used" [exit 1]
$ awk '{print $1, $2}' trap-control.log | sort | uniq -c
   3 CALL process.memoryUsage
   3 trap-installed …
$ U4_TRAP_LOG=trap-ctl2.log node --import ./trap.mjs trapctl.mjs   (named-import statfsSync('/tmp') + spawnSync(node,-e,0))
CALL fs.statfsSync
CALL child_process.spawnSync
```

## R1 — rifty BASE shape

`rifty-shape.mts` loads `node:fs` / `node:child_process` / `node:process`
through `ensureRuntimeJsBuiltinsRegistered()` + `loadBuiltin`:

```
$ npx tsx /tmp/vgoal/u4/probes/rifty-shape.mts
{"statfsSync":"undefined","statfs":"undefined","promisesStatfs":"undefined","spawnSync":"undefined","execFileSync":"undefined","memoryUsage":"undefined","cpKeys":["spawn","exec","execFile","fork","execSync","ChildProcess"]}
```

## R2 — RED at BASE

```
$ pnpm test:parity modules/builtin-loud-members-link
  ✗ modules/builtin-loud-members-link.case.ts
    error: SyntaxError: The requested module 'node:fs' does not provide an export named 'statfsSync' (imported by /work/main.mjs)
$ pnpm test:parity child_process/pool-worker-loud-members
  ✗ child_process/pool-worker-loud-members.case.ts
    diff (- node / + rifty):
      - {"code":0,"signal":null,"stdout":"[\"function\",\"function\",\"function\",\"function\",true]","stderr":false}
      + {"code":1,"signal":null,"stdout":"","stderr":true}
```

Child stderr (diagnostic copy of the case printing `stderr` text, not committed):
`SyntaxError: The requested module 'node:fs' does not provide an export named 'statfsSync' (imported by /project/pool-worker.mjs)` at `esm-job-linker.ts:152`.

```
$ npx vitest run packages/runtime-js/src/builtins/loud-members.test.ts
   × … fs.statfsSync throws NotImplementedError("fs.statfsSync")              → expected statfsSync to be a function, got undefined
   × … child_process.spawnSync throws NotImplementedError(…)                  → expected spawnSync to be a function, got undefined
   × … process.memoryUsage and its bound form throw …                         → expected memoryUsage to be a function, got undefined
   × … process.memoryUsage.rss throws …                                       → expected memoryUsage to be a function, got undefined
   × … a kernel-seeded NodeProcess carries the same loud member               → expected memoryUsage to be a function, got undefined
      Tests  5 failed (5)
```
