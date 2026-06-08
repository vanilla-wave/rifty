---
area: runtime-js
status: parked
title: Import attributes (with { type: 'json' })
created: 2026-06-08
why: import attributes syntax unsupported — compat row ❌ Deferred until needed
sources: [compat/modules.md]
---
## Context
The loader does not handle the import-attributes syntax `import x from './x.json' with { type: 'json' }` (and the dynamic `import(spec, { with: { type } })` form). docs/public/compat/modules.md row: Import attributes (`with { type: 'json' }`) ❌ Deferred until needed. JSON modules themselves already load (✅ via `require` and `import`); this is the standardized attribute syntax on top. Note ADR-0068 already handles esbuild/Bun `with { type: 'file' }` asset attributes in the transformer — the JSON `type` attribute is the open gap.
## Options / Next
Next (when a consumer needs it): parse the `with`/`assert` attribute clause in the acorn ESM rewriter and honor `type: 'json'` (validate against the resolved kind, reject mismatches per Node). Add a parity case once a real package imports JSON via attributes. Until then, plain JSON import works without the clause.
## Reversibility
Reversible — additive parse + validation in the ESM rewriter, no cross-package API, no dep. Gate: a package that uses the attribute syntax. ADR-0068's `with { type: 'file' }` path is precedent for attribute handling.
