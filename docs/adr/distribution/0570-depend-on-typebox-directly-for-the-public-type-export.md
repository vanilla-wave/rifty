# ADR 0570: Depend on typebox directly for the public Type export

Status: Accepted (user-confirmed 2026-11-23)
Date: 2026-11-23

> TL;DR: Keep `Type` in `@riftydev/agent`'s public API by depending on `typebox`
> 1.3.27 directly; pi-ai 1.x no longer re-exports it.

## Context

`@riftydev/agent@0.11.0` is published and re-exports `Type` from pi-ai 0.85.1
(typebox 1.3.7 transitively). pi-ai 1.6.0 dropped `Type`/`Static`/`TSchema`;
agent-core 1.5.0 types `AgentTool.parameters` as any JSON Schema validated by
`@earendil-works/pi-schema` (`compile(schema, { coerce: true })`).

## Decision

1. `typebox` 1.3.27 (the version pi-coding-agent 1.6.0 pins) is a direct exact
   dependency; `index.ts` re-exports `Type` unchanged; internal tools keep TypeBox.
2. Proof by run, not reading: `packages/agent/src/typebox-tools.test.ts` replays
   `docs/backlog/distribution/reference/pi-0.85.1-typebox-tool-probe.json`
   (captured on origin/main 11b9397ee, pi 0.85.1): same wire declaration except
   pi 1.x omitting `strict: false`, same accept/reject and coerced arguments for 8
   cases. Failure wording is pi-schema's ("missing", "expected >= 0").

3. pi-ai 1.5.0 no longer runs TypeBox's validator. Differential probe
   (`docs/backlog/distribution/reference/pi-typebox-validation-diff.json`, 20 kinds):
   only `Type.Refine` refinements and `Format.Set` custom formats stop applying
   silently; `Void` now rejects loudly; Codec, BigInt, Undefined, unions, built-in
   formats, patterns validate as before. Tool schemas carrying a refinement or a
   custom-registered format throw `NotImplementedError('agent.tool-schema-typebox-only')`
   at session creation; the guard walks schema keywords only (not `examples`,
   `default`, property names). Restoring 0.85.1 TypeBox validation rifty-side is the
   user's call (open in the PR).

2026-11-23 correction (review of PR #423): the first guard also refused Codec/BigInt/Undefined/Void and walked data positions; replaced by the probe-derived guard above.

## Alternatives

- Remove `Type`: breaks 0.11.0 consumers (user's call).
- Re-export pi-schema builders: new API; `obj()` is closed by default.

## Consequences

- One more direct dependency (already in the lockfile via pi-coding-agent).
- Consumers may also pass any JSON Schema object; documented in the package CHANGELOG.

## Corrections

2026-11-23 — user confirmation: «тут ок» (answer to «typebox прямой зависимостью (ADR-0570)…»), then «все ок. Мержи и закрывай все связанные t3 треды» (answer to «3. Схемы TypeBox: оставить отказ или вернуть валидацию…»). Manager's reading: this ADR is confirmed and the loud `NotImplementedError` for `Type.Refine`/custom formats stays.
