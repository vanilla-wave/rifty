---
area: toolchain-build
status: draft
title: Committed-lockfile registry-host guard
created: 2026-08-19
why: A committed package-lock fixture recorded corporate-mirror `resolved` URLs (46/46 in tests/e2e/fixtures/npm-lock-replay/vite8) and merged green from the corp network while unreachable from CI runners — the root `.npmrc` guard protects only the repo's own pnpm-lock.yaml, never committed fixtures.
sources: [PR #266 post-merge repair 2026-08-19, tests/e2e/npm-lock-replay.spec.ts]
---

## Context

Fault class `frozen-assumption` on the committed-fixture trust boundary: a
fixture generated on a mirror-configured machine pins environment-specific
state no gate verifies. Class-kill chokepoint: one repo check (pr:check lane)
that scans every committed `package-lock.json` / lockfile-bearing fixture and
refuses `resolved` hosts outside `registry.npmjs.org` (allowlist
env-extensible per D-004 if a test ever needs a second public host).

Known clean today: `tests/e2e/fixtures/npm-lock-replay/{vite8,weavix}` (vite8
re-pointed in the PR that carries this draft), baked snapshot locks under
`apps/playground/public/snapshots/` (written by rifty's own installer against
REGISTRY_BASE_URL default npmjs). The guard's value is refusing the NEXT
mirror-poisoned fixture at commit time instead of at post-merge CI triage.
