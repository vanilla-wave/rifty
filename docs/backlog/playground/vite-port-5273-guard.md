---
area: playground
status: active
title: No test asserts the playground dev-server port / strictPort (5273)
created: 2026-06-08
why: War-story — Vite dev port 5173 collided with an unrelated local project; pinned strictPort 5273, but nothing guards the regression
sources: [TASKS war-stories, audit-digest "Real bugs caught M1–M9"]
---
## Context
During M1–M9 verification the Vite dev server port 5173 collided with an unrelated local project — Playwright was hitting the wrong app. Fixed by pinning `strictPort: true` on port **5273** (`apps/playground/vite.config`). No test/config assertion locks the port or `strictPort`, so a silent reversion (back to 5173, or dropping `strictPort`) would re-introduce the cross-app collision and a confusing e2e failure.
## Options / Next
Next: add a guard that asserts the dev server config pins `port: 5273` + `strictPort: true` (a small config/unit assertion, or a Playwright base-URL check). Ensures `strictPort` fails loud on a busy port instead of silently bumping to 5274 and confusing the e2e suite.
## Reversibility
Reversible — adds a tiny assertion, no production-API change.
