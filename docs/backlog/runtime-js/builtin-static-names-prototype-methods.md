---
area: runtime-js
status: ready
title: Node-own `process` members rifty delivers are own enumerable properties, so `import { cwd } from 'node:process'` links and works unbound
created: 2026-09-15
why: tinyexec 1.3.1 and rolldown 1.0.3 (`vitest run` claimed path) `import { cwd } from 'node:process'` and fail to link — rifty's `NodeProcess` keeps cwd/chdir/hrtime/uptime/exit/kill/exitCode on its prototype, while Node owns them and both runtimes take ESM names from `Object.keys(process)`
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/builtin-static-names-prototype-methods-evidence.md]
code: [packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/module-loader/cjs-interop-authority.ts]
---

## Context

Finding. `vitest run` stops at `SyntaxError: The requested module 'node:process'
does not provide an export named 'cwd' (imported by …/tinyexec/dist/main.mjs)`;
rolldown's `load-config` chunk carries the same edge. Builtin ESM names are
`Object.keys(loadBuiltin(id))` (`cjs-interop-authority.ts:69`, ADR-0348 §2) —
Node's own rule (its facade names equal `Object.keys(process)`, evidence O2).
The defect is the object shape: `NodeProcess` declares `cwd`, `chdir`,
`hrtime`, `uptime`, `exit`, `kill` as prototype methods and `exitCode` as a
prototype accessor; Node makes all seven own enumerable. A builtin-wide scan
finds no other builtin in this class (evidence R1). Detached calls of the
`this`-dependent `exit`/`kill` also throw `TypeError` today (evidence R3).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `import { cwd } from 'node:process'` (tinyexec 1.3.1 `dist/main.mjs:2`, rolldown 1.0.3 `dist/shared/load-config-K94jokAZ.mjs:5`) links, and the imported `cwd()` called unbound equals `process.cwd()`; carrier parity `process/esm-named-members`, RED at BASE with the link `SyntaxError` on `cwd` → I6
2. `cwd`, `chdir`, `hrtime`, `uptime`, `exit`, `kill`, `nextTick` are own data properties of `process` with Node's descriptor (writable, enumerable, configurable) and `exitCode` is an own accessor (enumerable, non-configurable); each is in `Object.keys(process)`, links as a named import with `ns[name] === process[name]`, and `hrtime.bigint` stays own on the imported `hrtime`; carrier parity `process/esm-named-members` → ADR-0348
3. Detached `exit` and `kill` behave as bound: a forked child's `const { exit } = require('node:process'); exit(3)` closes with code 3 and `const { kill } = …; kill(pid, 'SIGUSR2')` with signal `SIGUSR2`, both without stderr; carrier parity `process/unbound-exit-kill` (`child-worker`), RED at BASE with `TypeError`, code 1 → ADR-0348
4. Members off Node's process own surface stay non-exports: `import { on | emit | addListener | prependListener | removeListener | removeAllListeners | listenerCount | pushStdin } from 'node:process'` is a link `SyntaxError` naming the export, and none is own on `process`; carrier parity `process/esm-named-members-off-surface` (guard, green at BASE, red under the prototype-walk mechanism — evidence R4) → ADR-0348
5. `docs/public/compat/process.md` gains a parity-backed row for `node:process` named imports of these members, and `packages/runtime-js/CHANGELOG.md` records the shape change → PR-6

## Reference contract

- Oracle: Node v24.16.0 (host, darwin), `node:process` (evidence O1–O6: commands + output).
- Mechanism reused: Node's builtin ESM facade exports exactly `Object.keys(process)` plus `default` (O2) — the rule rifty's loader already applies (ADR-0348 §2); the carrier is the process object's shape, not the linker. Node's process members do not depend on `this` (O5).

## Parity cases

1. `tools/node-parity-runner/cases/process/esm-named-members.case.ts` (`kind: 'esm'`): Node v24.16.0 prints `{"types":[7× "function"],"own":[7× [true,true,true]],"exitCode":["function","function",true,false],"keys":[8× true],"nsHas":[8× true],"identity":[7× true],"unbound":["string",true,2,"bigint",true,"number",null,true]}` (evidence O3) → I6, ADR-0348
2. `tools/node-parity-runner/cases/process/esm-named-members-off-surface.case.ts` (`kind: 'esm'`): Node prints `on:SyntaxError:true emit:SyntaxError:true addListener:SyntaxError:true prependListener:SyntaxError:true removeListener:SyntaxError:true removeAllListeners:SyntaxError:true listenerCount:SyntaxError:true pushStdin:SyntaxError:true` and eight `false` own flags (evidence O4) → ADR-0348
3. `tools/node-parity-runner/cases/process/unbound-exit-kill.case.ts` (`kind: 'child-worker'`): Node prints `{"file":"unbound-exit.js","code":3,"signal":null,"stderr":false}` and `{"file":"unbound-kill.js","code":null,"signal":"SIGUSR2","stderr":false}` (evidence O5) → ADR-0348

## Out of scope

- `process.memoryUsage` (Node-own, absent in rifty): item `runtime-js/absent-builtin-members-loud-throws` makes it an own member throwing `NotImplementedError('process.memoryUsage')`.
- `exitCode` value semantics (rifty default `0`, Node `undefined`) and argument-less `exit()`: item `runtime-js/process-lifecycle-events-exit-code`. This unit keeps today's getter/setter behavior; no case prints the value.
- Node-own process members rifty does not implement (the `absent` names in evidence R1, e.g. `umask`, `cpuUsage`, `emitWarning`, `getuid`): stay a link-time `SyntaxError` per ADR-0348 §2 and the compat `modules.md` `node:` built-ins row.
- `process.kill` beyond `kill(process.pid, 'SIGUSR2')`: stays `NotImplementedError('process.kill')`.
- Function metadata (`name` `wrappedCwd`/`wrappedChdir`, `length`, `prototype`; evidence O6): not claimed.
- Pre-existing divergences found here, outside this result and routed by the goal driver (`REV-12`): own enumerable `send`/`disconnect`/`connected`/`channel`/`_listenersMap`/`_warned` on a non-IPC process link as named imports (evidence D1); self `kill(process.pid, 'SIGUSR2')` with a live listener terminates instead of running it (evidence D2). No carrier here depends on either.

## Decisions

ready-verdict: 2026-09-23 — Contract+RED @ 5f355a65423d5bb3db6e1bfed48e9e18e9717b6f

- 2026-09-23 — mechanism: reshape `NodeProcess` (per-instance own enumerable members; `exitCode` own accessor defined in the constructor); the static-name rule in `cjs-interop-authority.ts` stays `Object.keys` (ADR-0348 §2). The draft's "include prototype methods" is rejected: a prototype walk exports EventEmitter methods and `pushStdin`, which Node rejects (evidence O2, O4, R4).
- 2026-09-23 — scope: all seven prototype-hidden Node-own names, not only `cwd`. The builtin-wide scan shows the class is exactly these seven in `process` and nowhere else (evidence R1); one mechanism removes the whole class.
- 2026-09-23 — no ADR: ADR-0348's rule is unchanged and the shape is Node's; the CHANGELOG line records it (DEC-1, reversible).
- 2026-09-23 — no `## Fault matrix`: only binding and descriptor shape change; no cache, persistence, network or concurrency behavior changes. `exit`/`kill` reuse their existing control paths.
- 2026-09-23 — carriers: the parity `esm` kind links against the same `NodeProcess` class and loader linker as the browser realm. Detached `exit`/`kill` need `child-worker`, because the in-process fork shim gives children a plain-object process (evidence R3). The vitest e2e (map item 12) covers the claimed path end to end.
- 2026-09-23 — `process.ts` is at 1224 lines against its 1226 pin. IMPLEMENT first extracts one cohesive block (≤140 lines, stdout/stderr TTY writer), with no behavior change, into a new module. That leaves headroom for items 4/7/9/11. Then it reshapes the members and drops the prototype `hrtime.bigint` patch.
- 2026-09-23 — this title replaces map item 3's wording ("static export names … include its prototype methods"); the promise that the named import links is unchanged. The land step owns the map edit.
