---
area: runtime-js
status: draft
title: node:crypto beyond the sync-hash subset (ciphers/KDF/sign)
created: 2026-06-11
why: crypto is a deliberate sync subset (sha256/sha1/md5 + HMAC + random); auth/JWT/cookie-signing libs need pbkdf2/scrypt/createCipheriv/sign — recorded so the deliberate limit is auditable, with the real cost (SubtleCrypto is async-only) noted
user_story: As a dev running a JWT/auth/session lib in rifty, I want `crypto.pbkdf2`/`scrypt`/`createCipheriv`/`sign` (AES-GCM, sha512); currently `node:crypto` is a sync subset (sha256/sha1/md5 + HMAC + random) and everything else loud-throws by design.
sources: [docs/research/open-webcontainers-alternative-2026-06.md, ADR-0010]
code: [packages/runtime-js/src/builtins/crypto.ts]
---

## Context

`crypto.ts` implements a documented sync subset — pure-JS sha256/sha1/md5 + HMAC + `getRandomValues`-
backed random — because SubtleCrypto is async-only and Vite (the primary consumer) needs synchronous
hashing. Everything else (pbkdf2/scrypt/hkdf, `createCipheriv`/`Decipheriv` AES-GCM/CBC, sign/verify,
`generateKeyPair`, sha512/384) loud-throws by design (the same loud-throw posture as ADR-0010). This
is correct today, but auth/session/JWT/cookie-signing libraries remain a real consumer class for
broader package compatibility. Expanding is NOT a thin SubtleCrypto mapping — the SYNC primitives
real code calls can't be backed by async SubtleCrypto on the calling worker, so it realistically
needs pure-JS implementations (as already done for the hashes), with correctness/timing risk.
Parked: record the deferral + its gate; don't build speculatively.

## Options or Next

- Gate: a verified consumer needing sync ciphers/KDF/sign (a JWT/auth library in a target project).
- Then: pure-JS sync primitives where SubtleCrypto can't be used sync; map async-tolerant paths onto
  SubtleCrypto; keep unmapped algorithms loud.

## Reversibility

REVERSIBLE — additive builtins behind a verified-need gate. Recorded here.
