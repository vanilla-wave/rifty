---
kind: epic
status: ready
title: vitest runs in the browser shell — install, run, real pass/fail and Node's exit code
created: 2026-09-15
value: A real vitest project (exact vitest 4.1.11 on exact vite 8.0.16) installs and runs `vitest run` inside rifty with Node's pass/fail output and exit code, on both vitest pools.
user_story: As a developer opening a JS project in the browser IDE, I want `npm install` + `npm test` (vitest) to behave like on my machine, but today `npm install` cannot pin vite the npm way and `vitest run` exits 0 silently with no output.
tier: works
---

## Outcome

`npm install` + `vitest run` work in the rifty shell for the exact pair
vitest 4.1.11 / vite 8.0.16 with the project's own `vitest.config.ts` and
TypeScript tests (no rifty-specific configuration), both pools (`forks`
default, `threads` opt-in), with the real reporter output and Node's exit code.

Faithful-runtime payoff: every wall vitest hits is a generic Node contract —
process lifecycle handlers/`exit`/`exitCode`, live-handle keepalive for
Workers, `child_process` advanced IPC serialization, `worker_threads` stdio
streams, `vm` script offsets, builtin export-name projection, ESM/CJS
Function-guard precision on `globalThis[Symbol]` writes. Closing them for
vitest closes them for every cac-driven CLI, tinypool user and undici
consumer. npm-client stays untouched beyond one spelling defect: an honest
npm is a separate planned goal.

## User scenario

1. Clean project in the shell: `package.json`
   `{"type":"module","scripts":{"test":"vitest run"},"devDependencies":{"vitest":"4.1.11"},"overrides":{"vite":"8.0.16"}}`,
   `vitest.config.ts` (`import { defineConfig } from 'vitest/config';
   export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })`),
   `src/sum.ts` (`export const sum = (a: number,
   b: number): number => a + b`), `src/sum.test.ts` with one passing
   (`sum(1,2) === 3`) and one failing (`sum(1,2) === 4`) test.
2. `npm install` → one `node_modules/vite` at 8.0.16 satisfying vitest's
   `vite ^8` edge, rolldown wasm32 binding, the lightningcss shadow line; exit 0.
3. `vitest run` → the TypeScript config is loaded and honoured (only the
   `include` glob is collected), the default reporter lists `src/sum.test.ts`,
   `1 passed`, `1 failed` with the assertion diff; exit code 1. Fix the test →
   exit 0. `npm test` and `vitest run --reporter=verbose` behave the same.
4. `vitest run --pool=threads` → same results and exit code as `--pool=forks`.
5. Guarantee only the stated `vitest run` scenario on Vitest4.1.11/Vite8.0.16,
   both pools. Other versions/modes (including watch) are outside the guarantee,
   without artificial bans. Compat lists concrete measured loud gaps honestly.
6. Advanced IPC supports the non-binary graphs needed by this scenario.
   Binary graphs (Buffer, typed arrays, DataView, ArrayBuffer/SharedArrayBuffer,
   including nested values) throw a named NotImplementedError synchronously;
   binary IPC support is not required by this epic.


## Invariants

<!-- Each false on main 51440931a (2026-09-15). Evidence (rifty runs + real
     Node v24.16.0 oracle, commands + output):
     docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md.
     Stack lines quoted there are dev-server bundle offsets; source lines
     cited here are the current files.
     I1 — overrides `{"vite":"8.0.16"}` → `install failed: Failed to fetch
          packument 8.0.16: 404` (overrides.ts:47 splits on '@' → name);
          rifty spelling `vite@8.0.16` installs 48 packages, one vite 8.0.16.
     I2 — program with a Worker posting after 700 ms exits 0 at 0.4 s, no
          message, no 'exit' (Node: `got hi`, `wexit 0`, `EXIT 0`);
          ADR-0152 counts timers/immediates/imports (+ detached fetch,
          ADR-0158); worker_threads.ts takes no keepalive ref.
     I3 — `process.on('uncaughtException')` handler never called, process dies
          `Uncaught Error: boom` exit 1 (Node: `caught boom`, `after`, exit 0);
          same for `unhandledRejection`; `process.once('exit')` never fires;
          `exitCode=3; process.exit()` → 0 (Node: 3; process.ts:750
          `exit(code = 0)`). vitest relies on all four: worker
          init.js:115 `processOn("uncaughtException", …)`, cli-api:2081
          `process.on("unhandledRejection", …)`, cli-api:2063
          `process.once("exit", onExit)`, cac.js:2348 / cli-api:2059,2079
          `process.exitCode = …; process.exit()`.
     I4 — `vitest run` exits 0 with empty output at 1.9 s, the
          `process.exit(0)` issued by node-program-lifecycle.ts:155 while the
          cac action is pending; the wall sits before config loading or file
          collection, so the config/TS clauses are false on main by the same
          run (the amended scenario with `vitest.config.ts` + `.ts` tests was
          re-run on main 2026-09-16 — evidence §I4-amended). vite's TS-config
          loading is proven only for the 7.3.6/esbuild CLI path
          (docs/public/compat/vite-command.md); the 8.0.16/rolldown config
          bundle and vitest's `.ts` transform are map fog — a wall there
          enters this goal by re-chart. child_process.ts:324 throws
          `child_process.serialization.advanced` (forks pool);
          readable.ts:768 `dest.end()` → `dest.end is not a function` when
          vitest pipes the child's stdout into process.stdout; worker init
          `process.memoryUsage.bind` → TypeError (undefined).
     I5 — worker_threads.ts:111 throws `worker_threads.Worker.execArgv` for
          own-property `execArgv: []`; Worker exposes no stdout/stderr streams
          (Node: `typeof w.stdout === 'object'`, output captured).
     I6 — walls hit in order on the claimed path: `Built-in 'node:path/posix'
          is not implemented` (index.ts:73 registers `path` only); `does not
          provide an export named 'statfsSync'` (fs) / `'cwd'` (process;
          cjs-interop-authority.ts:69 = Object.keys of the instance);
          `module-loader.esm-global-function-assignment` on @vitest/utils
          (`globalThis[SAFE_TIMERS_SYMBOL] = timers`), CJS twin on
          undici/lib/global.js; vm/index.ts:199 throws on `columnOffset`
          (Node honours both offsets: `/virtual/mod2.js:12:21`).
     I7 — no vitest page or row in docs/public/compat/. -->

1. I1. The scenario manifest with npm-spelled `"overrides": {"vite": "8.0.16"}`
   installs one `node_modules/vite@8.0.16` that satisfies vitest's `vite ^8`
   edge and exits 0; the rifty spelling `vite@8.0.16` keeps working.
2. I2. A Node program keeps running while a `worker_threads.Worker` it created
   is alive: the parent receives the worker's later messages and its `exit`
   event before the process ends, as in Node (an `unref()`'d worker does not
   hold the loop, as in Node).
3. I3. `process.on('uncaughtException' | 'unhandledRejection')` handlers
   receive the error and the process continues as in Node; `process.once('exit')`
   fires with the final code; `process.exit()` without an argument exits with
   `process.exitCode`.
4. I4. `vitest run` (default `forks` pool) never exits 0 with empty output; it
   loads and honours the project's `vitest.config.ts`, collects and runs the
   TypeScript test file, prints the default reporter's per-file and per-test
   results — 1 passed, 1 failed with the assertion diff — and exits 1; after
   the fix it exits 0; `npm test` and `--reporter=verbose` behave the same.
   Pass/fail lines, counts and exit code are claimed; byte-identical
   timing/ANSI is not.
5. I5. `vitest run --pool=threads` reports the same results and exit code as
   `--pool=forks`.
6. I6. The vitest CLI and its pool workers load and execute every module of the
   exact vitest 4.1.11 tree on the claimed path as under Node 24 — no
   link-time SyntaxError, no `ModuleLoadError`, no loader ceiling; a member the
   browser cannot provide is reachable only by an unclaimed call and throws a
   named `NotImplementedError`.
7. I7. `docs/public/compat/vitest.md` guarantees only the stated `vitest run`
   scenario on Vitest4.1.11/Vite8.0.16, with the manifest pin precondition,
   TypeScript config/tests and both pools (I1–I6). Other versions and modes,
   including watch, remain outside the guarantee without artificial bans.
   Name concrete measured loud gaps; distinguish unsupported calls from
   unverified modes. Advanced binary IPC graphs explicitly throw a named
   NotImplementedError; non-binary Vitest IPC remains required.


## Challenge

<!-- Fresh read-only critic 2026-09-15 on the pre-interview draft (original
     request, probe evidence, alternatives, open forks). Each problem
     re-entered the interview/research loop; resolution per line. Final
     written-result checks (RDY-6) are recorded in ledger.md as they complete
     (verdict, reviewer, reviewed revision). -->

challenge: 2026-09-15 — 6 problems (all resolved before FIT; lines below)

- P1 cheaper npm route omitted: `overrides` already parses `vite@8.0.16` and
  applies to nested edges (overrides.ts, shadow-shims.ts) — verified by a live
  probe (48 packages, one vite 8.0.16); adopted; only npm's bare-version
  spelling stays as the one-line defect (I1).
- P2 dedupe patch is resolution work (Arborist semantics, ADR + differential
  suite), not minimal — accepted; rejected route below.
- P3 `__riftyTrackCliPromise` is a vite-only install patch; root cause is the
  narrow keepalive handle set (ADR-0152) — accepted; I2 + rejected route.
- P4 forks-only hid the cost asymmetry — both costs shown; user chose both
  pools (I5).
- P5 claim breadth undecided — user chose the exact pair (I7).
- P6 what the user must bring — scenario fixes the overrides pin; npm-authored
  lockfile replay stays the documented second path (no epic work); I7 states
  the precondition.

## Decisions

- 2026-09-15 — user: npm route = overrides pin; fix npm's bare-version spelling
  (one line, `npm-client/overrides-bare-version-spec`); lock replay is the
  second documented path; no resolver/hoisting work — "honest npm" is a
  separate planned goal ("Только npm волнует… минимальной заплаткой").
- 2026-09-15 — user: both pools (`forks` default + `threads`): "давай полную
  реализацию, думаю это будет полезно для экосистемы".
- 2026-09-15 — user: jsdom deferred to draft epic `jsdom-environment-in-browser`
  ("Вынести в отдельный эпик/спайк"). Scope base = `vitest run` with
  `environment: node` (the option set the user chose from). Agent: watch mode
  and coverage were offered as separate options and not chosen → out of scope,
  loud (map).
- 2026-09-15 — user: claim = exact pair vitest 4.1.11 + vite 8.0.16.
- 2026-09-16 — user: `vitest.config.ts` and TypeScript test files are in the
  claim ("Да: config.ts + .ts-тесты в заявке") — Outcome, scenario, I4, I7
  amended before ready; no child seeded now (vite's TS-config loading is
  proven for the 7.3.6/esbuild path only; the 8.0.16/rolldown config bundle
  and vitest's `.ts` transform are first exercised at item 12 — map fog), a
  wall found there re-charts the map.
- tier: works (2026-09-15, agent) — honest happy path + loud throws; the
  scenario has no crash/reload or fault-injection axis. A child touching
  concurrency/IPC (keepalive, advanced IPC) still owes its DoD `## Fault matrix`
  rows at pickup (AGENTS.md DoD); the tier only bounds what the goal requires.
- carriers (agent): Worker keepalive = a handle class in
  event-loop-keepalive (ADR-0152 correction or short ADR citing it), never a
  per-package source patch; advanced IPC = structured-clone passthrough over
  the existing kernel channel (child side already non-JSON: process.ts
  `#jsonIpc`) — no new coordination mechanism; guard precision = a computed key
  bound to a `Symbol` value is provably never `'Function'`.
- rejected route: chase latest vite (lightningcss recipe 1.32.0→1.33.0 plus
  vite install-patch re-cuts per release) — violates Outcome clause "npm-client
  stays untouched"; 8.3.0 bootability unverified (probe contaminated by a stale
  package dir, see evidence).
- rejected route: Arborist-style dedupe to the hoisted satisfying version —
  violates the same clause (changes resolution identity/lock/peer placement).
- rejected route: vitest-specific install-time patch for the silent exit —
  violates I2 (generic handle model) and I7 (would pin vitest by source shape).

- 2026-09-25 — user amendment: “Vitest достаточно; бинарный IPC явно запрещён”.
  Binary graph fidelity is removed from this epic; synchronous named binary
  ceiling and native non-binary cloning replace it. Both pools and primary
  Vitest scenario remain required.
- 2026-09-25 — user amendment: “Да, точная гарантия и честные ограничения”.
  I7/scenario5 now guarantee only the stated vitest run pair; other versions
  and modes (including watch) are unclaimed, without artificial bans.
  Measured gaps stay explicit; prior blanket-ban requirement is superseded.

- 2026-09-25 — user also accepts the proposed named opaque-brand ceiling for
  ambiguous locked-constructor records as an allowed limitation. This does not
  revoke the explicit binary prohibition. Prefer native cloning when it avoids
  that extra limitation; no artificial frozen-record rejection is required.
