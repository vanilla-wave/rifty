---
area: playground
status: draft
title: Retire or align the legacy terminal-manager close fallback
created: 2026-07-16
why: the test-only legacy manager still selects the first Map key after active close, unlike the companion's visual predecessor rule
user_story: As a maintainer, I want one terminal-close rule so dead test scaffolding cannot reintroduce a focus jump into production.
sources: [PR-136-recut, apps/playground/src/adapters/playground-terminal-ui.ts]
code: [apps/playground/src/adapters/terminal-manager.ts]
---

## Context

The production companion now focuses the nearest surviving predecessor when an
active terminal closes. `terminal-manager.ts` retains the old first-key fallback
but has no production imports; only its own unit tests exercise it.

Decide whether to delete the legacy manager or align it before any reuse. This
does not block the companion because the two state owners are not connected.
