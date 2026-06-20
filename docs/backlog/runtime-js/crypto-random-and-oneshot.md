---
area: runtime-js
status: parked
title: crypto async/one-shot randoms over existing sync cores
created: 2026-06-20
why: thin async wrappers + one-shot helpers over already-shipped sync getRandomValues + createHasher cores; missing callback/randomInt/one-shot surface
user_story: As an Express/CSRF/token-gen user, I want crypto.randomBytes(size, cb) / randomInt / crypto.hash, but today only the sync forms exist so callback-style libs (session, csurf) crash
sources: [docs/research/node-parity-gaps-unbacklogged-2026-06-20.md §4]
code: [packages/runtime-js/src/builtins/crypto.ts]
---

## Context

Sync cores shipped: `getRandomValues` (crypto.ts:133, browser-native) backs `randomBytes` (:114) + `randomFillSync` (:120); `createHasher` (:269) backs Sha256/Sha1/Md5 + loud-throws unknown algo. Gaps = async wrappers + one-shot helpers, all thin over these cores:

| Feature | Node API · since | Real path · anchor |
|---|---|---|
| randomBytes async (callback overload) | v0.5 | `queueMicrotask` over sync fill → `cb(null,buf)`; throw on `size>kMaxLength` like Node. crypto.ts:114 |
| randomInt([min,]max[,cb]) | v14.10 | pure-JS rejection sampling over getRandomValues → unbiased uniform int; RangeError bad bounds; `(err,n)` cb overload. crypto.ts:133 |
| crypto.hash (one-shot) | v20.12/21.7 | sync wrapper over createHasher (unsupported algo already loud-throws). crypto.ts:269 |
| randomFill async (callback) | v7.10 | reuse randomFillSync then `queueMicrotask`→cb; pairs w/ randomBytes-async. crypto.ts:120 |

DISTINCT from `runtime-js/crypto-sync-subset-expansion` (ciphers/KDF/sign/sha512) — no overlap; and from the loud-stub item (Hash.copy only). No fidelity ceiling: faithful, no platform dep.

## Options or Next

Parity-first, per-feature promotable: failing parity test (vs real Node async contract / randomInt distribution / hash digest) → implement wrapper over existing core. randomBytes-async + randomFill-async land together (shared microtask seam). randomInt distribution test must assert unbiasedness near power-of-two boundaries.

## Reversibility

REVERSIBLE — recorded in this backlog item. Additive public surface over existing cores; no API removal, no ADR.
