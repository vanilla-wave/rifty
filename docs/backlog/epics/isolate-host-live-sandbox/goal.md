---
kind: epic
status: draft
title: Isolate host live sandbox — host file ops and `node <path>` runs over one sandbox through an agent's fix loop
created: 2026-11-22
value: A Node service gives one agent run one sandbox: it writes files, runs `node <path>` as often as the model needs, and reads the bytes the guest produced (a PDF) straight from the sandbox, with every ending of a run — exit, throw, endless loop, eaten memory, lost worker — leaving the files in place.
user_story: As a Node service executing model-written code, I want a sandbox that lives through write → run → error → fix → run and hands me the binary files it made, but today `runCode(code)` only runs one string in a fresh isolate with no files kept between calls
tier: robust
---

## Outcome

`@riftydev/isolate-host` gains a sandbox: created on demand, it lives until
the consumer destroys it, through any number of runs. The host writes, reads,
lists and removes its files — bytes exact, binary included, paths and sizes
checked by the host. The host runs a guest file as `node <path> [args]` and
gets `{stdout, stderr, exitCode, termination?, truncated?}`, the shape and
limits of `runCode`. Each run is a fresh Node process as far as the guest can
tell: only files carry over. No ending of a run loses the sandbox: a model's
endless loop or eaten memory is an ordinary error the next run can fix. The
files stay rifty's in-memory filesystem in the guest's own realm; between
operations the sandbox is bytes held by the consumer, and only bytes and plain
data cross the isolate boundary. `snapshot()` hands the host those bytes at a
point of rest, and a new sandbox created from them sees the same files.
`destroy()` leaves nothing of the sandbox. The
API is plain data and bytes, so it can move behind an RPC later without
rewriting the agent. `runCode` does not change. Consumer documentation says
how to connect, the API, limits and what is not there.

## User scenario

1. The agent's host creates a sandbox and writes `/workspace/main.js` (the
   model's code) and an input file with binary bytes.
2. It runs `exec('main.js')`. The code has a bug: the result is exit 1 with
   the error on stderr, as `node main.js` reports it in a directory holding
   the same files.
3. The model fixes the file; the host writes it; `exec('main.js', {args})`
   now writes `out.pdf` (binary) at a path the model chose and exits 0. The
   host reads `out.pdf`: the bytes real `node main.js` writes from the same
   files.
4. Another fix introduces an endless loop, then a memory blow-up: the runs
   end `termination: 'timeout'` and `'memory'`; the sandbox and its files are
   still there; the next fix runs clean.
5. Between runs nothing but files carries over: globals, module cache,
   timers, `process.exitCode`, listeners and the cwd of one run are not seen
   by the next — as with consecutive `node main.js` processes.
6. Writes of the host and runs of the guest on one sandbox, issued without
   waiting for each other, take effect one at a time in call order.
7. The host destroys the sandbox, also in the middle of a run: the run and
   anything still pending reject with a distinct code, and nothing of the
   sandbox remains.
8. A model-chosen path or size the host refuses (a file over the per-file
   limit, an invalid path) is a loud Node-shaped error that names only
   sandbox paths; the guest of one sandbox cannot see another sandbox's
   files.
9. Before destroying, the host takes `snapshot()`; a sandbox created later
   from those bytes runs `main.js` and sees the same files.
10. The service owner reads the package README: how to connect, the API, the
   limits, what is not there.

## Invariants

<!-- False on main 50c9d8bf1: the package root exports only `runCode`
(`parity.test.ts` "runCode is the package root's only runtime export"); no
sandbox, no host file op, no `node <path>` entry in the guest bundle
(`GuestEntry` has `run(code)` only, `packages/isolate-guest/src/contract.ts`);
each `runCode` starts on an empty MemoryFs (`isolation.test.ts`). Every
invariant below quantifies over a sandbox, which main does not have: the
acceptance carrier's first call is `createSandbox()` and fails there (RED run
2026-11-22, `sandbox-acceptance.test.ts`, all cases `it.fails`). Premise
probes: `docs/backlog/distribution/reference/isolate-host-sandbox-step0.md`. -->

- I1. No ending of a run loses the sandbox. A run that ends on its own —
  exit 0 or N, `process.exit`, an uncaught throw or rejection — leaves
  exactly the files it had at its end. A run that is killed (`timeout`,
  `memory`) or rejects (its worker lost) leaves exactly the files of before
  it: whole-run rollback, never a partial state (Node would keep the partial
  writes: declared, compat ⚠️). The host and the next run see that state.
  A run whose end state cannot be captured or restored (too large for its
  isolate or the bound, a guest that broke its own snapshot) is a named, loud
  result, neither a lost worker nor `memory`/`timeout` blamed on the guest,
  and leaves the state of before it. Under this model a sandbox is lost only
  with its consumer process (the requirements' rollback to the last saved
  archive).
- I2. `node <path>` fidelity in sequences: a sequence of `exec(path, {args})`
  over one sandbox gives, run by run, the stdout, stderr, exit code and files
  of the same sequence of `node <path> [args]` processes over the same files in
  a temporary directory (its path read as `/workspace`): relative `require`,
  JSON, `__filename`, `__dirname`, `process.argv`, `require.main`, relative
  paths, uncaught errors with file-path frames, a syntax error in the entry
  and in a dependency. Only files carry from one run to the next. A
  divergence is loud (`NotImplementedError` + compat row) or, for the text of
  a diagnostic only, a pinned ⚠️ row owned by the runtime-js diagnostics goal;
  a run never silently does something else (exit 0 where Node does work).
- I3. Host file ops are exact: `writeFile`/`readFile`/`list`/`remove` move
  bytes unchanged (binary, empty, large up to the limit), see exactly what
  the guest's runs left and are seen by the next run.
- I4. One operation at a time: operations on one sandbox issued without
  awaiting each other take effect one at a time in call order.
- I5. End of life is loud and total: once `destroy()` resolves, no isolate of
  the sandbox runs and its state is unreachable; every operation in flight,
  queued or later rejects `ERR_ISOLATE_HOST_SANDBOX_DESTROYED`.
- I6. Bounded: each run has `runCode`'s limits (time, isolate memory, output
  cap; whether restore and snapshot count against `timeoutMs` is stated); a
  sandbox's files are bounded by a per-sandbox cap that guest writes hit as a
  full disk at the write and host writes as a rejection, sized so that a state
  within it can always be restored and captured; each host file op is bounded
  by a per-file limit; the consumer process survives every outcome; an idle
  sandbox holds no process and no isolate, its memory in the consumer is
  measured and documented (the number of live sandboxes is the consumer's to
  cap), and a sandbox the consumer drops leaves nothing behind.
- I7. Trust boundary, decided on the host side: model-chosen paths and bytes
  of host file ops stay inside the sandbox's own files; bytes a run hands back
  are hostile input to the consumer and are validated before they become the
  sandbox's state; a guest of one sandbox cannot read or write another
  sandbox's files (canary); an error reaching the host names only sandbox
  paths and carries no host text; the guest cannot make its run read as an
  infrastructure failure; bytes cross the bridge as their view's range only.
- I8. Plain-data API, documented: every argument and result of the sandbox
  API is a string, number, boolean, plain object/array or `Uint8Array`; the
  package README documents connection, the API, limits and gaps; compat rows
  name every gap.
- I9. Snapshot round trip: `snapshot()` taken with no run in flight
  returns bytes (the snapshot goal's format) holding exactly the sandbox's
  files; `createSandbox({ snapshot })` from them gives a sandbox whose host
  ops and runs see the same files; it waits its turn behind earlier
  operations (I4) and never captures a run's partial state.

## Challenge

challenge: 2026-11-22 — 6 problems (fresh critic over the requirements, the manager's hand-off and decisions, goal, map, carrier, step 0, ADR-0568 draft, ADR-0567 draft; verified, dispositions below)

1. The state model is a user fork the manager carries; nothing recorded it — recorded as `owner: user` in map `## Open questions` with the user's own words (restore once per agent run) and the template-scale cost; the default runs on the manager's delegation (pool-goal precedent), "reversible" dropped from the claim that settles it; I1 states that a sandbox is lost only with its consumer.
2. An ending only this model has — the end state cannot be captured or restored — was missing: added to I1 (named loud result, state of before), the cap made a rule in I6, `timeoutMs` coverage of restore/snapshot to be stated.
3. Live-sandbox count and the consumer-side footprint were unanswered: I6 names a per-sandbox cap, a measured consumer footprint per idle sandbox, the count as the consumer's.
4. Template-scale cost was marked open though ADR-0567 measured it: numbers in ADR-0568 §Alternatives and in the user fork.
5. The host-disk rejection leaned on «Владелец ФС живёт в том же realm» (whose stated reason is SAB): it now rests on «харденинг нужен только на внешнем шве: выставленные хостовые функции…»; host ops run on rifty's own `MemoryFsSync` («никакой второй независимой реализации»).
6. «`runCode` is unchanged» was true on main: moved from the invariants to a must-not-change decision line.

## Decisions

- 2026-11-22 — user (requirements `2026-11-17-rifty-isolate-requirements.md` §API исполнения, §Жизненный цикл, via the manager thread `4056a9e7`): host file ops read/list/write/change without binary loss; `exec` narrowly `node <path>`; one instance through write → exec → error → fix → exec; binary result read by the host straight from the sandbox at a model-chosen path, the host checking path and size; realm-level destroy; consumer docs. Acceptance: «агент пишет JS, видит результат, сам исправляет ошибку». The form `create/files/exec/snapshot/destroy` is a proposal; the API is the ADR's.
- 2026-11-22 — manager (hand-off): the library template, Web API shims, npm publication, the `process.exit()`-from-microtask fix and the suite flake are outside this goal; the API keeps a place for `snapshot` and creation from a snapshot without implementing them.
- 2026-11-22 — manager (packaging): the snapshot goal (thread `isolate-host-fs-snapshot`, branch `t3/isolate-host-fs-snapshot`) owns the format and the codec in both realms and merges first; this goal builds on its branch once its seam is stable (sha from the manager), writes no codec and ships no stand-in for it. Moved here: the sandbox's `snapshot()`, creation from a snapshot, the point-of-rest rule and the end-to-end acceptance «write → run → snapshot → destroy → create from snapshot → the run sees the files» (I9). Merge order: codec, this goal; `require.main` arrives from the runtime-js thread.
- 2026-11-22 — manager (user delegated): a killed run's result stays `exitCode: null` + `termination` (ADR-0557 dated line 2026-11-22); `exec` returns `runCode`'s shape for the same outcomes.
- 2026-11-22 — manager default (reversible; the manager brings the fork to the user, whose recorded decisions it upholds — requirements §Решения «Владелец ФС живёт в том же realm, что и гость (внутри isolate)», «харденинг нужен только на внешнем шве»): rifty's filesystem stays in the guest's realm inside the isolate; only bytes and plain data cross the boundary. Under it the sandbox between operations is bytes in the consumer; a run is a stateless pool call: fresh isolate, filesystem restored from the bytes, `node <path>`, filesystem back to bytes, which replace the state. The FS codec is the snapshot goal's; no second codec.
- 2026-11-22 — the step-0 alternative "a directory on the host disk" (it would keep a killed run's partial writes and cost nothing per run at template scale) is not built: under it every guest `fs` call becomes an exposed host function behind a jail of our own over `node:fs` (links, name normalization, OS stat values and error texts with host paths, quota as disk accounting) — against requirements §Решения «харденинг нужен только на внешнем шве: выставленные хостовые функции…» — and the guest's fs leaves rifty's VFS. Both models, with their costs, go to the ADR's critic and to the user's fork (map `## Open questions`).
- 2026-11-22 — manager: the cut is accepted — Node-faithful diagnostics of `node file.js` (positions +2, `file:line` header with caret, footer, `SyntaxError` for `ModuleLoadError`, the `Cannot find module` header) is a separate runtime-js goal in a parallel thread; their text gaps are pinned ⚠️ here citing it. `require.main === module` false is behavior, not diagnostics: this goal stays `draft` until its corpus row is green against real Node (fixed by the neighbour thread), and the same holds for anything found in the class "a run silently does something else". ESM entries are a loud `NotImplementedError` (agreed).
- 2026-11-22 — must not change (regression guard, not an invariant: true on main): `runCode`'s API, results, corpus parity and pool behavior (ADR-0557, ADR-0563, ADR-0566); its suite stays green unmodified.
- 2026-11-22 — host file ops in the consumer run on rifty's own VFS (`MemoryFsSync` over the decoded state), not a second tree with hand-made errors (requirements §Решения «никакой второй независимой реализации»).
- 2026-11-22 — tier: robust — the value is fault behavior over persistent state (every ending of a run × the state, concurrency, destroy, worker loss): each reachable axis × operation gets an honest outcome and a fault test.
- rejected route: files in a long-lived isolate or a per-sandbox worker (in-memory VFS kept alive between runs) — violates I1: a heap-limit or catastrophic disposal takes the files; `new Array(2 ** 28).fill(0)` is V8's catastrophic OOM and an ICU flood keeps the worker above its ceiling after its isolate is gone (step 0 S1).
- rejected route: build `runCode` on the sandbox — no consumer need, and it adds a state round trip to every `runCode` call (I8 keeps `runCode` as on main).
