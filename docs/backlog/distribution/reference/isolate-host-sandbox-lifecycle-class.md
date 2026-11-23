# isolate-host sandbox — the lifecycle class, measured (2026-11-23)

Each `runCode` lifecycle/status row of `docs/public/compat/isolate-host.md` as one
`node p.js` program, run once in a sandbox (`exec('p.js', { timeoutMs: 3000, memoryLimitMb: 128 })`),
once as `runCode(code)` with the same limits (`node -e`; its files are not observable) and once
by live `node p.js` in a temp dir (Node v24.16.0, darwin-arm64). Files: what the state or the
directory holds besides `p.js`; every program but the `unref()` one writes `a` first. Two runs
each; the differences between runs are noted.

Command (repo root, after `pnpm --filter @riftydev/isolate-host build`):
`node docs/backlog/distribution/reference/isolate-host-sandbox-lifecycle-class-probe.mjs`

## After PR #424 (one gate on the guest's run phase for every host delivery: `fire`, `rejection`)

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
| exit(2) from a promise callback, a timer already due | 2, a,t | 2 | 2, a | extra files kept |
| exit(2) from a promise callback, an endless timer already due | timeout, — | timeout | 2, a | whole run rolled back |
| an unhandledRejection listener after an uncaught throw | 1, a | 1 | 1, a | as Node |
| an unhandledRejection listener for a rejection inside an exit listener | 0, a | 0 | 0, a,l | files Node writes missing |
| a due timer an 'exit' listener arms at a natural exit | 0, a | 0 | 0, a | as Node |
| beforeExit listener | 0, a | 0 | 0, a,be | files Node writes missing |
| exit(2) from nextTick, a timer already due | 2, a,t | 2 | 2, a | extra files kept |
| exit(2) from setImmediate, a timer already due | 2, a,t | 2 | 2, a,t | as Node |
| exit(2) from a timer, another timer already due | 2, a,t | 2 | 2, a | extra files kept |
| uncaught throw then an endless queued timer | 1, a | 1 | 1, a | as Node |
| uncaught throw + endless microtask chain | memory, — | memory | 1, a | whole run rolled back |
| exitCode in an exit listener after an uncaught throw | 1, a | 1 | 5, a | exit code not Node's |
| throw in an exit listener | 1, a | 1 | 3, a | exit code not Node's |
| rejection in an exit listener | 0, a | 0 | 1, a | exit code not Node's |

Files Node writes are missing in two rows (`'beforeExit'` is never emitted, process.md ❌; an
`unhandledRejection` listener never runs for a rejection made inside an `'exit'` listener), in both
hosts. Work already due when `exit()` is called from any callback still runs in both hosts — the untried
lead `runtime-js/host-deliveries-stop-at-process-terminal`. Every divergence is at a place `runCode` diverges too; the sandbox's status is `runCode`'s on every
row but one — a timer due beside a fatal thrown from another timer: `runCode` takes its `exit(0)`
(0), the sandbox keeps the fatal's 1 (Node's; the terminal is already recorded) and its file.

## Before PR #424 (main `f3861a3cd`)

Rows that were the sandbox's own (cross-review round 1 added the rejection one): an unhandled
rejection reported after the run ran its `unhandledRejection` listener in the capture window (an
endless listener: `timeout`, writes rolled back). A timer queued before an uncaught throw fired after the guest's
run had ended (the host timer was in flight when the result was) — `runCode` disposed the isolate
at the result, so nothing of it was seen, while a sandbox captured its state after the run and
waited for the callback; a due timer an `'exit'` listener armed at a natural exit ran the same way
(output `T`, file `t`; Node: neither). A finite such timer left its file (`a,q` where Node has `a`), an endless
one ended the run `timeout` with every write rolled back (Node and `runCode`: exit 1). The 0 ms
timer beside `exit()` left its file in some runs.

Not in this class: the pool rows (a lost worker, a starved deadline, an adaptive culprit) end the
run killed or lost — the sandbox row "Killed run … or lost worker" (rolled back); `import()` has its
own sandbox rows.

Not in this class either, and **sandbox only**: a guest that replaced intrinsics the state capture
uses (`DataView.prototype.setUint32`, …) runs its own code after the run's status is out. Its output
is dropped since PR #424 (it printed `AFTER`), but it can leave any tree the codec accepts — a
`setUint16` that turns `a` into `b` leaves `/workspbce` and no `/workspace`, exit 0, no
`stateRefused` — and an endless one ends the run `timeout`, its writes rolled back (Node: exit 0,
files kept). Compat Sandbox row "The guest's realm while its state is captured".
