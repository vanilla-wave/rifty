# Evidence — builtin-static-names-prototype-methods

Unit: `docs/backlog/runtime-js/builtin-static-names-prototype-methods.md`
(goal `vitest-run-in-browser`, I6). Oracle: host Node v24.16.0 / npm 11.17.0,
darwin, run 2026-09-23. Rifty baseline: BASE `325ae797c0406453aed61b3a4e5d16f9c219d5ea`.
Probe scripts live in the scratch dir `/tmp/vgoal/u3/oracle` (sources quoted below).

## O1 — which process members Node owns (descriptors)

```
$ node --version; npm --version
v24.16.0
11.17.0
$ node -e "for (const k of ['cwd','chdir','hrtime','uptime','exit','kill','memoryUsage','nextTick','exitCode','addListener','on','emit','listenerCount','prependListener','removeListener','removeAllListeners','pushStdin','send','disconnect','connected','channel']) { const d = Object.getOwnPropertyDescriptor(process, k); console.log(k, d ? ('value' in d ? 'data w=' + d.writable : 'accessor get=' + typeof d.get + ' set=' + typeof d.set) + ' e=' + d.enumerable + ' c=' + d.configurable : 'NOT-OWN') }"
cwd data w=true e=true c=true
chdir data w=true e=true c=true
hrtime data w=true e=true c=true
uptime data w=true e=true c=true
exit data w=true e=true c=true
kill data w=true e=true c=true
memoryUsage data w=true e=true c=true
nextTick data w=true e=true c=true
exitCode accessor get=function set=function e=true c=false
addListener NOT-OWN
on NOT-OWN
emit NOT-OWN
listenerCount NOT-OWN
prependListener NOT-OWN
removeListener NOT-OWN
removeAllListeners NOT-OWN
pushStdin NOT-OWN
send NOT-OWN
disconnect NOT-OWN
connected NOT-OWN
channel NOT-OWN
$ node -e "const d = Object.getOwnPropertyDescriptor(process.hrtime, 'bigint'); console.log(d.writable, d.enumerable, d.configurable)"
true true true
```

## O2 — Node's ESM facade names are exactly `Object.keys(process)`

`facade.mjs`:

```js
import process from 'node:process';
import * as ns from 'node:process';
const keys = [...Object.keys(process), 'default'].sort();
const nsKeys = Object.keys(ns).sort();
console.log(JSON.stringify({ equal: JSON.stringify(keys) === JSON.stringify(nsKeys), onlyKeys: keys.filter((k) => !nsKeys.includes(k)), onlyNs: nsKeys.filter((k) => !keys.includes(k)), protoOwn: Object.getOwnPropertyNames(Object.getPrototypeOf(process)).sort(), protoProto: Object.getPrototypeOf(Object.getPrototypeOf(process)) === (await import('node:events')).EventEmitter.prototype }));
```

```
$ node facade.mjs
{"equal":true,"onlyKeys":[],"onlyNs":[],"protoOwn":["constructor"],"protoProto":true}
```

Node's rule = rifty's ADR-0348 §2 rule (enumerable own keys of the runtime
object). Node's process prototype carries nothing but `constructor` and chains
to `EventEmitter.prototype`; a prototype walk exports names Node rejects (O4).

## O3 — named imports link and work unbound (= parity `process/esm-named-members`)

`named.mjs` (same program as the case `code`):

```js
import process, { cwd, chdir, hrtime, uptime, exit, kill, nextTick } from 'node:process';
import * as ns from 'node:process';
const names = ['cwd', 'chdir', 'hrtime', 'uptime', 'exit', 'kill', 'nextTick'];
const d = (k) => Object.getOwnPropertyDescriptor(process, k);
const before = cwd();
console.log(JSON.stringify({
  types: [cwd, chdir, hrtime, uptime, exit, kill, nextTick].map((f) => typeof f),
  own: names.map((k) => d(k) ? [d(k).writable, d(k).enumerable, d(k).configurable] : null),
  exitCode: (({ get, set, enumerable, configurable }) => [typeof get, typeof set, enumerable, configurable])(d('exitCode')),
  keys: [...names, 'exitCode'].map((k) => Object.keys(process).includes(k)),
  nsHas: [...names, 'exitCode'].map((k) => k in ns),
  identity: names.map((k) => ns[k] === process[k]),
  unbound: [typeof cwd(), cwd() === process.cwd(), Array.isArray(hrtime()) && hrtime().length, typeof hrtime.bigint(), Object.hasOwn(hrtime, 'bigint'), typeof uptime(), chdir(before), cwd() === before],
}));
```

```
$ node named.mjs
{"types":["function","function","function","function","function","function","function"],"own":[[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true]],"exitCode":["function","function",true,false],"keys":[true,true,true,true,true,true,true,true],"nsHas":[true,true,true,true,true,true,true,true],"identity":[true,true,true,true,true,true,true],"unbound":["string",true,2,"bigint",true,"number",null,true]}
```

(The committed case differs only by `hrtime().length` without the `Array.isArray`
guard and `d('exitCode') ?? {}`; the runner's Node side printed this exact
line for it — R4 mutant 1 diff, `-` side.)

## O4 — members off Node's own surface are not exports (= parity `process/esm-named-members-off-surface`)

`off-<name>.mjs` = `import { <name> } from 'node:process';`; `off.mjs` imports each dynamically:

```
$ node off.mjs
on:SyntaxError:true emit:SyntaxError:true addListener:SyntaxError:true prependListener:SyntaxError:true removeListener:SyntaxError:true removeAllListeners:SyntaxError:true listenerCount:SyntaxError:true pushStdin:SyntaxError:true
$ node --input-type=module -e "import { on } from 'node:process'" 2>&1 | grep SyntaxError
SyntaxError: The requested module 'node:process' does not provide an export named 'on'
```

Committed case programs run directly under Node (case `code` + `setup.files`
written out verbatim, `node main.mjs` / `node named-case.mjs`):

```
$ node main.mjs          # process/esm-named-members-off-surface
on:SyntaxError:true emit:SyntaxError:true addListener:SyntaxError:true prependListener:SyntaxError:true removeListener:SyntaxError:true removeAllListeners:SyntaxError:true listenerCount:SyntaxError:true pushStdin:SyntaxError:true
[false,false,false,false,false,false,false,false]
$ node named-case.mjs    # process/esm-named-members
{"types":["function","function","function","function","function","function","function"],"own":[[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true]],"exitCode":["function","function",true,false],"keys":[true,true,true,true,true,true,true,true],"nsHas":[true,true,true,true,true,true,true,true],"identity":[true,true,true,true,true,true,true],"unbound":["string",true,2,"bigint",true,"number",null,true]}
```

## O5 — detached `this`-dependent members behave as bound (= parity `process/unbound-exit-kill`)

```
$ node -e "const { exit } = process; process.stdout.write('before\n'); exit(3)"; echo "rc=$?"
before
rc=3
$ node --input-type=module -e "import { exit } from 'node:process'; process.stdout.write('before\n'); exit(4)"; echo "rc=$?"
before
rc=4
$ node -e "const { kill } = process; console.log(kill(process.pid, 0))"
true
$ node -e "const p = require('node:process'); const { kill } = p; const t = setTimeout(() => {}, 2000); p.once('SIGUSR2', () => { p.stdout.write('got SIGUSR2\n'); clearTimeout(t); }); p.stdout.write('sent ' + kill(p.pid, 'SIGUSR2') + '\n')"; echo "rc=$?"
sent true
got SIGUSR2
rc=0
```

Case carrier (fork, `stdio: ['ignore','pipe','pipe','ipc']`, children
`const { exit } = require('node:process'); exit(3);` and
`const { kill } = require('node:process'); setInterval(() => {}, 1000); kill(require('node:process').pid, 'SIGUSR2');`):

```
$ node main.js
{"file":"unbound-exit.js","code":3,"signal":null,"stderr":false}
{"file":"unbound-kill.js","code":null,"signal":"SIGUSR2","stderr":false}
```

## O6 — function metadata (not claimed)

```
$ node -e "for (const k of ['cwd','chdir','hrtime','uptime','exit','kill','nextTick']) console.log(k, process[k].name, process[k].length, typeof process[k].prototype)"
cwd wrappedCwd 0 object
chdir wrappedChdir 1 object
hrtime hrtime 1 object
uptime uptime 0 undefined
exit exit 1 object
kill kill 2 object
nextTick nextTick 1 object
```

## R1 — rifty baseline shape (BASE)

`/tmp/vgoal/u3/rifty-keys.ts` (tsx 4.22.3 over `packages/runtime-js/src/builtins/process.ts`, `riftyProcess`; excerpt):

```
RIFTY_KEYS ["_listenersMap","_warned","pid","ppid","argv","execArgv","argv0","execPath","platform","arch","version","versions","features","title","env","stdout","stderr","stdin","nextTick","send","disconnect","connected","channel","release"]
RIFTY_PROTO_NAMES ["constructor","exitCode","addListener","prependListener","removeListener","removeAllListeners","cwd","chdir","hrtime","uptime","exit","kill","pushStdin"]
```

```
NODE_KEYS_NOT_OWN_ENUM_IN_RIFTY _rawDebug: absent | moduleLoadList: absent | binding: absent | _linkedBinding: absent | _events: absent | _eventsCount: absent | _maxListeners: absent | domain: absent | _exiting: absent | exitCode: PROTOTYPE | config: absent | dlopen: absent | uptime: PROTOTYPE | _getActiveRequests: absent | _getActiveHandles: absent | getActiveResourcesInfo: absent | reallyExit: absent | _kill: absent | loadEnvFile: absent | cpuUsage: absent | threadCpuUsage: absent | resourceUsage: absent | memoryUsage: absent | constrainedMemory: absent | availableMemory: absent | kill: PROTOTYPE | exit: PROTOTYPE | execve: absent | ref: absent | unref: absent | finalization: absent | hrtime: PROTOTYPE | openStdin: absent | getuid: absent | geteuid: absent | getgid: absent | getegid: absent | getgroups: absent | allowedNodeEnvironmentFlags: absent | _fatalException: absent | setUncaughtExceptionCaptureCallback: absent | hasUncaughtExceptionCaptureCallback: absent | emitWarning: absent | _tickCallback: absent | sourceMapsEnabled: absent | setSourceMapsEnabled: absent | getBuiltinModule: absent | _debugProcess: absent | _debugEnd: absent | _startProfilerIdleNotifier: absent | _stopProfilerIdleNotifier: absent | abort: absent | umask: absent | chdir: PROTOTYPE | cwd: PROTOTYPE | initgroups: absent | setgroups: absent | setegid: absent | seteuid: absent | setgid: absent | setuid: absent | debugPort: absent | _preload_modules: absent | report: absent | emit: PROTOTYPE | mainModule: absent
RIFTY_OWN_ENUM_NOT_IN_NODE ["_listenersMap","_warned","send","disconnect","connected","channel"]
```

(`emit` is a tsx-host artifact, see below; `mainModule` is own only under a
CommonJS entry: `node mm.cjs` → `true`, `node mm.mjs` → `false` for
`console.log(Object.keys(process).includes('mainModule'))`.) `absent` names are
Node-own members rifty does not implement: out of this unit (ADR-0348 §2
link-time miss). Node-own names that rifty delivers only on the prototype: `exitCode, uptime,
kill, exit, hrtime, chdir, cwd` (`nextTick` is already an own field).

Builtin-wide scan (`/tmp/vgoal/u3/builtin-scan.mts`: every one of the 48
registered rifty builtins incl. `@riftydev/net/register-builtins`; Node-own
enumerable key present in rifty only via prototype or as non-enumerable own):

```
process: exitCode(proto),uptime(proto),kill(proto),exit(proto),hrtime(proto),chdir(proto),cwd(proto),emit(proto)
```

`emit` is a tsx artifact (`node -e "Object.hasOwn(process,'emit')"` → `false`;
under tsx v4.22.3 → `true`). So `process` is the only builtin in this class and
the class is exactly those 7 names.

## R2 — claimed-tree consumers

`/tmp/vgoal/u3/tree`: `npm install --ignore-scripts` of the goal manifest
(`vitest 4.1.11`, `overrides {vite: 8.0.16}`) → vite 8.0.16, vitest 4.1.11.
`scan-process-imports.mjs` (every `import … from '(node:)process'` and
`{…} = process` destructure):

```
$ node /tmp/vgoal/u3/scan-process-imports.mjs
node_modules/rolldown/dist/cli.mjs: import process$1 from 'node:process'
node_modules/rolldown/dist/shared/load-config-K94jokAZ.mjs: import { cwd } from 'node:process'
node_modules/rolldown/dist/shared/prompt-DYnaB1Nb.mjs: import process$1, { stdin, stdout } from 'node:process'
node_modules/rolldown/dist/shared/rolldown-build-CrPk_lZe.mjs: import process$1 from 'node:process'
node_modules/rolldown/dist/shared/rolldown-build-CrPk_lZe.mjs: destructure { env } = process
node_modules/tinyexec/dist/main.mjs: import { cwd } from 'node:process'
node_modules/vite/dist/node/chunks/node.js: import process$1 from 'node:process'
node_modules/vite/dist/node/chunks/node.js: destructure { platform } = process
node_modules/vite/dist/node/chunks/node.js: destructure { platform, arch } = process
node_modules/vitest/dist/chunks/index.BCY_7LL2.js: import process$1 from 'node:process'
node_modules/vitest/dist/chunks/index.CMESou6r.js: import process from 'node:process'
node_modules/vitest/dist/chunks/index.og1WyBLx.js: destructure { FORCE_COLOR, NODE_DISABLE_COLORS, TERM } = process
node_modules/vitest/dist/chunks/modules.BJuCwlRJ.js: destructure { bun: isBun, deno: isDeno } = process
node_modules/vitest/suppress-warnings.cjs: destructure { emit } = process
```

`stdin`/`stdout` are already own in rifty; `suppress-warnings.cjs` re-applies
`emit` bound (`Reflect.apply(emit, this, arguments)`).

Uses: tinyexec `main.mjs:153/314/362` `options.cwd ?? cwd()`; rolldown
`load-config:60` `readdir(cwd())` — unbound calls.

## R3 — RED at BASE (runner output, excerpt)

```
$ pnpm test:parity process/esm-named-members
  ✓ process/esm-named-members-off-surface.case.ts          (guard: green at BASE by design)
  ✗ process/esm-named-members.case.ts
    error: SyntaxError: The requested module 'node:process' does not provide an export named 'cwd' (imported by /work/main.mjs)
$ pnpm test:parity process/unbound-exit-kill
  ✗ process/unbound-exit-kill.case.ts
      - {"file":"unbound-exit.js","code":3,"signal":null,"stderr":false}
      + {"file":"unbound-exit.js","code":1,"signal":null,"stderr":true}
      - {"file":"unbound-kill.js","code":null,"signal":"SIGUSR2","stderr":false}
      + {"file":"unbound-kill.js","code":1,"signal":null,"stderr":true}
```

Carrier kind matters: the same fork program under the default in-process
`cjs` kind passes at BASE — the in-process fork shim gives children a
plain-object process (`child_process-exec.ts:322` `Object.exit` throws
`__process.exit`), not `NodeProcess`; only `kind: 'child-worker'` runs the
children as physical kernel Workers with the real `NodeProcess`.

Rifty stderr first lines (temporary copy printing them):
`TypeError: Cannot set properties of undefined (setting '#exitCode')` and
`TypeError: Cannot read properties of undefined (reading 'pid')`. Control: the
same children calling `p.exit(3)` / `p.kill(p.pid, 'SIGUSR2')` bound match
Node at BASE (`✓`), so the RED isolates the detached call.

## R4 — mutants the carriers kill (temporary edits, reverted)

1. Prototype walk in `cjs-interop-authority.ts` (#349 mechanism: add every
   prototype-chain own name to builtin static names):

```
  ✗ process/esm-named-members-off-surface.case.ts
      - on:SyntaxError:true emit:SyntaxError:true … pushStdin:SyntaxError:true
      + on:linked emit:linked addListener:linked … pushStdin:linked
  ✗ process/esm-named-members.case.ts
      - {"types":["function","function","function","function","function","function","function"],"own":[[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true],[true,true,true]],"exitCode":["function","function",true,false],"keys":[true,true,true,true,true,true,true,true],"nsHas":[true,true,true,true,true,true,true,true],"identity":[true,true,true,true,true,true,true],"unbound":["string",true,2,"bigint",true,"number",null,true]}
      + {"types":["function","function","function","function","function","function","function"],"own":[null,null,null,null,null,null,[true,true,true]],"exitCode":["undefined","undefined",null,null],"keys":[false,false,false,false,false,false,true,false],"nsHas":[true,true,true,true,true,true,true,true],"identity":[true,true,true,true,true,true,true],"unbound":["string",true,2,"bigint",true,"number",null,true]}
```

2. Own enumerable properties holding the unbound prototype methods (+ own
   `exitCode` accessor): `process/esm-named-members*` both `✓`,
   `process/unbound-exit-kill` `✗` with the R3 TypeErrors.

## D — discoveries outside this unit (for REV-12 routing by the goal driver)

1. Over-export: non-IPC rifty process has own enumerable `send`,
   `disconnect`, `connected`, `channel` (`undefined`) and EventEmitter internals
   `_listenersMap`, `_warned`; each links as a `node:process` named import.
   Node (O1): not own → SyntaxError. Probe (temporary esm case):
   `- send:SyntaxError disconnect:SyntaxError connected:SyntaxError channel:SyntaxError _listenersMap:SyntaxError _warned:SyntaxError`
   `+ send:linked disconnect:linked connected:linked channel:linked _listenersMap:linked _warned:linked`.
2. Self `SIGUSR2` with a live listener: rifty kernel `control:self-signal`
   → `killRecordTree` (packages/kernel/src/process-manager.ts:888) terminates;
   Node runs the listener. Probe (temporary child-worker case, forked child of O5's listener program):
   `- {"out":"sent true\ngot SIGUSR2\n","code":0,"signal":null}`
   `+ {"out":"sent true\n","code":null,"signal":"SIGUSR2"}`.

## Appendix — probe sources

`/tmp/vgoal/u3/builtin-scan.mts` (run `npx tsx` from the worktree root):

```ts
import { createRequire } from 'node:module';
import { listBuiltins, loadBuiltin } from '<worktree>/packages/io/src/index.ts';
import { ensureRuntimeJsBuiltinsRegistered } from '<worktree>/packages/runtime-js/src/builtins/index.ts';
ensureRuntimeJsBuiltinsRegistered();
await import('<worktree>/packages/net/src/register-builtins.ts');
const req = createRequire(import.meta.url);
const out: string[] = [];
for (const id of listBuiltins().sort()) {
  let node: Record<string, unknown>;
  try { node = req(`node:${id}`); } catch { out.push(`${id}: node-absent`); continue; }
  let r: Record<string, unknown> | null;
  try { r = loadBuiltin(id); } catch (e) { out.push(`${id}: rifty-load-throws ${(e as Error).message.slice(0, 60)}`); continue; }
  if (!r) continue;
  const hidden: string[] = [];
  for (const k of Object.keys(node)) {
    const d = Object.getOwnPropertyDescriptor(r, k);
    if (d?.enumerable) continue;
    let inChain = false;
    try { inChain = k in r; } catch { /* */ }
    if (d || inChain) hidden.push(`${k}(${d ? 'own-nonenum' : 'proto'})`);
  }
  if (hidden.length) out.push(`${id}: ${hidden.join(',')}`);
}
console.log(out.join("\n")); process.exit(0);
```

`/tmp/vgoal/u3/rifty-keys.ts`:

```ts
import { riftyProcess } from '<worktree>/packages/runtime-js/src/builtins/process.ts';
const p = riftyProcess as unknown as Record<string, unknown>;
console.log('RIFTY_KEYS', JSON.stringify(Object.keys(p)));
const nodeKeys = Object.keys(process);
const rows: string[] = [];
for (const k of nodeKeys) {
  const d = Object.getOwnPropertyDescriptor(p, k);
  const inChain = k in p;
  if (!d || !d.enumerable) rows.push(`${k}: ${d ? 'own-nonenum' : inChain ? 'PROTOTYPE' : 'absent'}`);
}
console.log('NODE_KEYS_NOT_OWN_ENUM_IN_RIFTY', rows.join(' | '));
const extra = Object.keys(p).filter((k) => !nodeKeys.includes(k));
console.log('RIFTY_OWN_ENUM_NOT_IN_NODE', JSON.stringify(extra));
const proto = Object.getPrototypeOf(p);
console.log('RIFTY_PROTO_NAMES', JSON.stringify(Object.getOwnPropertyNames(proto)));
```

`/tmp/vgoal/u3/scan-process-imports.mjs` (cwd = the installed tree):

```js
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const hits = [];
function walk(d) {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (/\.(m?js|cjs)$/.test(n)) {
      const src = readFileSync(p, 'utf8');
      const re = /import\s*([^'";]*?)\s*from\s*['"](node:)?process['"]/gs;
      let m;
      while ((m = re.exec(src))) hits.push(`${p}: import ${m[1].replace(/\s+/g, ' ')} from '${m[2] ?? ''}process'`);
      const re2 = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*(?:require\(['"](?:node:)?process['"]\)|process)\b/g;
      while ((m = re2.exec(src))) hits.push(`${p}: destructure {${m[1].replace(/\s+/g, ' ')}} = process`);
    }
  }
}
walk('node_modules');
console.log(hits.join('\n'));
```
