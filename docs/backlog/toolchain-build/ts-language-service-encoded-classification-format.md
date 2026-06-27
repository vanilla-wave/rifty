---
area: toolchain-build
status: draft
title: TS language service — encoded classification format knob
created: 2026-06-24
why: Monaco semantic tokens require TS 2020 encoded classifications, but raw TS defaults to Original format when no encoded format is passed
user_story: As a headless rifty TS client, I want encoded semantic classifications in the same default/original format real TS returns, but today the encoded semantic path is explicitly TS 2020 for Monaco.
sources: [ADR-0166, docs/public/compat/ts-language-service.md]
code: [packages/ts-language-service/src/service.ts, packages/ts-language-service/src/lsp-types.ts, apps/playground/src/glue/ts-ls-monaco-providers.ts]
---

## Context

The shipped Monaco semantic-token provider uses `getEncodedSemanticClassifications`
with `SemanticClassificationFormat.TwentyTwenty`, because Monaco's token stream is
the TS 2020 encoding. Raw `getSemanticClassifications` /
`getSyntacticClassifications` already expose the clone-safe format option.

The remaining gap is the encoded semantic helper's format parameter/default
parity for non-Monaco clients. It is parked and documented as a ⚠️ row, not
claimed as a full ✅.

## Options or Next

Extend the encoded classification request/options shape with
`format?: 'original' | '2020'`, preserve the current Monaco caller's explicit
`2020`, and add parity for default/original encoded semantic output.

## Reversibility

REVERSIBLE — additive protocol/client option. Tracked here; no ADR unless this
becomes an externally versioned SDK contract.
