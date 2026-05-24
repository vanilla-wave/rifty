# ADR 0010: `node:https` registered as a loud-throw stub

Status: Implemented (2026-05-24)
Date: 2026-05

## Context

`packages/net/src/register-builtins.ts` previously registered `node:https` as a silent alias of `node:http`. TLS is not available in the browser realm — the alias quietly stripped the security semantics and let calling code believe it was on an encrypted transport. This violates the CLAUDE.md hard rule "no silent stubs": placeholders that return plausible-looking values create subtle bugs downstream.

REVIEW_ACTIONS entry A-011 surfaced the issue; OPEN_QUESTIONS entry Q-2026-05-23-006 had asked whether to alias or to throw. The alias path is rejected.

## Decision

Register `node:https` as a stub module that loads successfully but whose call sites throw:

- `import https from 'node:https'` and `import { request, createServer, get, Agent } from 'node:https'` resolve at module-load time. Defensive top-level imports in real packages (Vite's defensive `try { require('node:https') } catch {}`, axios polyfills, generic Node feature-detection) keep working.
- Every method body throws `NotImplementedError('node:https.<method>', 'TLS termination is not available in the browser — use http and rely on page TLS')`.
- Exposed surface mirrors the `node:http` shape (`request`, `get`, `createServer`, `Agent`, `globalAgent`, `Server`) so that property-access feature checks don't trip before the call.

## Consequences

- Defensive top-level imports load; only actual TLS use throws.
- Error messages point at the missing capability rather than the wrong layer.
- Code that genuinely needs in-browser TLS termination breaks loudly at the call site instead of silently sending plaintext.
- No follow-up milestone. This is the terminal state until in-browser TLS termination (e.g. WebTransport-based) enters scope; at that point a new ADR supersedes this one.

## Acceptance criteria

- [ ] `import https from 'node:https'` succeeds without throwing.
- [ ] `https.request(...)` throws `NotImplementedError` with the documented message.
- [ ] `https.createServer(...)` throws `NotImplementedError`.
- [ ] Q-2026-05-23-006 is moved to the "Rejected" section of `OPEN_QUESTIONS.md` with this ADR as the resolution.
