---
area: playground
status: active
title: monaco-vscode-api service-only spike
created: 2026-06-25
why: Verify the low-risk VS Code service layer before touching file models, TS providers, or extension hosting.
user_story: As a rifty maintainer, I want to know the dependency, init, bundle, and deletion value of monaco-vscode-api settings/themes/keybindings/quick access, but today that value is guessed from docs rather than proven in the playground.
sources: [docs/backlog/playground/monaco-vscode-api-workbench-services-spike.md, ADR-0075, ADR-0166, monaco-vscode-api README/wiki]
code: [apps/playground/src/main.tsx, apps/playground/src/App.tsx, apps/playground/src/components/CommandPalette.tsx, apps/playground/src/components/EditorHost.tsx, apps/playground/src/styles/theme.css]
---

## Context

The first `monaco-vscode-api` experiment should avoid the risky parts: no file
service, no extension host, no default JS/TS extension, no replacement of rifty's
TS providers. The goal is to answer whether VS Code services can replace shallow
playground glue around editor configuration, themes, keybindings, and command
palette behaviour without changing runtime/editor semantics.

This item is deliberately smaller than the umbrella. It should only initialize
the VS Code service overrides needed for:

- configuration/settings;
- themes;
- keybindings;
- quick access / command palette.

The spike should run before the first Monaco editor is created. If that requires
moving editor boot order, keep the change isolated behind a playground-only
experiment flag or entry path.

## Options or Next

1. Add a playground-only spike path that initializes the minimum
   `monaco-vscode-api` service overrides before `EditorHost` mounts.
2. Prove one setting, one theme, one keybinding, and one quick-access command
   through the VS Code service layer.
3. Keep the existing `EditorHost` model creation, rifty TS providers, owner/VFS
   writes, and Problems panel unchanged.
4. Measure and record:
   - dependency and bundle cost;
   - init ordering constraints;
   - which local code could be deleted;
   - tests needed to prevent behaviour drift.
5. If this spike is promising, promote the dependency/architecture choice to an
   ADR before merging production code.

## Reversibility

REVERSIBLE as a backlog/spike item. Adding `monaco-vscode-api` as a production
dependency or replacing playground service plumbing is IRREVERSIBLE under
`docs/process/decision-workflow.md` and needs an ADR before merge.
