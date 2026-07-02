---
area: playground
status: ready
title: Realistic React + Vite client preset (issue tracker SPA)
created: 2026-07-02
why: the main vibecoding scenario is React client apps + dev server; current presets have no real React — a minimal toy would fake the bench signal
user_story: As a playground user, I want to open an ordinary modern React SPA and see it live in the preview, but today only vanilla Vite / Node server presets exist
epic: ai-mode-mvp
blocked_by: []
sources: [docs/backlog/epics/ai-mode-mvp.md]
code: [apps/playground/src/presets.ts, apps/playground/src/templates/registry.ts, apps/playground/src/templates/vite.ts, apps/playground/tools/bake-dep-snapshots.ts]
---

## Context

"Ordinary, not minimal" — a minimal React toy gives fake results; agents win on
toys and collapse on normal apps. Mid-size client SPA, no backend/SSR. The preset
system is data-driven (template `ProjectSpec` + `Preset` entry + registry); the
snapshot pipeline (`bakedNodeModulesUrl`, ADR-0135) gives instant boot.

## Acceptance

- New template `react-vite` + preset `react-vite` registered end-to-end: chooser
  card, `?preset=react-vite&autorun=1` deep-link, `presets.test.ts` coverage
  (template linkage, boot lines, openFiles exist).
- App shape: React + TypeScript + Vite + React Router +
  `@vitejs/plugin-react` — **verified working in rifty, not assumed**: Fast
  Refresh on component edit must work in the preview; if plugin-react breaks in
  the rifty runtime, that is a compat finding to fix or record (loud ❌ +
  backlog), not a reason to silently ship esbuild-JSX-only.
- Issue tracker: routes `/` (dashboard with counts + recent list), `/issues`
  (list + status/assignee filters), `/issues/:id` (detail), `/settings`; 5–8
  components; plain CSS files; data from local mock module `src/data/issues.ts`
  (no fetch, no backend); state via `useState`/`useReducer`/context only.
- Intentional rough edges (bench-task anchors, each looks like normal code, not
  a planted comment): (1) issue-list filters live only in component state — lost
  on reload/deep-link; (2) no search anywhere; (3) dashboard "recent issues"
  sort by date is buggy (string compare on dates); (4) no create-issue form —
  detail view is read-only.
- Boots in the playground: preview LIVE, client-side navigation between all
  routes inside the preview iframe works (including a direct
  `/preview/<port>/issues/<id>` deep link), HMR component edit updates preview.
- Instant boot: baked node_modules snapshot
  (`react-vite-node-modules.json.gz`) produced by the existing bake pipeline and
  committed; preset marked `setup: 'instant'`.
- Portable: template source contains zero rifty-specific code/config (unit test
  asserts: standard `package.json` scripts `dev`/`build`/`preview`, no
  `__rifty`/`/preview/` references); one documented manual run in the PR proving
  `npm install && npm run dev` on local Node serves the identical app.
- e2e: boot `react-vite`, assert LIVE pill + preview shows dashboard content
  from mock data; navigate to `/issues` in preview; edit a component file and
  assert HMR-updated preview.

## Parity cases

Preset parity = same source, same behavior under real local Node/Vite (checked
manually at implementation; continuously by the agent-bench `local-reference`
lane, ADR-0191):

- `npm install && npm run dev` locally serves the same routes with the same
  rendered content as the playground preview.
- Component edit under local Vite triggers Fast Refresh exactly as in the
  playground preview.
- Router deep link (`/issues/:id`) renders identically local vs playground.

## Out of scope

- SSR, backend, API calls, persistence (data resets on reload — by design, it is
  a mock module).
- State/query libraries (Redux, TanStack Query, zustand) — plain React state
  only.
- In-template test setup (no vitest/jest inside the preset app).
- Vite 8 variant — Vite 7 only (Vite 8 Rolldown-WASI build is upstream-broken;
  Vite 7 is the repo default; this preset is dev-server-first).
- Auth, i18n, theming beyond one plain CSS theme.

## Decisions

- Deps (exact-pinned via snapshot; caret in template install map like sibling
  presets): `react@^19`, `react-dom@^19`, `react-router-dom@^7`, `vite@^7`,
  `@vitejs/plugin-react@^5`, `typescript@^5`. "Ordinary modern" = current
  defaults, not legacy versions.
- Instant boot via baked snapshot (bench does 30 cold starts per sweep; 60–90 s
  browser installs × 30 would dominate wall-clock; snapshot restore is ~1–3 s).
  Snapshot size expected in the existing 10–17 MB gz corridor; acceptable — the
  pattern already ships 4 snapshots.
- Rough edges are the four listed in Acceptance — chosen to anchor the v1 bench
  tasks (search, URL filters, sort fix, create form) without looking planted.
- Mock dataset: ~25 issues across 4 statuses / 5 assignees / tags — enough for
  filters and dashboard counts to be visually meaningful in bench judges.
- File layout: `src/main.tsx`, `src/App.tsx` (router), `src/pages/{Dashboard,
  IssueList,IssueDetail,Settings}.tsx`, `src/components/{IssueCard,FilterBar,
  StatusBadge}.tsx`, `src/data/issues.ts`, `src/styles/*.css` — 12±2 files.
