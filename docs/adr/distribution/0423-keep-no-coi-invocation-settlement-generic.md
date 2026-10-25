# ADR 0423: Keep no-COI invocation settlement generic

Status: Accepted
Date: 2026-09

## Context

PR #332 CI reproduced three regressions after adopting Workbench's concrete Vite
entry preparation: identical-name decoys were refused, fatal start error raced
its close event, and the Vite 8 fixture expected an acquisition-unprepared anchor.
The packed missing-lock/reapply journey also exposes a retained CLI rejection.
Authorities: ADR-0375/0376/0377 and ADR-0417/0420.

## Decision

- No-COI run/start derives generic adapter facts, never dispatches by requested
  bin name/version. The existing CLI promise hook is installed once by the worker;
  actual prepared source elects to use it. Keep prepared acquisition bytes.
- When the serialized run owner reports failure, take the first existing pending
  realm rejection and report it, otherwise report the direct entry error. Consume
  that record only; retain live refcounts, eval lifecycle and subsequent errors.
  No reset of the whole keepalive state, second error ledger or timer heuristic.
- Fatal resident start sends its serialized cause on the existing terminal frame,
  then closes. Host rejects pending calls with that cause and emits exit in one
  terminal handling turn. Busy rejection with a live resident remains nonfatal.
- Keep the Vite 8 test's real failure assertions; its test-owned promise export
  wraps the newly prepared action anchor instead of looking for old source bytes.

## Alternatives

- Workbench concrete bin-name preparation: rejected by executed Vite-name decoys.
- Delay failure/close or reset all keepalive state: either races or loses handles.
- Generic hook plus consumption by the existing serialized owner: selected;
  uses the existing promise/refcount/terminal owners, no extra coordinator.

## Proof

CI regression RED and isolated 3/3 GREEN; actual packed adapter failure→reapply
journey; native/unit terminal and rejection-ownership tests. Evidence:
docs/backlog/distribution/reference/no-coi-ci-repair-evidence.md.
