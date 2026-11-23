# isolate-host sandbox — the lifecycle class, measured (2026-11-23)

Each `runCode` lifecycle/status row of `docs/public/compat/isolate-host.md` as one
`node p.js` program, run once in a sandbox (`exec('p.js', { timeoutMs: 3000, memoryLimitMb: 128 })`),
once as `runCode(code)` with the same limits (`node -e`; its files are not observable) and once
by live `node p.js` in a temp dir (Node v24.16.0, darwin-arm64, main `f3861a3cd` product).
Files: what the state or the directory holds besides `p.js`; every program but the `unref()`
one writes `a` first. Two runs; the only difference between them is noted.

Command (repo root, after `pnpm --filter @riftydev/isolate-host build`):
`node docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class-probe.mjs`

| case | sandbox: exit / end, files | `runCode`: exit / end | Node: exit, files | sandbox outcome |
|---|---|---|---|---|
| uncopyable rejection reason | 1, a | 1 | 1, a | as Node |
| unref() timer | 0, tick1,tick2,tick3 (2nd run: tick1,tick2) | 0 | 0, — | extra files kept |
| GC-lost rejection | 0, a | 0 | 1, a | exit code not Node's |
| work queued at exit() | 3, a,late | 3 | 3, a | extra files kept |
| exit() then endless queued work | timeout, — | timeout | 3, a | whole run rolled back |
| exit() then queued work eating the heap | memory, — | memory | 3, a | whole run rolled back |
| exit listener work at a natural exit | 0, a,hop1,hop2 | 0 | 0, a,hop1,hop2 | as Node |
| exit listener sets exitCode in a microtask | 0, a | 0 | 4, a | exit code not Node's |
| unhandled rejection with a timer pending | 0, a,t | 0 | 1, a | extra files kept; exit code not Node's |
| intrinsic replaced (Reflect.get) | 1, a | 1 | 0, a | exit code not Node's |
| exit signal caught and mutated | 0, a | 0 | 3, a | exit code not Node's |
| work queued at an uncaught throw, exit(0) in a timer | 1, a,q | 1 | 1, a | extra files kept — **sandbox only** |
| work queued at an uncaught throw, exit(0) in a microtask | 0, a,q | 0 | 1, a | extra files kept; exit code not Node's |
| work queued at an uncaught throw, exit(0) in an fs callback | 0, a,q,z | 0 | 1, a,z | extra files kept; exit code not Node's |
| uncaught throw then an endless queued timer | timeout, — | 1 | 1, a | whole run rolled back — **sandbox only** |
| uncaught throw + endless microtask chain | memory, — | memory | 1, a | whole run rolled back |
| exitCode in an exit listener after an uncaught throw | 1, a | 1 | 5, a | exit code not Node's |
| throw in an exit listener | 1, a | 1 | 3, a | exit code not Node's |
| rejection in an exit listener | 0, a | 0 | 1, a | exit code not Node's |

**Sandbox only** (not inherited from `runCode`): a timer queued before an uncaught throw runs in
`node <path>` and not in `node -e` — `setTimeout(() => console.log('ran'), 0); throw new Error('x')`:
`runCode` exit 1, stdout empty (as Node); the sandbox exit 1, stdout `ran`. A finite such timer
leaves its files, an endless one ends the run `timeout` (writes rolled back) where `runCode` and
Node exit 1. Every other row: the sandbox's status is `runCode`'s.

Not in this class: the pool rows (a lost worker, a starved deadline, an adaptive culprit) end
the run killed or lost — the sandbox row "Killed run … or lost worker" (rolled back); `import()` has
its own sandbox rows. The 0 ms timer queued beside `exit()` ran in one of the two runs of "work queued
at exit()" in an earlier measurement of the same day: its file is kept only sometimes.
