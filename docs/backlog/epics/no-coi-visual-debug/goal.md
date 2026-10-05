---
kind: epic
status: draft
title: Visual debugging of the app an agent builds in a no-COI host
created: 2026-09-27
value: A developer using the no-COI agent host sees and debugs the running application the agent produced, inside the host page, without leaving the browser.
user_story: As a developer embedding the no-COI agent host, I want to see what the agent built running and debug it visually, but today the kit stops at `vite build` and a dist read.
---

## Outcome

Open — owner: user. Captured 2026-09-27 from the kit refine
(`docs/backlog/distribution/reference/no-coi-agent-host-kit-close.md`): «пока не делаем. Отдельный эпик про
визуальный дебаг». What "visual debugging" must include beyond an iframe on
the resident preview URL (console mirror, HMR, DOM inspection, network view)
is the user's scope question; nothing is prescribed here.

## User scenario

Sketch, unratified: the agent starts the dev server (`toolchain.startBin`),
the host mounts `resident.previewUrl` in an iframe (ADR-0377; the agent-bench
page already does this), the agent host switches to `preview` mode through the
caller-owned `mode()` (ADR-0426), and the developer observes the running app
while continuing the conversation. Steps become ratified at FIT with the user.

## Decisions

- 2026-09-27 — user: preview is not part of the kit; separate epic. Existing
  question item: `distribution/public-api-ai-agent-preview-question` (no new
  API prescribed). Related: `epics/open-bolt-ai-sandbox-demo` (public demo).
