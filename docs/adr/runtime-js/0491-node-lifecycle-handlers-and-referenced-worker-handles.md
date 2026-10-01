# ADR-0491: Node lifecycle handlers and referenced Worker handles

- Status: accepted
- Date: 2026-10-01
- Extends ADR-0152 / ADR-0157; no recorded decision overturned.

## Context

Vitest uses process error/exit handlers and Workers. Node v24.16.0 oracle:
`tests/e2e/vitest-run-in-browser.spec.ts` runs identical fixtures on native Node
and Chromium. Baseline: lifecycle exits 1 versus native 3; Worker parent
exits before delayed message (goal evidence).

## Decision

Dispatch browser failures to the runtime-owned process before default terminal
handling. Handled failures continue; absent handlers keep loud default failure.
`exit()` inherits exitCode and synchronously emits `exit` once before terminal.
Workers acquire the existing event-loop ref at construction, release on terminal
or unref; ref is idempotent. Worker message listeners hold the child loop;
run-to-completion Workers drain naturally. Reuse existing stdio and IPC channels.

## Alternatives

- Per-Vitest promise tracking/source patch: rejected by I2; no generic Worker lifetime.
- Separate Worker lifetime manager: rejected; child_process already uses the same refcount.
- Existing refcount + process event projection: chosen; no additional transport/coordination.

## Proof

Node/native + physical browser fixtures, per-wall REDs, composed Vitest e2e.
