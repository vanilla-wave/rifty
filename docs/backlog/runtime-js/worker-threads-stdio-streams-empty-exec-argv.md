---
area: runtime-js
status: ready
title: "`fork` and `worker_threads.Worker` start children with Node's `-r`/`-C`/`--experimental-import-meta-resolve` startup options, and a Worker has Node's `stdout`/`stderr` streams, as vitest's pools need"
created: 2026-09-15
why: vitest 4.1.11 starts every pool child with `execArgv` `--experimental-import-meta-resolve --require <vitest>/suppress-warnings.cjs --conditions node --conditions development` through `fork` (`stdio 'pipe'`, advanced serialization) and `new Worker` (`stdout`/`stderr` true), then pipes the child's stdout; rifty's Worker throws `worker_threads.Worker.execArgv` for any own `execArgv`, has no `stdout`/`stderr` (a worker's output is lost), and `fork` drops `execArgv` silently
epic: vitest-run-in-browser
blocked_by: []
sources: [docs/backlog/runtime-js/reference/worker-threads-stdio-streams-empty-exec-argv-evidence.md, docs/adr/runtime-js/0449-carry-node-startup-options-and-worker-stdio-streams.md, docs/backlog/runtime-js/reference/vitest-run-in-browser-evidence.md, docs/backlog/runtime-js/worker-threads-inherited-exec-argv.md, docs/backlog/runtime-js/node-cli-preload-import-flags.md, docs/public/compat/modules.md]
code: [packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-worker.ts, packages/runtime-js/src/builtins/node-entry-runtime-config.ts, packages/runtime-js/src/builtins/node-entry.ts, packages/runtime-js/src/builtins/process.ts, packages/runtime-js/src/module-loader/resolver-profile.ts, packages/runtime-js/src/module-loader/esm-job-evaluation.ts, packages/workbench/src/workers/node-entry-bootstrap.ts]
---

## Context

On BASE (evidence §RED at BASE): `new Worker(file, { execArgv })` throws
`NotImplementedError('worker_threads.Worker.execArgv')` for any own `execArgv`,
even `[]` or `null`; `worker.stdout`/`stderr` are `undefined` and a worker's
`console.log` never reaches the parent (only non-Node `'stdout'`/`'stderr'`
events carry it); `fork(file, [], { execArgv })` starts the child with
`process.execArgv` `[]`, no preload and default conditions. vitest's threads
pool therefore throws at `ThreadsPoolWorker.start`, and its forks pool loses the
suppress-warnings preload and the `development` condition. Map item 11 was
re-cut on 2026-09-23 (ledger): vitest passes a non-empty `execArgv`, not `[]`.
Node's model and the carriers: ADR-0449.

## Challenge

challenge: 2026-09-15 — reuse epic vitest-run-in-browser (6 problems, resolved in goal.md; P4 both pools chosen)

## Reference contract

- Oracle: Node v24.16.0 — `lib/internal/worker.js` stdio wiring and `execArgv`
  validation (read from `process.binding('natives')`), `child_process.fork`'s
  `execArgv` and eval-pair rule, CLI parsing of `-r`/`--require`,
  `-C`/`--conditions` and `--experimental-import-meta-resolve`,
  `Module._preloadModules`, package `exports`/`imports` condition matching,
  `import.meta.resolve`. Consumer: vitest 4.1.11 `cli-api.CnMVyzaz.js`
  `ForksPoolWorker.start` (3150-3163), `ThreadsPoolWorker.start` (3228-3237),
  `resolveOptions` (3798-3811), `resolveConditions` (3812-3831), with vite
  8.0.16 (live pool `execArgv`, evidence §vitest).
- Mechanism (ADR-0449): one startup-options compiler for `fork` and `Worker`;
  node-entry v6 carries the exact tokens on program and worker-thread launches;
  the child installs one realm-scoped record (conditions for every resolution,
  the `import.meta.resolve` parent, `process.execArgv`) and runs preloads in
  runtime-js `runNodeEntry` before the entry. Worker `stdout`/`stderr` are
  Readables fed by the kernel worker's output streams and piped into the
  parent's process streams unless captured.

## Acceptance

1. The parity runner (`kind: 'worker-env'`, a physical kernel Worker running the production node-entry bootstrap) matches live Node v24.16.0 stdout and the pinned `expected` for Parity cases 1–4, and `kind: 'child-worker'` does for Parity case 5. → ADR-0449
2. vitest 4.1.11's pool launch shapes with its exact pool `execArgv` (Parity cases 6 and 7, same runner kinds) match live Node: the pool entry starts with the suppress-warnings preload applied, the `development` condition active and `import.meta.resolve` honouring its parent, and its output arrives once through `stdout.pipe(process.stdout)`. → I4, I5, I6, ADR-0449
3. In a real Chromium child realm (`tests/browser-unit/worker-stdio-exec-argv.spec.ts`), every program in `tests/browser-unit/fixtures/worker-stdio-exec-argv-cases.ts` (Parity cases 8–11, plus Parity 6 and 7 verbatim) prints the same rows and exits with the same code as a live Node run of the same sources, without timing out. → I4, I5, ADR-0449
4. Production build (`tests/e2e-prod/worker-stdio-exec-argv.spec.ts`): `node main.cjs` in the shell prints Parity case 12's rows and exits 0, as the Node artifact (evidence §Prod program). → ADR-0449
5. Every token outside the three families, a `fork` flag without its own operand, Worker `stdin: true` and the same-realm cases throw the named `NotImplementedError` of ADR-0449 §1/§2/§6 before any thread id, hold, child or spawn; Node's own Worker `execArgv` errors allocate no thread id or hold either (`packages/runtime-js/src/builtins/startup-options-ceiling.test.ts`). → ADR-0449
6. node-entry v6 carries a program or worker-thread launch's exact `execArgv` snapshot through decode, rejects tokens the compiler rejects on build and on decode, and has no v5 reader (`packages/runtime-js/src/builtins/node-entry-startup-options.test.ts`). → ADR-0449
7. `docs/public/compat/modules.md` (and `process.md` where it lists child and Worker options) states ✅ Worker `stdout`/`stderr` and `fork`/`Worker` `-r`/`-C`/`--experimental-import-meta-resolve` with Node's inheritance; ❌ every other startup flag, a `fork` flag without its own operand, Worker `stdin: true` and the same-realm cases (named throws), and a failing Worker preload's missing `'error'` (the existing kernel-path `'error'` row); ⚠️ unclaimed stdout-vs-`'message'` order and the read-stream hold of an `unref()`'d Worker. → ADR-0449

## Parity cases

Sources: `tools/node-parity-runner/cases/worker_threads/{stdio-streams,stdio-exit-order,exec-argv-startup,exec-argv-validation,vitest-pool-shape}.case.ts`, `tools/node-parity-runner/cases/child_process/{fork-exec-argv,vitest-pool-shape}.case.ts` (shared files: `cases/process/startup-options-program.ts`), `tests/browser-unit/fixtures/worker-stdio-exec-argv-cases.ts`, `tests/e2e-prod/worker-stdio-exec-argv.spec.ts`. Node rows: evidence §Parity cases and §Browser-unit and prod programs.

1. `worker_threads/stdio-streams`: a default Worker has Readable `stdout`/`stderr`, `stdin` `null` and stable stream identity; its `console.log` and `process.stdout.write` reach the parent's stdout before the parent's `'exit'` row; with `stdout: true, stderr: true` the output is captured on the streams only; a captured stream nobody reads delays nothing (`'exit'` 0). Node rows: `default true true null true` … `unread-exit 0` (7 rows). → ADR-0449
2. `worker_threads/stdio-exit-order`: 1000 lines then `process.exit(3)` all arrive before `'exit'` 3, `readableEnded` is false in `'exit'`, `'end'` follows it and `readableEnded` is true a tick later; `terminate()` after three periodic chunks gives `'exit'` 1, then `'end'`, and resolves 1. Node rows: `burst exit 3 lines=1000 ended=false | end lines=1000 | tick ended=true`, `terminate exit 1 | end | chunks>=3=true | resolved=1`. → ADR-0449
3. `worker_threads/exec-argv-startup`: an explicit `execArgv` (`[]`, `--require`, `-r … -C custom`, two ordered preloads, `=` spellings with the flag in an ESM worker, `--conditions node --conditions development`, `[]` in an ESM worker) is the worker's exact `process.execArgv`; preloads run in order before the entry, from the cwd, with `require.main` unset and the conditions active; the conditions select `exports`/`imports` targets for require, `require.resolve`, static and dynamic import and `import.meta.resolve`; the flag makes `import.meta.resolve` honour a string or URL parent (an unparsable one is `TypeError:ERR_UNSUPPORTED_RESOLVE_REQUEST`), which is ignored without the flag; `null` and an omitted `execArgv` inherit the parent thread's options, which a token pushed into the public `process.execArgv` does not change. Node rows: 9 rows, `empty exit 0 …` … `inherit-mutated exit 0 …`. → ADR-0449
4. `worker_threads/exec-argv-validation`: `'str'` and `{}` throw `TypeError ERR_INVALID_ARG_TYPE` with Node's text; `['--require']`, `['-C','-r','./pre.cjs']`, `['--conditions','-']`, `['--conditions=']` and `['--require=','x']` throw `Error ERR_WORKER_INVALID_EXEC_ARGV … requires an argument` from the constructor; a missing preload ends the worker with exit code 1. Node rows: 8 rows. → ADR-0449
5. `child_process/fork-exec-argv`: an explicit `execArgv` (`[]`, `--require`, `-r … -C custom`, two preloads from the child's `cwd: 'sub'`, `=` spellings with the flag in an ESM child) is the child's exact `process.execArgv`, with preloads, conditions and the `import.meta.resolve` parent as in Parity 3; a missing preload exits 1 with `Error: Cannot find module './missing.cjs'` on the child's stderr; without `execArgv` the child gets the parent's public `process.execArgv` at the call, a pushed token included. Node rows: 8 rows, `empty exit 0 …` … `default-mutated exit 0 {"execArgv":["--conditions=custom"],…}`. → ADR-0449
6. `worker_threads/vitest-pool-shape`: vitest's threads start with its pool `execArgv` and `stdout: true, stderr: true`, piped into `process.stdout` and unpiped after `'exit'`. Node rows: `pool execArgv [...the four flags with <abs>/suppress-warnings.cjs]`, `pool cpkg dev meta sub/a.mjs`, `pool warnings ["other warning"]`, `thread exit 0; parent stdout still writable`. → I5, I6, ADR-0449
7. `child_process/vitest-pool-shape`: vitest's forks, `fork(entry, [], { env, execArgv, stdio: 'pipe', serialization: 'advanced' })` with `child.stdout.pipe(process.stdout)`. Node rows: the three `pool …` rows of Parity 6, `fork exit 0; parent stdout still writable`. → I4, I6, ADR-0449
8. browser-unit `worker-default-stdout`: a default Worker's `console.log` and `process.stdout.write` reach the terminal before the parent's `'exit'` row. Node rows: `SX|from-worker console.log`, `SX|from-worker stdout.write`, `SX|exit 0`. → ADR-0449
9. browser-unit `nested-worker-inherit`: a Worker started with `['--require','./pre.cjs','-C','custom']` pushes `--conditions=other` into its public `process.execArgv`, then starts a default inner Worker, which inherits the outer's original options (preload ran, `custom` selected). Node rows: `SX|inner {"execArgv":["--require","./pre.cjs","-C","custom"],"pre":["pre"],…}`, `SX|outer exit 0`. → ADR-0449
10. browser-unit `nested-fork-inherit`: a fork started with the same `execArgv` forks a default inner child, which inherits them. Node rows as Parity 9. → ADR-0449
11. browser-unit `eval-parent-fork`: a `node -e` parent forks `./fprint.cjs` without `execArgv`, then with `{ execArgv: process.execArgv }` (the same array); both drop the eval pair. Node rows: `SX|eval default child []`, `SX|eval explicit child []`. → ADR-0449
12. prod `node main.cjs`: `SP|worker default out`, `SP|captured true "SP|worker default out\n"`, `SP|worker --require ./pre.cjs -C custom,pre,custom`, `SP|fork --require ./pre.cjs -C custom,pre,custom`, `SP|done 0`; exit 0. → ADR-0449

## Fault matrix

| axis × operation | honest outcome | artifact / fault target | trace |
|---|---|---|---|
| `observable-order` × a worker's output vs its `'exit'` (a burst, then `process.exit(n)`) | every chunk is on the stream before `'exit'`; the stream ends after it | Parity 2 (`burst`) | → ADR-0449 |
| `observable-order` × default auto-pipe vs the parent's `'exit'` listener | the worker's output is on the parent's stdout before the parent's `'exit'` row | Parity 1, Parity 8, Parity 12 | → ADR-0449 |
| peer death (fault-classes §Boundary: dedicated Worker) × `terminate()` mid-output | `'exit'` 1 then `'end'`; resolves 1; never a hang or a stream left open | Parity 2 (`terminate`) | → ADR-0449 |
| `unbounded-read` × a captured stream nobody reads | buffers as in Node, holds nothing; `'exit'` fires and the program ends | Parity 1 (`unread`) | → ADR-0449 |
| `torn-state` × an invalid or unsupported startup option on `Worker`/`fork` | throws before a thread id, hold, child or spawn exists; nothing half-started | Parity 4; `startup-options-ceiling.test.ts` (spawn spies, keepalive refs, next thread id 1) | → ADR-0449 |
| `corrupt-input` × a launch's `execArgv` at node-entry decode | a token the compiler rejects, a non-string, a non-array or a v5 envelope is a protocol error, never a child started with other options | `node-entry-startup-options.test.ts` | → ADR-0449 |
| `provenance-lie` × `fork`/`Worker` default inheritance | Worker: the parent thread's original options (public mutation ignored); fork: the public array at the call minus the eval pair when the effective array is that array itself; an inherited token rifty cannot carry is the named throw, never dropped | Parity 3 (`inherit-mutated`), Parity 5 (`default-mutated`), Parity 9–11, ceiling test `names an inherited parent flag it cannot carry` | → ADR-0449 |
| `sibling-drift` × launch producers (`fork`, `Worker`) and child owners (Workbench bootstrap, parity adapter program path) | one compiler; preloads and conditions live in runtime-js `runNodeEntry`, shared by both owners | Parity 3 and 5 (production worker-thread bootstrap, adapter program path), Parity 9–12 (Workbench bootstrap) | → ADR-0449 |

## Out of scope

- Every other `execArgv` token on `fork`/`Worker` (`--import`, `--no-warnings`, `--experimental-vm-modules` for vitest's `vmThreads`/`vmForks`, `--inspect`, `--enable-source-maps`, `-e`/`-p`, `-r=x`, non-strings): `NotImplementedError('worker_threads.Worker.execArgv' | 'child_process.fork.execArgv')` naming the token; compat ❌.
- A `fork` flag without its own operand: `NotImplementedError('child_process.fork.execArgv')` naming the flag; compat ❌. Node (evidence §fork operands): fork appends the module path after `execArgv`, so a trailing flag takes it as its operand (`--require`/`-r`: the module runs as a preload; `--conditions`/`-C`: it is a condition) and the child, with no entry, runs the program it reads from stdin (exit 0 once stdin ends); a `-`-leading operand or an empty `=` value is the child's usage error, exit 9 (`<flag> requires an argument`).
- A Worker inheriting an eval parent's options (`node -e "new Worker(…)"`): the `worker_threads.Worker.execArgv` throw is unchanged — draft `runtime-js/worker-threads-inherited-exec-argv`.
- Terminal `node -r/--require/--import … <file>` stays `workbench.node.preload-context` — draft `runtime-js/node-cli-preload-import-flags`. `spawn('node', [flags…, file])` is unchanged (discovery: the flags are read as the entry path, evidence §Discoveries).
- Worker `stdin: true`: `NotImplementedError('worker_threads.Worker.stdin')`; compat ❌.
- Same-realm fallbacks: a non-empty effective `execArgv` throws `NotImplementedError('worker_threads.Worker.execArgv.same-realm' | 'child_process.fork.execArgv.same-realm')`; `stdout: true`, `stderr: true` and reading a same-realm Worker's streams throw `NotImplementedError('worker_threads.Worker.stdio.same-realm')`; compat ⚠️.
- A failing Worker preload: Node emits `'error'`, then `'exit'` 1; rifty emits `'exit'` 1 only — existing gap `runtime-js/worker-threads-kernel-error-event` (compat ❌).
- The order between a worker's stdout chunks and its `'message'` events (Node varies, evidence s4) and the port hold of an `unref()`'d Worker whose `stdout: true` stream is read (evidence s5): compat ⚠️, not claimed.
- `process._eval` is not exposed; `fork` locates the eval pair with the launch's own source.

## Decisions

ready-verdict: 2026-09-24 — Contract+RED @ 7a15b735446a35eb5a71fa7d2506b6357fa11d7c
- 2026-09-25 — carrier: ADR-0449 (one compiler; node-entry v5 → v6 with an optional exact `execArgv` on program and worker-thread launches; one realm-scoped startup record; preloads in `runNodeEntry`; Worker-owned stdio Readables). It corrects ADR-0448's active v5 version with a dated note. Rejected: per-loader conditions, #349's entry-relative preload wrapper and vitest-shaped allowlist, env-carried tokens, and exposing the kernel handle's Readables (ADR-0449 §Rejected).
- 2026-09-25 — scope: re-cut per map item 11 (vitest passes a non-empty `execArgv` to both pools). The title now names the three flag families and the stdio streams instead of an explicit empty `execArgv`. Node's default inheritance on both launchers is included, because honouring explicit options without it would silently change nested children (Parity 9–11). Overlap: `worker-threads-inherited-exec-argv` keeps only eval-parent inheritance; `node-cli-preload-import-flags` keeps the terminal CLI.
- 2026-09-25 — criteria (`PR-4`), migrated at IMPLEMENT: `worker_threads.test.ts` "rejects an explicit execArgv override" (`execArgv: []` throws) and "publishes trusted stdout and stderr" (non-Node `'stdout'`/`'stderr'` events) follow Node (Parity 1 and 3); `env-semantics.case.ts` swaps its `worker.once('stderr')` failure detector for `worker.stderr`.
- 2026-09-25 — carriers: nested inheritance runs in browser-unit, since the parity runner has one physical level. Parity cases 3, 4 and 6 fail today on the physical-Worker count because construction throws; their rows at BASE are in evidence §RED at BASE. The five decode-rejection rows of `node-entry-startup-options.test.ts` already pass at BASE (v5 has no field) and guard a permissive v6.
- 2026-09-25 — Contract+RED r1 reception (`REV-12`): blocker (false Node fact for `fork` operand errors) FIX; concerns taken: thread-id/hold assertions, a `-`-leading `fork` operand row, one compat marking for the preload `'error'`, Node's eval-pair identity rule, the node-entry v5 literal migrations below; file-size is an IMPLEMENT note; the §Discoveries route at land.
- re-cut: 2026-09-25 — Out of scope `fork` operand row corrected to Node's behavior (a trailing flag takes fork's module path; only a `-`-leading or empty `=` operand exits 9); Acceptance 5/7, Parity 11 and the fault rows aligned (thread-id/hold carriers, preload `'error'` ❌, eval-pair identity); no row dropped — trace: none
- 2026-09-25 — criteria (`PR-4`), migrated at IMPLEMENT by ADR-0449 §4 (v5 → v6, no v5 reader): `node-entry-runtime-config.test.ts` (the v5 protocol pin, its v5 envelope and `/protocol.*v5/` rejection), the eight v5 envelopes in `packages/workbench/src/workers/workbench-project-runtime.test.ts`, the parity harness fault envelope `tools/node-parity-runner/src/run-in-rifty.ts` `corruptNodeCliEvalEntry` (oracle machinery: only its version literal changes) and the `types.ts` comment.
- 2026-09-25 — Contract+RED r2 reception (`REV-12`): eval-pair identity carrier TAKEN (ceiling row `names a copy of an eval parent's execArgv`; an identity-less strip fails it); file-size TAKEN (stdio, launch options and the compiler are new modules); the TTY-stdin REPL wording NOT TAKEN (rifty names that `fork` case, no carrier reads the wording); §Discoveries route at land.
- 2026-09-25 — IMPLEMENT (`REV-12`): the prod carrier hung after `SP|done 0` — in a production realm every default-stdio `fork` held its parent, because the inherited-stdin hook key was an unregistered `Symbol` read across runtime-js bundle copies; Acceptance 4 needs it, so fixed here (`Symbol.for`), regression row in `child_process-inherit-stdin.test.ts`.
- 2026-09-25 — IMPLEMENT: `fork`'s default reads the realm's `node:process` (`builtins/process-public.ts`, now also the builtin's factory), not a raw `globalThis.process`; `import.meta.resolve` package resolution from a non-`file:` parent is a named gap (ADR-0449 §Explicit gaps).
- 2026-09-25 — criteria (`PR-4`), same ADR-0449 §4 migration found at IMPLEMENT: `tools/node-parity-runner/src/run-in-rifty.test.ts` wrong-protocol fault expects the active version in the mismatch text (`/protocol.*v5.*v2/` → `v6`); the pinned `typescript-worker.js` sha re-pinned (bytes unchanged) after the runtime-js rebuild.
