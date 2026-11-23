# isolate-host sandbox — the lifecycle class, measured (2026-11-23)

Each `runCode` lifecycle/status row of `docs/public/compat/isolate-host.md` as one
`node p.js` program, run once in a sandbox (`exec('p.js', { timeoutMs: 3000, memoryLimitMb: 128 })`),
once as `runCode(code)` with the same limits (`node -e`; its files are not observable) and once
by live `node p.js` in a temp dir (Node v24.16.0, darwin-arm64). Files: what the state or the
directory holds besides `p.js`; every program but the `unref()` one writes `a` first. Two runs
each; the differences between runs are noted.

Command (repo root, after `pnpm --filter @riftydev/isolate-host build`):
`node docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class-probe.mjs`

## After PR #424 (the guest's run phase gates `fire`)

| case | sandbox: exit / end, files | `runCode`: exit / end | Node: exit, files | sandbox outcome |
|---|---|---|---|---|
| uncopyable rejection reason | 1, a | 1 | 1, a | as Node |
| unref() timer | 0, tick1,tick2 | 0 | 0, — | extra files kept |
| GC-lost rejection | 0, a | 0 | 1, a | exit code not Node's |
| work queued at exit() | 3, a,late | 3 | 3, a | extra files kept |
| exit() then endless queued work | timeout, — | timeout | 3, a | whole run rolled back |
| exit() then queued work eating the heap | memory, — | memory | 3, a | whole run rolled back |
| exit listener work at a natural exit | 0, a,hop1,hop2 | 0 | 0, a,hop1,hop2 | as Node |
| exit listener sets exitCode in a microtask | 0, a | 0 | 4, a | exit code not Node's |
| unhandled rejection with a timer pending | 0, a,t | 0 | 1, a | extra files kept; exit code not Node's |
| intrinsic replaced (Reflect.get) | 1, a | 1 | 0, a | exit code not Node's |
| exit signal caught and mutated | 0, a | 0 | 3, a | exit code not Node's |
| work queued at an uncaught throw, exit(0) in a timer | 1, a | 1 | 1, a | as Node |
| work queued at an uncaught throw, exit(0) in a microtask | 0, a,q | 0 | 1, a | extra files kept; exit code not Node's |
| work queued at an uncaught throw, exit(0) in an fs callback | 0, a,q,z | 0 | 1, a,z | extra files kept; exit code not Node's |
| a timer due beside a fatal thrown from a timer, exit(0) in it | 1, a,q | 0 | 1, a | extra files kept |
| an endless timer due beside a fatal thrown from a timer | timeout, — | timeout | 1, a | whole run rolled back |
| an interval queued before an uncaught throw | 1, a | 1 | 1, a | as Node |
| setImmediate queued before an uncaught throw | 1, a | 1 | 1, a | as Node |
| uncaught throw then an endless queued timer | 1, a | 1 | 1, a | as Node |
| uncaught throw + endless microtask chain | memory, — | memory | 1, a | whole run rolled back |
| exitCode in an exit listener after an uncaught throw | 1, a | 1 | 5, a | exit code not Node's |
| throw in an exit listener | 1, a | 1 | 3, a | exit code not Node's |
| rejection in an exit listener | 0, a | 0 | 1, a | exit code not Node's |

Every divergence is at a place `runCode` diverges too; the sandbox's status is `runCode`'s on every
row but one — a timer due beside a fatal thrown from another timer: `runCode` takes its `exit(0)`
(0), the sandbox keeps the fatal's 1 (Node's; the terminal is already recorded) and its file.

## Before PR #424 (main `f3861a3cd`)

Two rows were the sandbox's own: a timer queued before an uncaught throw fired after the guest's
run had ended (the host timer was in flight when the result was) — `runCode` disposed the isolate
at the result, so nothing of it was seen, while a sandbox captured its state after the run and
waited for the callback. A finite such timer left its file (`a,q` where Node has `a`), an endless
one ended the run `timeout` with every write rolled back (Node and `runCode`: exit 1). The 0 ms
timer beside `exit()` left its file in some runs.

Not in this class: the pool rows (a lost worker, a starved deadline, an adaptive culprit) end the
run killed or lost — the sandbox row "Killed run … or lost worker" (rolled back); `import()` has its
own sandbox rows.
