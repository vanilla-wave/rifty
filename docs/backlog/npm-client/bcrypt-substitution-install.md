---
area: npm-client
status: draft
title: Installing bcrypt yields the bcryptjs substitution instead of a failed install
created: 2026-10-16
why: the baked `bcrypt → bcryptjs` override reuses the requested range for `bcryptjs` (newest 3.0.3) and the latest-request path loses the top-level lock version, so every realistic `bcrypt` install fails while the compat page claimed ✅ auto-shimmed (corrected to ❌ 2026-10-16)
user_story: As a developer installing an Express app that depends on `bcrypt`, I want the declared bcryptjs substitution to install and run, but today `npm install bcrypt` fails with `Installed package bcrypt has no top-level lock version` and `bcrypt@5.1.1` with `No matching version for bcryptjs@5.1.1`
blocked_by: []
sources: [ADR-0006, ADR-0051, docs/backlog/npm-client/reference/registry-package-adaptations-evidence.md]
code: [tools/shadow-registry/src/index.ts, packages/npm-client/src/overrides.ts]
---

## Context

Observed 2026-10-16 (Chromium browser-unit scratch, hidden-empty template,
branch `t3/honest-adaptations-location`):

```
$ npm install bcrypt
npm: + bcryptjs@3.0.3
npm: bcrypt@latest → bcryptjs@3.0.3 (substituted from shadow registry, ADR-0051)
npm: install failed: Installed package bcrypt has no top-level lock version
$ npm install bcrypt@5.1.1
npm: install failed: No matching version for bcryptjs@5.1.1
```

Registry: `bcrypt` latest 6.0.0; `bcryptjs` newest 3.0.3. `parseTarget`
(`overrides.ts`) keeps the edge range when the override names no range; the unit
test pins `bcrypt: '*'` for that reason. Two defects: the range mapping and the
latest-request lock path. Found by the inventory sweep of goal
`honest-guest-package-adaptations` I3 (the row records it). Route: `rifty-fix`
with a real-Node baseline (`npm install bcrypt` + `bcryptjs` API parity).

## Challenge

challenge: 2026-10-16 — not run (draft)
