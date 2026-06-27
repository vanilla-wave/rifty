---
area: playground
status: draft
title: File-backed VS Code model references for playground editor tabs
created: 2026-06-25
why: EditorHost hand-maintains Monaco models, paths, dirty state, read-only fallbacks, and disposal; VS Code model references may make that seam deeper.
user_story: As a rifty maintainer, I want editor tabs to use file-backed model references so file identity and save lifecycle are shared with VS Code services, but today EditorHost owns standalone Monaco models and path maps by hand.
sources: [docs/backlog/playground/monaco-vscode-api-workbench-services-spike.md, docs/backlog/playground/vscode-rifty-uri-contract.md, docs/backlog/playground/vscode-readonly-file-provider-spike.md, ADR-0075, ADR-0166]
code: [apps/playground/src/components/EditorHost.tsx, apps/playground/src/components/EditorTabs.tsx, apps/playground/src/glue/editor-tabs.ts, apps/playground/src/glue/editor-open.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

`EditorHost` currently creates standalone Monaco models and keeps its own maps
between tabs, paths, model URIs, read-only state, dirty state, and TS-LS provider
lookups. That worked for the current playground, but it is the exact kind of
shallow VS Code-shaped glue `monaco-vscode-api` may replace.

After the service-only spike, URI contract, and read-only file provider exist,
try opening files through VS Code model references instead of standalone
`monaco.editor.createModel`. The first target is read-only/open lifecycle, not a
full replacement of save/write behaviour.

The permanent program tab invariant from ADR-0075 remains load-bearing until the
replacement proves it preserves preset boot, HMR, and active program behaviour.

## Options or Next

1. Open a normal project file via a VS Code model reference backed by the read-only
   provider.
2. Preserve editor tab UX while moving file identity from custom path maps to
   model/resource URIs where possible.
3. Keep rifty TS-LS providers active and ensure `pathForModel` / `ensureModel`
   can resolve through the URI contract.
4. Compare deletion potential:
   - path-to-model maps;
   - manual disposal/refcount handling;
   - custom read-only loading tabs;
   - dirty/save glue.
5. Do not replace program-tab write/HMR flows until tests prove parity with the
   existing behaviour.
6. Decide whether the next step is a write-capable owner file provider or keeping
   model references read-only for dependency/source browsing only.

## Reversibility

REVERSIBLE as a spike. Replacing `EditorHost` model lifecycle or program-tab
write behaviour is an IRREVERSIBLE playground architecture change and needs an
ADR before merge.
