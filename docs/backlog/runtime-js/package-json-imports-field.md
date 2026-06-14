---
area: runtime-js
status: active
title: package.json imports field (#name internal subpath imports)
created: 2026-06-08
why: #-prefixed internal subpath imports are unsupported — compat row ❌ Pending
user_story: As a dev importing a `#name` internal subpath (or `#name/*` wildcard) declared in a package's `imports` map, I want it to resolve like `exports` does — but today only `exports` is wired so any `#`-prefixed specifier fails to resolve.
sources: [compat/modules.md, TASKS M2/M3 follow-up]
---
## Context
The resolver implements `exports` (string/subpaths/conditional/wildcards, all ✅) but NOT the `imports` field: a `#name` specifier resolved against the nearest `package.json` `imports` map (with the same condition matching as `exports`). docs/public/compat/modules.md row: `package.json` `imports` (`#name`) ❌ Pending; Known-limitations §"subpath imports starting with `#` not yet wired". Same concept as the M2/M3 follow-up — one item.
## Options / Next
Next: extend `resolveSpecifierToFile` — when a specifier starts with `#`, find the package scope, read its `imports` map, apply the existing condition/wildcard matching used for `exports`, resolve the target. Add a parity case (Node vs rifty) covering a `#name` import + a `#name/*` wildcard + a conditional (`node`/`default`) `imports` entry. Flip the compat row to ✅.
## Reversibility
Reversible — additive resolver logic reusing the existing `exports` condition matcher, no new export, no dep. Edge: scope walk-up + condition precedence must match Node — parity case guards it.
