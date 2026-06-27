---
area: toolchain-build
status: draft
title: TS language service — inlay hint label-part metadata
created: 2026-06-24
why: TS inlay hints can carry interactive display parts with file/span metadata, but rifty's current LSP shape exposes string labels only
user_story: As a rifty editor/agent user, I want clickable inlay-hint label parts that preserve TypeScript display-part metadata, but today labels are flattened to text for Monaco display.
sources: [ADR-0166, docs/public/compat/ts-language-service.md]
code: [packages/ts-language-service/src/mapping.ts, packages/ts-language-service/src/lsp-types.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

The shipped inlay-hint path is real TS (`provideInlayHints`) and parity-covered
for position, label text, kind, padding, and clone-safe preferences. It is not a
full label-part protocol: `ts.InlayHint.displayParts` can include spans/files for
interactive labels, while rifty currently serializes `InlayHint.label` as a
string and Monaco renders that string.

This is parked, not a hidden ✅. Keeping a string label is faithful for visible
hints, but not for interactive metadata.

## Options or Next

Add an LSP-shaped label-part type, preserve display-part spans/files through the
worker protocol and page client, then wire Monaco command/link behavior where
standalone Monaco allows it. Keep the existing string label as the fallback.

## Reversibility

REVERSIBLE — additive protocol field + Monaco/provider behavior. Tracked here;
no ADR unless the public SDK shape becomes externally consumed.
