---
area: playground
status: ready
title: Project activation/open compensation
created: 2026-07-28
why: activating a saved project commits its catalog pointer before opening the project, so a definition mismatch can close the prior live project and leave the App pointing at the failed target
user_story: As a browser-IDE user switching between saved projects, I want a target that cannot open to leave my prior project selected and running before the error is shown, but today activation can strand the workspace between catalog and session state
sources: [ADR-0278, docs/backlog/playground/reference/vite8-durable-reopen-contract-red.md, docs/backlog/playground/reference/vite8-durable-reopen-cross-build-probe.md]
code: [apps/playground/src/adapters/playground-app-runtime.ts, apps/playground/src/adapters/playground-app.tsx]
---

## Context

Terminal predecessor `playground/vite8-durable-reopen-invalidation` combined
two boundaries: a narrow App activation/open transition and a large historical
Vite 8 tree oracle. Its second Contract+RED checkpoint found that the shared
`defineTransition` helper made an activation repair vulnerable to
create/save sibling drift.

This successor owns only activation compensation. The existing App FIFO
remains the sole admission mechanism; compensation executes inline in the
admitted operation through the existing catalog and session authorities.
Successful create/save/reset/delete mutations are not rollback-safe at this
adapter layer and retain their current owner-defined post-mutation behavior.

## User scenario

Saved project B is selected and live. The user selects saved project A.
`catalog.activate(A)` publishes A, but opening A rejects with a definition
mismatch. Before the selection promise rejects and App displays the A error,
the same B catalog ref is selected again, a fresh B session is open, and the UI
is bound to it.

## Acceptance

1. After B closes, A activation commits, and A open rejects, the same prior B
   ref is reactivated and B is reopened before the activation promise rejects.
   Successful compensation rethrows the exact A error.
2. Failure to reactivate B reports one `AggregateError` whose errors are
   `[A open, B activation]`. Failure to reopen B reports `[A open, B open]`.
   The runtime never claims a live context that did not finish tool binding.
3. If B session tool binding fails during runtime restoration, its unbound
   session is closed and the aggregate preserves `[A open, B tool binding]`.
   If the later App UI binding of the restored context fails, App reports
   `[A open, B UI binding]`; neither secondary failure replaces A's cause.
4. A runtime `close()` admitted while A open is pending runs only after
   compensation settles, then closes restored B before the sole Workbench
   owner.
5. The create/save sibling sweep proves a successful catalog mutation followed
   by target-open failure does not reactivate the prior ref: the committed
   Scratch/named target remains catalog-active and runtime current is null.
   Mutation failure before commit retains the existing prior-session restore.
6. The reset/delete sibling sweep proves their successful mutations never call
   activation compensation. Each retains the exact active ref returned by its
   catalog owner; any required post-mutation reopen failure stays loud with
   runtime current null.

## Parity cases

This is an own-product App lifecycle contract; no Node API behavior is claimed.

1. B→A target-open failure restores B before surfacing A's error.
2. B reactivation, B open, runtime tool binding, and App UI binding failures
   preserve the causal error pair and exact cleanup.
3. Concurrent close observes compensation before B/session/Workbench teardown.
4. Create, Save, Reset, and Delete preserve their existing successful-mutation
   semantics and do not inherit activation rollback.

## Fault matrix

| Axis × operation | Injected fault | Honest outcome |
|---|---|---|
| `torn-state` × activate/open | A pointer commits, then A open rejects | Inline compensation restores B catalog/session before A rejection settles. |
| `quota-perm-fail` × restore activation | B reactivation rejects | Loud `[A open, B activation]`; A stays catalog-active and runtime current is null. |
| `torn-state` × restore open/tools | B open or tool binding rejects | Loud causal pair; B ref remains active, unbound session is closed, runtime current is null. |
| `observable-order` × App binding | Restored runtime context cannot bind to UI | Loud `[A open, B UI binding]`; A cause is not replaced. |
| `observable-order` × queued close | Close arrives while A open is pending | Restore settles first; close drains B, then Workbench. |
| `sibling-drift` × create/save/reset/delete | A generic helper repair compensates every post-mutation open failure | Green sibling table detects any extra prior activation and pins each catalog owner's committed result. |

## Out of scope

- Vite 8 historical fixture bytes, OPFS Reset, install trust, or offline reopen;
  `playground/vite8-durable-tree-replacement-proof` owns that serial proof.
- Undoing successful create, save, reset, or delete tree/catalog transactions.
- A second FIFO, lock, ledger, catalog transaction, or recursive App operation.
- Crash/reload recovery while compensation is in flight.

## Decisions

ready-verdict: 2026-07-28 — ADR-0278 and the terminal predecessor split settle activation-only scope, mutation ownership, and overlap; the versioned same-origin Chromium probe plus reachable Contract+RED lineage settle the half-switch repro, causal runtime/App binding failures, cleanup, and queued-close order; current App-runtime and catalog-authority source settle create/save/reset/delete committed-result semantics; the existing App FIFO and catalog/session authorities make inline compensation sufficient with no new coordination mechanism.

- `split-predecessor:
  c043302541f639464d310fe1e9ab74a4c084f136`; predecessor checkpoints:
  `fbe9249181a4d6ed3c0126d4177f38dfe35b1f78` and
  `c043302541f639464d310fe1e9ab74a4c084f136`.
- Activation is the only reversible pointer-only mutation in scope. It gets an
  activate-specific path; the shared create/save transition path is unchanged.
- Compensation uses the existing catalog authority inside the existing App
  FIFO. It neither enqueues recursively nor introduces coordination state.
- Existing causal cleanup owns `[trigger, cleanup]` ordering at both runtime
  tool binding and App UI binding boundaries.
- Successful tree-owning mutations are authoritative. This adapter reports a
  subsequent open failure but does not pretend it can roll the tree back.

## Reversibility

REVERSIBLE App lifecycle repair; no public API or durable format changes.
