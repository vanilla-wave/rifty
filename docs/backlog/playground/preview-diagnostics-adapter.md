---
area: playground
status: draft
title: Preview failures as retained diagnostics with real provenance
created: 2026-07-09
why: Preview collapses warmup into broad starting/error/unreachable states and points users to terminal scrollback, while transport faults may contain a real upstream response or a distinct broker failure.
user_story: As a developer whose preview failed, I want the IDE to retain the real status, failed hop, and valid retry path, but today I see a generic overlay and must infer whether the server, bridge, or frame failed.
epic: actionable-ide-diagnostics
blocked_by: [playground/diagnostics-hub, service-worker/preview-dispatch-termination-chokepoint]
sources: [M11, docs/backlog/epics/fault-honest-sw-preview.md]
code: [apps/playground/src/components/PreviewPanel.tsx, apps/playground/src/components/preview-panel-core.ts, packages/service-worker/src]
---

## Context

Adapt settled preview outcomes into retained diagnostic records without replacing the preview's real response. Preserve upstream non-2xx responses (for example Vite's real 403 body) as application results; create a broker diagnostic only when no upstream response exists. Record port/preview scope, failed hop, status/error family, terminal run when known, and source-valid Retry/Open terminal/Open new tab actions.

(`preview-blocked-host-hang` dropped from blocked_by: PR #125 refuted it — the
hang was rifty's missing `net.isIP`, fixed with a parity case; there is no
blocked-host response to adapt.)

Resolution follows an authoritative successful route/frame state, not a timer. A non-2xx response is not automatically `server absent`; a dead bridge must settle within the bounds owned by `fault-honest-sw-preview`.

## Reversibility

REVERSIBLE adapter over the settled preview fault contract; transport semantics remain in the blocking items.
