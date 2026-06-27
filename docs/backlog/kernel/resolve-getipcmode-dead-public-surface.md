---
area: kernel
status: draft
title: Resolve getIpcMode/forceFallback dead surface — wire RIFTY_FALLBACK_NO_SAB seam or remove the unused export
created: 2026-06-13
why: getIpcMode() + IpcModeOptions.forceFallback are exported from kernel's public index with zero production callers; the RIFTY_FALLBACK_NO_SAB override they were built to serve (ADR-0039 P2-2) never landed, so both are dead surface and a false signal that the fallback override works.
user_story: As a developer testing rifty's non-SAB fallback path, I want `RIFTY_FALLBACK_NO_SAB` to force the no-SharedArrayBuffer IPC mode via `forceFallback`, but today nothing reads that override and `getIpcMode()` is dead surface — the gate always uses `isSabIpcSupported()`, so I can't simulate the fallback.
sources: [ADR-0011, ADR-0039]
code: [packages/kernel/src/ipc/capabilities.ts, packages/kernel/src/index.ts, packages/runtime-js/src/builtins/worker_threads.ts, packages/runtime-js/src/builtins/child_process.ts, packages/runtime-js/src/builtins/child_process-sync.ts, packages/kernel/tests/capabilities.test.ts]
---

## Context

Non-test references to getIpcMode = only the index re-export + its own TSDoc + capabilities.test.ts (which tests the dead fn and asserts the kernel IGNORES RIFTY_FALLBACK_NO_SAB). Every production SAB gate bypasses getIpcMode and calls isSabIpcSupported()+getKernelWorkerUrl() directly. RIFTY_FALLBACK_NO_SAB appears in zero production code. The capabilities.ts TSDoc claims 'the playground reads the RIFTY_FALLBACK_NO_SAB override and passes the result via forceFallback' — but no playground code does this.

## Options or Next

(A) Remove getIpcMode + IpcModeOptions + the forceFallback param from public surface and capabilities.ts; keep isSabIpcSupported() as the sole gate; drop the dead test cases — closes ADR-0039 P2-2 as won't-do. (B) Land the missing wiring: playground reads RIFTY_FALLBACK_NO_SAB and routes through getIpcMode({forceFallback}) at the gates — closes P2-2 as done. Prefer (A) unless a concrete non-isolated-preview need surfaces. Either way add a failing test first (export-absence for A; integration gate for B) and update ADR-0039:35 + ADR-0011:47. For removal, scan downstream @riftydev/kernel consumers for getIpcMode imports.

## Reversibility

REVERSIBLE — backlog item; public-API removal or additive wiring, single PR, no behavioural change to the live SAB path.
