---
area: runtime-js
status: ready
title: `fs.statfsSync`, `child_process.spawnSync` and `process.memoryUsage` exist as Node-shaped members that throw a named `NotImplementedError` when called
created: 2026-09-15
why: absent members surface as link-time SyntaxError (named import of statfsSync/spawnSync) or `undefined.bind` TypeError (vitest worker init binds process.memoryUsage) — worse than a NotImplementedError and fatal even when the member is never called on the claimed path
epic: vitest-run-in-browser
sources: [docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/reference/absent-builtin-members-loud-throws-evidence.md, docs/backlog/runtime-js/node-builtins-loud-stub-capability-gaps.md]
code: [packages/runtime-js/src/builtins/fs.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/process.ts]
---

## Context

Finding. vitest 4.1.11 links `statfsSync` from `node:fs`
(`chunks/cli-api.CnMVyzaz.js:1`). tinyexec 1.3.1 links `spawnSync` from
`node:child_process` (`dist/main.mjs:1`). Both pool workers run
`process.memoryUsage.bind(process)` at load (`chunks/init.k9zZ9sLh.js:197`).
Rifty has none of the three (evidence R1). `vitest run` therefore stops at
`SyntaxError: … does not provide an export named 'statfsSync'`, and a forks
worker fails with `undefined.bind`. Under Node v24.16.0 the claimed scenario
calls none of the three on either pool (evidence O5). The calls sit behind
browser-mode GC, tinyexec `xSync` (vitest imports only `x`), vm pools and
`logHeapUsage` (evidence V1). The browser has no source for their results:
host filesystem statistics, RSS/V8 heap statistics, a synchronous child with
status, stderr and signal (evidence O4). ADR-0443 therefore makes each of
them an own member with Node's shape whose every call throws a named
`NotImplementedError`. This partially supersedes ADR-0348 §2's link-only
placeholder ban. `process.setSourceMapsEnabled` / `process.emitWarning` stay
off this item (guarded or deprecation-only; `emitWarning` belongs to
`process-module-loader-surface`).

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md)

## Acceptance

1. `import { statfsSync } from 'node:fs'`, `import { spawnSync } from 'node:child_process'` and `import { memoryUsage } from 'node:process'` link, and `process.memoryUsage.bind(process)` yields a function; carrier parity `modules/builtin-loud-members-link`, RED at BASE with the link `SyntaxError` on `statfsSync` → I6
2. Each member is an own data property of its owner object with Node's descriptor: a function, writable, enumerable, configurable, and listed in `Object.keys`. The named import and the namespace entry are that same function. `process.memoryUsage.rss` is an own function with the same descriptor. Carrier parity `modules/builtin-loud-members-link` → ADR-0443
3. A forked ESM child (the vitest forks-pool worker shape) links the three named imports, binds `process.memoryUsage` at load and exits 0 with Node's stdout; carrier parity `child_process/pool-worker-loud-members` (`child-worker`), RED at BASE with exit code 1 and the child's link `SyntaxError` → I6
4. Calling `fs.statfsSync(path)`, `child_process.spawnSync(cmd, args)` or `process.memoryUsage()` throws `NotImplementedError` with `feature` `fs.statfsSync` / `child_process.spawnSync` / `process.memoryUsage`. This holds for direct calls, the `.bind(process)` form and a fresh `NodeProcess`. `process.memoryUsage.rss()` throws with `feature` `process.memoryUsage.rss`. No call returns a value. Carrier unit `packages/runtime-js/src/builtins/loud-members.test.ts`, RED at BASE (members `undefined`) → I6, ADR-0443
5. `docs/public/compat/fs.md` (through the compat generator inventory), `docs/public/compat/process.md` and the `node:` built-ins row of `docs/public/compat/modules.md` list the three members as ❌ named `NotImplementedError` members under ADR-0443. `packages/runtime-js/CHANGELOG.md` records them → ADR-0443

## Reference contract

- Oracle: Node v24.16.0 (host, Darwin arm64) `node:fs`, `node:child_process`, `node:process` (evidence O1–O4). vitest 4.1.11 + vite 8.0.16 + tinyexec 1.3.1, installed with npm 11.17.0 (evidence V1, O5).
- Mechanism reused: builtin ESM names are the enumerable own keys of the runtime object (ADR-0348 §2, Node's own rule). A member on the owner object is the whole link fix. Every kernel realm builds its process with `new NodeProcess(spec)` (`packages/runtime-js/src/ipc/install-process.ts:73`), so a `NodeProcess` own field reaches the CLI, forks and threads realms.
- Reachability: a Node trap run of the scenario records no call on forks or threads. Controls show the same trap does record calls (evidence O5). The loud member is reachable only by an unclaimed call (I6).

## Parity cases

1. `tools/node-parity-runner/cases/modules/builtin-loud-members-link.case.ts` (`kind: 'esm'`): Node v24.16.0 prints `{"statfsSync":["function",["function",true,true,true,true],true,true],"spawnSync":["function",["function",true,true,true,true],true,true],"memoryUsage":["function",["function",true,true,true,true],true,true],"rss":["function",true,true,true,true],"bound":"function"}` (evidence O2) → I6, ADR-0443
2. `tools/node-parity-runner/cases/child_process/pool-worker-loud-members.case.ts` (`kind: 'child-worker'`, one physical Worker): Node prints `{"code":0,"signal":null,"stdout":"[\"function\",\"function\",\"function\",\"function\",true]","stderr":false}` (evidence O3) → I6

## Out of scope

- Real results: `statfsSync` statistics, `spawnSync` child execution, `memoryUsage` / `rss` numbers. The browser has no source (evidence O4); every call throws per Acceptance 4. Real `spawnSync` needs a status/stderr/signal sync-child protocol beyond the `node <script>` stdout-only `execSync` RPC, tracked in `runtime-js/node-builtins-loud-stub-capability-gaps`.
- Node members no claimed consumer links stay link-time misses under ADR-0348 §2 / ADR-0443 §2: `fs.statfs`, `fs.promises.statfs`, `child_process.execFileSync` (Node owns them, evidence O1; rifty lacks them, evidence R1).
- Argument validation ahead of the throw: Node's `statfsSync(1)` / `spawnSync(1)` throw `ERR_INVALID_ARG_TYPE`, and `memoryUsage(1)` returns an object (evidence O4). Rifty throws the named `NotImplementedError` for every call.
- Function metadata (`name`, `length`) of the loud members: not claimed.
- The no-COI same-realm child fallback's plain-object `process` (`packages/runtime-js/src/builtins/child_process-exec.ts:280`) gets no `memoryUsage`, like its other missing `NodeProcess` members. The claimed path forks through the kernel Worker route.

## Decisions

- 2026-09-23 — mechanism: ADR-0443 (named-loud member per observed link/load edge). It partially supersedes ADR-0348 §2's link-only-placeholder clause; correction note in ADR-0348 + `docs/adr/README.md` §Corrections. Under DEC-2 a fresh decision review is still owed: this depth-1 worker could not spawn one (DEC-4). The driver runs it before IMPLEMENT.
- 2026-09-23 — scope: exactly the three observed edges plus `memoryUsage.rss`, Node's own sub-member (O1). Siblings stay link-time misses (ADR-0443 §2).
- 2026-09-23 — `spawnSync` is loud, not real. The `execSync` RPC is `node <script>` stdout-only (O4), and vitest never calls `spawnSync` (V1). The map's "`--changed` (git via spawnSync)" is inaccurate: `--changed` runs git through async `x` → `spawn` (V1). The map fix belongs to the land step.
- 2026-09-23 — no `## Fault matrix`: no cache, persistence, network or concurrency behavior changes.
- 2026-09-23 — carriers: parity `esm` links against the same builtin objects and loader linker as the browser realm. `child-worker` runs the production node-entry bootstrap (`installNodeProcessShim`) that the forks and threads pool realms use. Call-time throws are a rifty ceiling (Node returns values), so a unit test carries them. Item 12's e2e proves the claimed path end to end.
- 2026-09-23 — file size: `fs.ts` is at 1647 of its 1648-line pin, so IMPLEMENT adds the loud members from a new small module — no comment deletion, no biome-ignore. `process.ts` (1133/1226) and `child_process.ts` (677) have room.
- 2026-09-23 — this title narrows the draft's "real or named-loud" to named-loud for all three (O4). The promise (members exist, loud on call, never a fabricated value) is unchanged.
