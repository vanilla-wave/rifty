# ADR 0010: `node:https` registered as a loud-throw stub

Status: Implemented (2026-05-24)
Date: 2026-05

> TL;DR: `node:https` is a loud-throw stub: imports resolve and surface mirrors `node:http`, but every method throws `NotImplementedError` (no TLS in-browser)

> **Corrected 2026-06-28 (ADR-0181):** the "every method body throws" + "terminal state — no follow-up milestone" clauses (Decision bullet 2, Consequences bullet 4) are overtaken. `https.request`/`https.get` now route over host `fetch()` (the page does TLS) per ADR-0181. The rest of this ADR stands: `createServer`, `new Agent()`, and all TLS/socket options keep throwing `NotImplementedError`.

## Context

`packages/net/src/register-builtins.ts` previously aliased `node:https` to `node:http`. TLS is unavailable in the browser realm, so the alias silently stripped security semantics and let callers believe they were on an encrypted transport — a "no silent stubs" violation (CLAUDE.md hard rule).

Surfaced by REVIEW_ACTIONS A-011; Q-2026-05-23-006 asked alias vs. throw. The alias is rejected.

## Decision

Register `node:https` as a stub that loads but whose call sites throw:

- Imports (`import https from 'node:https'`, `import { request, createServer, get, Agent } from 'node:https'`) resolve at load time, so defensive top-level imports keep working (Vite's `try { require('node:https') } catch {}`, axios polyfills, Node feature-detection).
- Every method body throws `NotImplementedError('node:https.<method>', 'TLS termination is not available in the browser — use http and rely on page TLS')`.
- Surface mirrors `node:http` (`request`, `get`, `createServer`, `Agent`, `globalAgent`, `Server`) so property-access feature checks don't trip before the call.

## Consequences

- Defensive top-level imports load; only actual TLS use throws.
- Errors point at the missing capability, not the wrong layer.
- Code needing in-browser TLS breaks loudly at the call site instead of silently sending plaintext.
- Terminal state — no follow-up milestone. A new ADR supersedes this if in-browser TLS termination (e.g. WebTransport-based) enters scope.

## Acceptance criteria

- [ ] `import https from 'node:https'` succeeds without throwing.
- [ ] `https.request(...)` throws `NotImplementedError` with the documented message.
- [ ] `https.createServer(...)` throws `NotImplementedError`.
- [ ] Q-2026-05-23-006 moved to the "Rejected" section of `OPEN_QUESTIONS.md` with this ADR as the resolution.
