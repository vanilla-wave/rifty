# ADR 0459: Expose unsupported HTTP Agent construction as a named ceiling

Status: Accepted
Date: 2026-09-23

## Context

Installed Vitest browser provider + playwright1.60.0 loads agent-base, whose
class extends http.Agent. Rifty's absent property causes an unrelated TypeError
before any browser launch. Native Node24.16.0: Agent is a function, default and
named exports are identical, subclassing is valid. No socket pool is provided
by the browser-fetch HTTP carrier (ADR-0010, ADR-0181).

## Decision

One Agent constructor owner, shared by default HTTP and compatibility facades.
Loading/subclassing succeeds; construction, including subclass super(), throws
NotImplementedError('node:http.Agent'). No fake socket state or pooling API.
This extends the existing HTTPS Agent ceiling pattern; neither prior ADR is
overturned. Real pooling remains unclaimed.

## Evidence

`packages/net/src/http/agent.test.ts`: native shape, rifty RED then named ceiling.
Actual installed-browser probe: Vitest4.1.11/Vite8.0.16,
@vitest/browser-playwright4.1.11/playwright1.60.0, fresh Chromium5433:
`agent-base/dist/index.js` extends undefined at utilsBundle.js:2152.
Leaving the member absent fails with TypeError; fake Agent state would claim a
socket owner that does not exist. A constructor ceiling is the smallest honest
surface. Public compat remains ❌.
