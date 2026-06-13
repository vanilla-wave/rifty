---
area: npm-client
status: active
title: Shadow-registry substitution has no debug-disable flag promised by ADR-0006
created: 2026-06-13
why: ADR-0006 Mechanism promises 'A flag disables it for debugging' but no such flag exists — InstallOptions has no disable/bypass field, resolveOverride is consulted unconditionally, and RIFTY_*SHADOW/disableOverrides finds nothing repo-wide; the ADR claims an escape hatch that does not exist.
sources: [ADR-0006]
code: [packages/npm-client/src/installer.ts, packages/npm-client/src/overrides.ts]
---

## Context

When a baked substitution misbehaves, an operator cannot install the real package to compare/debug except by editing the baked table or self-mapping. The self-map workaround (user override wins) only suppresses one baked entry, gives no global off-switch, and even a self-map still hits the native-package gate at installer.ts:833 (override truthy -> assertNativeSupported skipped, so a native pkg slips through rather than erroring cleanly). Low severity: niche debug ergonomics, per-entry workaround available.

## Options or Next

Add disableShadowRegistry?:boolean (or env-gated) to InstallOptions; when set, skip resolveOverride's baked layer (decide in ADR whether explicit user overrides still honored). Wire through createRegistrySource (installer.ts:803), applyOverridesToRequest (:887), and the lockfile fast-path override check (:918). Alternatively amend ADR-0006 to drop the 'flag disables it' sentence if the escape hatch is judged unnecessary.

## Reversibility

REVERSIBLE — backlog item; additive opt-in option, no public-contract change; alternatively a one-line ADR doc correction.
