---
area: playground
status: ready
title: Lazy-load Monaco + split the monolithic main chunk
created: 2026-07-02
why: the playground main chunk is 4.1 MB raw / 1.07 MB gz with monaco-editor imported eagerly while the editor renders only after project intent
user_story: As a user opening the playground on a real network, I want the chooser interactive before editor code I have not asked for is downloaded or evaluated.
sources: [perf/benchmarks.json cold-start, prod build chunk audit 2026-07-02, boot-speedup-phase-b measurements 2026-07-07]
code: [apps/playground/src/App.tsx, apps/playground/src/components/EditorHost.tsx, apps/playground/src/components/editor-host-core.ts, apps/playground/src/glue/monaco-env.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts, tools/checks/arch-rules.cjs]
---

## Context

Prod build (2026-07-02): `index` 4.1 MB raw / 1.07 MB gz because
`monaco-editor` was reachable from the cold-start App graph. The editor mounts
only after a project context exists. Runtime Monaco access in App is limited to
TS-LS glue and can flow through `EditorApi.monaco` once the editor registers.

Related wins are separate contracts:
- `playground/worker-chunk-modulepreload` tracks the owner-worker chunk hint;
  unmeasured preload behavior stays out of this item.
- First-run chooser-on-publish already shipped in PR #113.

## User scenario

A first-run user opens the hosted playground on a real network and idles on the
starter chooser. The chooser should become interactive without downloading or
evaluating the Monaco editor graph. Once the user picks a starter, or a returning
user/project-ready boot proves an editor will mount, the editor stack may warm in
the background so the eventual editor paint stays fast.

## Acceptance

- App's cold-start main chunk no longer value-imports `monaco-editor`,
  `EditorHost`, `editor-host-core`, `monaco-env`, or TS-LS Monaco providers.
- The editor stack loads through `solid-js` `lazy()` or an intent-gated dynamic
  warm, never through a top-level app-eval `import()`.
- A true first-run visitor idling on the chooser does not fetch/evaluate the
  editor stack.
- Returning/project-ready boot warms the editor stack before editor mount.
- Starter pick warms the editor stack at pick intent before the boot flow reaches
  editor mount.
- `api.monaco` replaces App's runtime Monaco value import for TS-LS provider
  helpers and dev hooks.
- Check:arch has rules covering all non-type imports of `monaco-editor` and all
  static imports of the lazy editor stack from outside the allowed stack.
- Existing editor, SCM diff, terminal file-link, Problems click-to-jump, and
  TS-LS e2e hooks keep their behavior.

## Parity cases

- Browser behavior only; no Node parity case. Regression surface is user-visible
  editor/TS-LS behavior and cold-start chunk membership.
- Guard with node tests for App wiring/core intent ports, arch-boundary fixture
  tests, and e2e editor/TS-LS/SCM smoke.

## Out of scope

- Worker chunk modulepreload; see `playground/worker-chunk-modulepreload`.
- Moving launcher/template/SCM code out of the main chunk.
- Any fake editor or Monaco substitute. Missing editor behavior must fail loudly
  through the existing editor/TS-LS surfaces.

## Decisions

- Use Solid `lazy()` for `EditorHost`; keep App's access to Monaco behind
  `EditorApi.monaco`.
- Warm the lazy editor stack only after returning/project-ready boot evidence or
  starter-pick intent. Do not warm at App module evaluation.
- Keep `monaco-editor` value imports in the lazy editor stack only:
  `EditorHost.tsx`, `editor-host-core.ts`, `monaco-env.ts`, and
  `ts-ls-monaco-providers.ts`.
