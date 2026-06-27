---
area: runtime-js
status: draft
title: runtime-js/worker-entry top-level installProcessGlobals() side-effect leaks into the owner chunk (prod) and clobbers globalThis.process
created: 2026-06-17
why: packages/runtime-js/src/worker-entry.ts runs installProcessGlobals() at MODULE TOP LEVEL (it is the runtime-js sandbox-worker entry). In the playground PROD bundle that module gets pulled into the workspace-owner chunk and evaluated at module-eval, swapping globalThis.process for a fresh EMPTY-env one — AFTER the kernel pre-entry hook set process.env from the spawn spec. The owner then read undefined worker URLs and threw 'missing RIFTY_KERNEL_WORKER_URL / RIFTY_NODE_ENTRY_WORKER_URL' → dev server never booted, explorer stuck 'Loading the workspace…'. Dev (pnpm dev) never loaded the module in the owner realm → green e2e, dead deploy. WORKED AROUND in real-vite-bootstrap (reads env from readKernelProcessSpec() + re-asserts onto process) — this item is the ROOT: a sandbox-worker entry's global side-effect must not run in another realm.
user_story: As a rifty maintainer I want a worker entry's process-installing side-effect to run ONLY in its own worker realm — not leak into the owner chunk via prod bundling and silently reconfigure globalThis.process there.
sources: [ADR-0039, ADR-0150]
code: [packages/runtime-js/src/worker-entry.ts, apps/playground/src/workers/real-vite-bootstrap.ts, apps/playground/src/workers/kernel-worker-entry.ts]
---

## Context

Diagnosed via headless probe of the PR41 deploy + a local `pnpm preview` repro (same bundle
hash). `globalThis.process.env` was full right after the owner's `installRuntimeGlobals()` and
EMPTY at the throw a few lines later; the only top-level process-clobbering side-effect in the
tree is `runtime-js/worker-entry.ts:36 installProcessGlobals()`. It is the entry for a DIFFERENT
worker (the runtime-js sandbox), not something other realms should import — but rollup chunking
co-locates/evaluates it in the owner in prod. `kernel-worker-entry.ts:16-18` already warns about
this class ("Vite/Rollup can erase pure side-effect imports … the emitted worker chunk cannot
collapse to an empty module") — the inverse also bites: a side-effect that SHOULD be scoped to
one entry leaks into another.

The owner is now robust (env from the kernel spec, which lives on a dedicated non-enumerable
global the swap can't touch), but the clobber still replaces `globalThis.process` in the owner —
a latent hazard for anything else that holds a process reference.

## Mitigation (ADR-0157, 2026-06-20)

Partially mitigated, NOT closed. ADR-0157 (a) removed the in-entry `installProcessGlobals` swap, so
the pre-entry spec process is the canonical one user code reads (the pre-entry hook runs AFTER
worker-chunk module-eval, so a stray top-level install is overwritten); and (b) made
`installProcessGlobals()` idempotent (skips when `globalThis.process` is already a `NodeProcess`) as
defense-in-depth. The ROOT (a sandbox-worker entry's global side-effect leaking into the owner chunk)
remains: the chunk-graph isolation + the cause-level unit test below are still open, and the
owner/dev-server `readKernelProcessSpec()` env reads are retained as belt-and-suspenders.

## Options or Next

- Make `installProcessGlobals()` NOT a bare top-level side-effect in `worker-entry.ts` — guard it
  (run only when this module is the realm's actual entry), or move the call behind the kernel
  `'init'` path so importing the module is inert.
- OR ensure `runtime-js/worker-entry` is never in the owner chunk's import graph (manualChunks /
  break the transitive import; verify with a prod-bundle module-graph assertion).
- Add a regression: the prod-smoke e2e (`tests/e2e-prod/owner-boots-on-prod-build.spec.ts`) now
  guards the symptom; a unit asserting `import`-ing the runtime-js barrel doesn't reconfigure
  `globalThis.process` would guard the cause.

## Reversibility

REVERSIBLE — guarding a side-effect / chunk-graph fix + a test; no public-API or wire-format
change. The owner-side workaround stays as defence-in-depth.
