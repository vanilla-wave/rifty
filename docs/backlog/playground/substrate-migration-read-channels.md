---
area: playground
status: draft
title: Read channels adopt the correlation substrate
created: 2026-07-22
epic: extraction-ready-page-realm
blocked_by: [playground/page-owner-correlation-substrate]
sources: [ADR-0305]
code: [apps/playground/src/glue/node-modules-port.ts, apps/playground/src/glue/workspace-file-read-port.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/src/glue/project-index-port.ts]
why: read ports duplicate the correlation scaffold; their bounded-deadline semantics are correct and must survive migration unchanged
---

## Context

Migrate read channels onto the substrate's read class (ADR-0305: deadline-bounded, timeout = honest "unknown, no state changed" — semantics unchanged, so this wave is pure engine deletion). Green paths pinned by existing port tests unchanged. Refinement decides per port whether any request is actually a mutation in disguise (then it moves to the mutation wave) and whether `pty-client`'s control-frame correlation joins here or stays with its streaming owner.
