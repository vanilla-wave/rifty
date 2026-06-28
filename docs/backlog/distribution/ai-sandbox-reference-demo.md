---
area: distribution
status: draft
title: AI-sandbox reference demo — LLM-generated Node runs client-side
created: 2026-06-28
why: OSS agent-builders refusing closed/metered WebContainers have no working open reference that runs LLM-generated Node client-side — but the live-preview path is not yet reachable through public @riftydev/* API
user_story: As an OSS AI-tool builder, I want a working open reference where an LLM writes a Node/Express app that npm-installs and previews in my own browser tab with my key never leaving the page, but today rifty ships no such demo and the eval-booted-server→preview path is not public.
epic: open-bolt-ai-sandbox-demo
blocked_by: [distribution/public-api-ai-agent-exec-preview]
sources: [docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/distribution/public-api-ai-agent-exec-preview.md]
code: [packages/npm-client/src, packages/rifty/src/sandbox.ts, tests/e2e/fullstack-demo.spec.ts]
---

## Context

This is a `draft`, not `ready`: two gaps keep an implementer from building it whole.

1. **Live preview is NOT public.** The public `Sandbox` surface is `runtime.eval` + events + `fs` (`packages/runtime-js/src/host.ts`). An eval'd server's `listen()` registers its port only in the runtime-js worker realm's net registry; nothing installs a cross-realm preview-port handler there — that wiring is playground-private (`apps/playground/src/workers/node-program-lifecycle.ts`, `glue/preview-bridge-wiring.ts`) and not exported. The booted-server→SW-preview path therefore needs the parked, IRREVERSIBLE `distribution/public-api-ai-agent-exec-preview` (its draft notes "preview wiring stays SW/host-route specific"). Hence `blocked_by`.
2. **Install→eval via public API is UNPROVEN.** Only fs round-trip + eval stdout are e2e-proven (`tests/e2e/sandbox-fs-rpc.spec.ts`). `@riftydev/npm-client.install()` + `RegistryClient` are public exports, but no e2e proves a consumer can install into the VFS and then `eval()` code that `require()`s the installed deps end-to-end. `tests/e2e/fullstack-demo.spec.ts` drives the PLAYGROUND owner-realm install+preview, NOT the consumer createSandbox path — so it is not the model for this demo's transport.

What IS public + proven today: `createSandbox` + `eval` + `fs` + events; the npm CORS proxy (`registry.rifty.dev`, M9); Express@4 + SW preview *in the playground* (not via createSandbox).

## Options or Next

- Spike the install→eval-`require` path against public API only (no playground glue). If it works, the **code-runner slice** — LLM → stream code → `npm install` via `@riftydev/npm-client` → `eval()` runs it → stdout/result streamed to the UI, NO live web preview — can split off as its own `ready` item.
- The **live web-app preview** (the full "bolt.diy that runs") is gated on `distribution/public-api-ai-agent-exec-preview`: open that ADR (exec-streaming + normalized preview URL) first, then this demo consumes it.
- Demo lives in `examples/` (in-repo consumer, CI-tested), framework-free or Monaco (non-solid, D-002). Key in-memory only (never OPFS/logged). Responses bounded/finite-SSE (unbounded → HTTP 502). README must state the eval-vs-exec gap and that npm tarballs transit the proxy origin (so "$0 self-host" = stand up your own proxy too).
- Out of scope regardless: host-operator resource containment (trust-model is cooperative-only — never imply safe for hostile/multi-tenant code); the Pi harness; a create-rifty scaffold.
- The spike's purpose (recorded in the epic): count inbound exec-streaming vs snapshot/fork asks to decide which IRREVERSIBLE ADR to open first.

## Reversibility

The example code is REVERSIBLE (a consumer in `examples/` adds no public API → CHANGELOG line). But its headline live-preview outcome depends on the IRREVERSIBLE `distribution/public-api-ai-agent-exec-preview` (own ADR) — so this stays `draft` until that lands, or until the scope is cut to the public-API-achievable code-runner slice (which itself needs the install→eval spike above to pass first).
