---
area: npm-client
status: draft
title: Self-map user override skips the native-package gate
created: 2026-08-23
why: any truthy override bypasses assertNativeSupported, so a per-package self-map (the documented escape hatch after the disable-flag decline) lets a native package slip past the loud install-time error and fail deeper with an unrelated message — a silent-gap violation of the loud-throw rule
sources: [ADR-0006 correction 2026-08-23, refine 2026-08-23]
code: [packages/npm-client/src/installer.ts]
---

## Context

Finding (observed): `installer.ts` gates native packages only when no override
matched — `if (!override) assertNativeSupported(...)` at both call sites
(registry pick and lockfile entry paths, installer.ts:2721/:2950 @ c37ff91cc).
A user self-map override (`overrides: {esbuild: 'esbuild'}`) — the remaining
escape hatch per the ADR-0006 correction — therefore installs a native package
without the loud `NotImplementedError` the gate exists to raise; the failure
surfaces later as an unrelated runtime error. Expected: override changes the
resolution, not the honesty gate — a native resolution loud-fails identically
with or without an override.
