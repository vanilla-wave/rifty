# ADR 0530: Installed Vite CLI runs upstream bytes; trackKeepalivePromise removed

Status: Accepted
Date: 2026-10

> TL;DR: The registry no longer rewrites Vite's CAC `this.runMatchedCommand();` (`viteCliActionPatchPolicy`); installed `vite/dist/node/cli.js` is the upstream tarball member, and the `@riftydev/runtime-js` export `trackKeepalivePromise` plus the realm global `__riftyTrackCliPromise` are removed.

## Context

`fdeefa15a` (ADR-0174, 2026-06) pinned Vite's un-awaited CAC action promise as
one keepalive ref, before the generated esbuild client mapped esbuild's own
`child.ref()/unref()` onto the realm keepalive (ADR-0226 `runtime-service-refs`).
CAC's promise holds no handle in Node either; the loop is held by the action's
real handles. Probe 1 (`docs/backlog/runtime-js/reference/guest-package-patches-refine-evidence-2026-10-15.md`)
ran `vite build` identically with the hook inert. Principle: `AGENTS.md`
§Fidelity "No undeclared adaptation"; goal `honest-guest-package-adaptations` I2.

## Decision

1. Delete `viteCliActionPatchPolicy` with its apply/validate paths, the
   `assertViteCliKeepalive` admission, `ViteCliPreparation.trackKeepalivePromise`
   and every host wiring (`node-entry-runtime-preparation.ts`,
   `no-coi-toolchain-worker.ts`). The install-artifact recipe drops the policy;
   baked snapshots are re-baked over their committed lockfile pins
   (`bake-dep-snapshots.ts --replay-committed-lockfile`), changing only
   `vite/dist/node/cli.js` and the identity.
2. Remove the public `trackKeepalivePromise` export of `@riftydev/runtime-js`:
   its only consumers were the hook wirings above; a guest-visible "pin this
   promise" has no Node counterpart. Host-async work keeps the loop through
   its own counted handles (ADR-0152 §1, ADR-0529).
3. A rejected Vite action reaches the realm `unhandledrejection` trap
   (ADR-0152 §3) like any Node program; Vite's own actions catch, log and
   `process.exit(1)` (failing-config row vs real Node 7.3.6).

## Consequences

- (+) `cli.js` (Vite 7.3.6 and 8.0.16) is byte-identical to upstream; one
  adaptation fewer in the ADR-0384 inventory.
- (−) Embedders that imported `trackKeepalivePromise` lose it (no known consumer).
- A zero-ref window a Vite lane exposes is a keepalive defect routed to ADR-0529's
  carrier set, never a reason to restore a package patch.

## Corrections

- 2026-10-16 — the hook also observed the CAC action promise. Vite's action
  calls `process.exit(1)` after a failed build; rifty's exit throws its signal,
  so the action promise rejects with it, and Chromium reports that rejection
  late. On a reused no-COI process it landed in the next invocation and ended
  it (`tests/no-coi/no-coi-pi-agent.spec.ts`: the repaired build failed with
  `process.exit(1)`). Fixed in the platform, not by restoring the hook: an exit
  signal that is not the current invocation's terminal is ignored
  (`handleRealmUnhandledRejection`; `process-exit-lifecycle.test.ts`).
