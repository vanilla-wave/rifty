---
area: playground
status: parked
title: TS refactor interactive/post-edit-rename UI
created: 2026-06-24
why: the TS service preserves interactive refactor metadata, but standalone Monaco code actions only apply plain text edits without a custom prompt/rename flow
user_story: As a playground user, I want interactive TS refactors such as move-to-file and post-edit rename to prompt for arguments or continue the rename flow, but today Monaco only applies text-only non-interactive refactors.
sources: [ADR-0166, docs/public/compat/ts-language-service.md]
code: [apps/playground/src/glue/ts-ls-monaco-providers.ts, packages/ts-language-service/src/service.ts]
---

## Context

The engine/protocol/client exposes real TS refactor actions, edits, commands,
not-applicable reasons, interactive arguments such as `targetFile`, and
post-edit rename metadata. The Monaco provider intentionally filters editor
actions that need side-effect commands, interactive arguments, or post-edit
rename so the UI never fake-applies a partial refactor.

This is a product UI gap, not missing TS engine fidelity. It is parked until the
playground has a custom prompt/rename continuation path.

## Options or Next

Build a custom refactor command UI over the existing page client: prompt for
interactive arguments, apply the returned workspace edit atomically, and start a
follow-up rename session when TS returns `renameLocation`/`renameFilename`.

## Reversibility

REVERSIBLE — additive playground UI over the shipped protocol. Recorded here; no
ADR unless it adds public app APIs.
