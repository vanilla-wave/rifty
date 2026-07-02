---
area: playground
status: draft
title: Lazy-load Monaco + split the monolithic main chunk
created: 2026-07-02
why: the playground main chunk is 4.1 MB raw / 1.07 MB gz with monaco-editor imported eagerly (App.tsx:12) while the editor renders only after project pick — parse/eval of never-yet-needed code sits on the cold-start critical path
user_story: As a user opening the playground on a real network, I want the chooser interactive as fast as possible, not after the editor stack I haven't asked for yet is downloaded and evaluated.
sources: [perf/benchmarks.json cold-start, prod build chunk audit 2026-07-02]
code: [apps/playground/src/App.tsx, apps/playground/src/components/EditorHost.tsx, apps/playground/src/glue/monaco-env.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts, apps/playground/index.html]
---

## Context

Prod build (2026-07-02): `index` 4.1 MB raw / 1.07 MB gz (monolith: Monaco + all
UI + glue); Monaco language workers are already separate chunks (`ts.worker`
1.33 MB gz fetched on demand). `monaco-editor` is a top-level value import in
`App.tsx:12`, `EditorHost.tsx:12`, `ts-ls-monaco-providers.ts:59`, but the
editor mounts only behind `<Show when={editorProjectContextReady()}>`
(App.tsx:3320). Runtime monaco uses in App.tsx live in the TS-LS provider
wiring (~1344-1700), gated on editor readiness — all lazy-loadable seams.

Related smaller wins, same PR family:
- `modulepreload` worker chunks (index.html has ONE modulepreload; the owner
  worker chunk `real-vite-bootstrap` 208 KB gz starts fetching only after the
  main bundle evaluates and spawns it).
- Open the first-run chooser on the first empty-index publish instead of only
  the fixed 1 s timer (App.tsx:2374-2377; keep the timer as fallback).

## Options or Next

- `glue/monaco-loader.ts` with a `loadMonaco(): Promise<typeof monaco>`
  singleton dynamic import; `EditorHost` awaits it on mount; App's TS-LS glue
  receives the instance via the editor-ready signal; type-only imports stay.
- Candidates behind the same split: launcher/template registry strings, SCM/git
  glue, ts-ls-client.
- Acceptance: main chunk gz roughly halves; cold-start-to-interactive
  (`pnpm bench`) does not regress; e2e green (editor, TS diagnostics, SCM).

## Reversibility

REVERSIBLE — bundling/code-motion only, no behavior change; a revert restores
eager imports.
