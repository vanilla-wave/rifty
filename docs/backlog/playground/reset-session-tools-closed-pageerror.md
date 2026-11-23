---
area: playground
status: draft
title: Saved-project Reset leaves uncaught `ClosedHandleError: Playground session tools is closed` page errors
created: 2026-11-23
why: A passing Reset e2e reports uncaught page errors on main; an uncaught rejection is either a lost result or a missing settled-close path
sources: [tests/e2e/project-management.spec.ts]
code: [packages/workbench/src/workbench/internal/playground-session-tools-transport.ts]
---

## Context

Observed 2026-11-23 while separating a PR #398 review observation (`REV-12`).
`tests/e2e/project-management.spec.ts` "resetting a saved project wipes its
edits + re-seeds the starter tree" logs `page.on('pageerror')`. Command
(Playwright 1.60.0, bundled Chromium, macOS, local dev server):

`RIFTY_PLAYGROUND_PORT=<free port> pnpm exec playwright test tests/e2e/project-management.spec.ts --project=chromium-heavy --workers=1 -g 'resetting a saved project'`

Every run passes and prints `[pageerror] ClosedHandleError: Playground session
tools is closed`: main @ 11b9397ee 6/4/4 times over three runs; PR #398 branch
12/1/6. The count varies run to run; the error is present on main without the
PR. Candidate throw sites: `assertAccepting` and the pending-request rejection
in `close()` (`playground-session-tools-transport.ts`); which caller leaves the
rejection unhandled is not established.

## Question

Which session-tools call races the Reset close, and is its result needed (a
lost operation) or only unobserved (a missing settled-close handler)?
