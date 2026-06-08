---
area: runtime-js
status: parked
title: Buffer pending statics — poolSize / constants / transcode / kStringMaxLength / kMaxLength
created: 2026-06-08
why: unimplemented Buffer surface awaiting a real consumer — compat rows ❌ Pending
sources: [compat/buffer.md]
---
## Context
Open ❌ rows in docs/public/compat/buffer.md (stable public matrix): `Buffer.poolSize` + `Buffer.constants` (no real consumer hit yet), `Buffer.transcode(buffer, fromEnc, toEnc)`, and the `kStringMaxLength` / `kMaxLength` constants. The Buffer class itself (real Uint8Array subclass, ADR-0030) is otherwise implemented/tested; these are the residual static surface no package has forced yet.
## Options / Next
Next (per consumer that hits one): expose `Buffer.poolSize`/`Buffer.constants`/`kMaxLength`/`kStringMaxLength` with honest values for the rifty environment; implement `Buffer.transcode` over the existing codec path (or throw `NotImplementedError('buffer.transcode')` until needed — no fake value). Flip the relevant compat row to ✅ on landing. Add per-method coverage only when a real failure mode is articulable (don't bulk-implement to fill the matrix).
## Reversibility
Reversible — additive statics on the existing Buffer surface, no cross-package API change, no dep. Gate: a real consumer. `transcode` must be loud-throw if deferred, never a placeholder.
