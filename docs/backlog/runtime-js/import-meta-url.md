---
area: runtime-js
status: active
title: import.meta.url support in the ESM loader
created: 2026-06-08
why: import.meta.url is unimplemented — compat row ❌ Pending
sources: [compat/modules.md, TASKS M3 follow-up]
---
## Context
The ESM loader does not populate `import.meta.url`. docs/public/compat/modules.md row: `import.meta.url` ❌ Pending. M3 follow-up in docs/ROADMAP.md. Packages computing a module-relative path/dirname (common ESM idiom, `new URL('.', import.meta.url)`) get no usable value. Distinct from CJS `__dirname`/`__filename`.
## Options / Next
Next: synthesize `import.meta.url` from the module's absolute resolved id as a `file:` URL in the ESM execution wrap; mirror `import.meta` shape Node exposes for ESM. Add a parity case (Node ESM vs rifty) reading `import.meta.url` + a `new URL('./x', import.meta.url)` derivation. Flip the compat row to ✅ on landing.
## Reversibility
Reversible — additive to the ESM module wrap, no cross-package API change, no dep. Honest value derived from the real resolved path (no stub).
