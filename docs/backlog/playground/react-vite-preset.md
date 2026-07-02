---
area: playground
status: draft
title: Realistic React + Vite client preset (issue tracker SPA)
created: 2026-07-02
why: the main vibecoding scenario is React client apps + dev server; current presets have no real React — a minimal toy would fake the bench signal
user_story: As a playground user, I want to open an ordinary modern React SPA and see it live in the preview, but today only vanilla Vite / Node server presets exist
epic: ai-mode-mvp
blocked_by: []
sources: [docs/backlog/epics/ai-mode-mvp.md]
code: [apps/playground/src/presets.ts, apps/playground/src/templates/registry.ts, apps/playground/src/templates/vite.ts]
---

## Context

"Ordinary, not minimal" — grilled: a minimal React toy gives fake results; agents
win on toys and collapse on normal apps. Mid-size client SPA, no backend/SSR:

- React + TypeScript + Vite + React Router; `@vitejs/plugin-react` if it proves
  clean in rifty (verify, don't assume).
- Plain client state: `useState`/`useReducer`/context — no Redux/query libs.
- Data via local mock module (`src/data/issues.ts`), plain CSS, 5-8 components,
  3-4 routes: issue tracker — `/` dashboard, `/issues` list+filters,
  `/issues/:id` detail, `/settings`.
- A few intentional rough edges as bench-task anchors.
- **Portable**: same source must run unchanged in local Vite (`npm i && npm run
  dev`) — the bench local-reference lane consumes the identical seed.
- Stand-alone playground value with no AI attached (it's a preset, not bench
  fixture); bench tasks seed OVER it from `tools/agent-bench/tasks/*/seed/`.
