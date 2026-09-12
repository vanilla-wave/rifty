# ADR 0421: Bind reusable package adapters to Node invocations

Status: Accepted
Date: 2026-09-11

## Context

ADR-0418 reuses one no-COI Worker across commands. Its generated esbuild service
had captured installation cwd and passed null event-loop refs. A fresh command
from a subdirectory built the root input; a detached build could outlive command
completion. Real Node/esbuild and real WASM REDs:
`packages/workbench/src/workers/no-coi-project-esbuild-cwd.test.ts`.

## Decision

Preserve ADR-0226 upstream service/context ownership and ADR-0384 registry-owned
exact CJS identity. Adapter activation accepts optional getCwd and ref/unref
capabilities from its runtime owner. Workbench supplies the existing Node cwd
cell and keepalive counter; no second timer, task registry or service lifecycle.

Registry CJS acquisition captures cwd before returning the same outer object.
Native esbuild 0.28.0 captures cwd when its module evaluates: chdir after require
does not change it; a fresh invocation requiring from another cwd does. Calling
a getter on every build/context was rejected by that native probe.

The generated upstream client's existing request/build/context refs call the
provided counter. A live context keeps its invocation owned until disposal;
caught request failures release their refs. No Promise wrapper that records
caught failures as unhandled, copied options, API Proxy or substituted result.

## Consequences

Finite commands preserve esbuild cwd/output/lifetime semantics while reusing
the installed service. Older adapter callers retain their fixed cwd and absent
external refs. Upstream still owns its service and context behavior; Worker
termination remains the physical fallback for work that cannot settle.
