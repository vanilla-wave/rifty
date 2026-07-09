---
area: playground
status: draft
title: Source-aware retained diagnostics hub
created: 2026-07-09
why: Problems models only TypeScript diagnostics for open files while install/runtime/preview/compatibility failures live in transient or disconnected surfaces.
user_story: As a developer fixing a failed project run, I want one retained list that identifies each diagnostic's source and valid recovery action, but today a toast expires and `No problems detected` overstates the open-file TS scan.
epic: actionable-ide-diagnostics
sources: [M11, ADR-0166, docs/backlog/epics/honest-compatibility-in-the-ide.md]
code: [apps/playground/src/components/ProblemsPanel.tsx, apps/playground/src/components/BottomPanel.tsx, apps/playground/src/glue/ts-diagnostics-sync.ts, apps/playground/src/App.tsx]
---

## Context

Introduce an app-internal `DiagnosticRecord`/store with stable source identity, category (`typescript|install|runtime|compatibility|preview`), project/run scope, severity, provenance, lifecycle (`active|resolved`), and only source-valid actions (`open file`, `open terminal run`, `retry`, `copy`). Migrate current TS records through an adapter without widening the TS language-service package.

Records persist until their source reports resolution, project switch scopes them correctly, and duplicates upsert by source identity. Until whole-project TS analysis exists, the empty state says `No problems in open files`; an unavailable/partial source is visible, never folded into an all-clear.

## Reversibility

REVERSIBLE app-internal model/UI. A later public diagnostic contract would be a separate irreversible decision.
