# ADR 0347: Idempotent process-manager kill during settlement

Status: Accepted
Date: 2026-08-10

> TL;DR: manager-by-PID kill acknowledges an existing target that is already
> terminating; handle kill remains the one-shot termination admission result.

## Context

ADR-0326/0333 separates termination admission from physical descendant
settlement. During that interval the target remains published, but
`ProcessManager.kill(pid)` returned `false` after its local
`terminationRequested` or forwarded `killRequested` bit was set. Runtime-js's
stable descendant authority correctly treats `false` plus a still-present
snapshot row as a refused kill, so a duplicate teardown request became a loud
control failure despite the target already terminating.

`ProcessHandle.kill()` already exposes a useful, different fact: whether that
handle admitted termination now. Changing it would erase duplicate-admission
information used by callers and tests.

## Decision

- Public `ProcessManager.kill(pid, signal)` returns `true` when an existing
  local or forwarded target either admits termination now or is already
  terminating. The duplicate call sends no second control frame and does not
  replace the admitted signal.
- An absent PID returns `false`. A published target whose physical route
  refuses control also returns `false` and stays visible, preserving the loud
  `false + snapshot` failure contract.
- `ProcessHandle.kill()` remains a one-shot admission boolean: first accepted
  call `true`, duplicate call `false`.
- ADR-0334's descendant-authority v1 shape remains `{ kill, snapshot }`; no
  symbol, frame, route, or lifecycle ledger changes.

## Consequences

- Ancestor teardown may idempotently repeat manager-level control while exact
  descendant settlement remains pending.
- Callers needing new-admission truth continue to use the handle, not manager
  lookup.
- Existing/refused and absent targets remain distinguishable from an already
  terminating target without a new public result type.

The CI trace that exposed this split also found an already-owned child Worker
error taking browser default propagation after physical termination removed its
listener. The supervising error boundary now stays attached for the terminated
Worker's lifetime and prevents propagation before terminal/duplicate guards; it
does not suppress the child failure or change an already-admitted signal
outcome. The sealed browser fixture preserves phase-labelled nested
`AggregateError`/`cause` trees for future failures.

## Fault matrix

| fault × operation | honest outcome / proof |
|---|---|
| `concurrent-same-key` × duplicate PID kill before settlement | manager lookup returns `true` twice, emits one control, retains the first signal; physical refusal stays `false` and loud — process-tree + process-IPC fault tests |
| `observable-order` × queued child Worker error after physical terminate/listener teardown | retain the guarded boundary for the terminated Worker lifetime; prevent browser propagation with no second diagnostic/exit, preserve admitted signal, spawning realm survives — Worker-error fault test + real-nodemon Chromium stress |

The real-browser proof is:

```sh
RIFTY_PLAYGROUND_PORT=5441 pnpm exec playwright test tests/browser-unit/nodemon-session-close-race.spec.ts --config playwright.browser-unit.config.ts --repeat-each=10
```

Specifies ADR-0326's public manager/handle kill split. ADR-0333 and ADR-0334
otherwise stand.
