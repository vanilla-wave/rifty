---
area: distribution
status: draft
title: M12 — AI-first IDE agent harness on Pi (pi-agent-core) over the rifty sandbox
created: 2026-06-13
why: build an in-browser AI coding agent for Node projects whose only external dep is an OpenAI-compatible endpoint; chosen over the opencode facade (whose tool layer needs native spawn — a browser ceiling)
user_story: As a dev shipping an in-browser AI coding agent on rifty, I want to embed `pi-agent-core` + `pi-ai/openai-completions` with rifty primitives wrapped as `AgentTool`s (vfs read/write/edit, `shell_exec`, grep, git, typecheck) talking to my OpenAI-compatible endpoint, but today the Pi harness is unbuilt — streaming over the SW-bridge unproven and the dep choice still provisional, not ratified.
sources: [M12, docs/research/open-webcontainers-alternative-2026-06.md, docs/backlog/distribution/public-api-ai-agent-exec-preview.md, docs/backlog/distribution/public-api-ai-agent-contract-snapshot-restore.md, docs/backlog/distribution/workbench-controllers.md]
code: [packages/rifty/src/sandbox.ts]
---

## Context

M12 builds the actual AI coding agent ON TOP of M11's AI-agent sandbox contract
(exec → preview → snapshot — `distribution/public-api-ai-agent-*`). Not a new runtime;
a consumer of it.

Direction (provisional — promote to an ADR when the track starts):

- **Pi, not opencode.** Embed `@earendil-works/pi-agent-core` (the agent loop —
  verified browser-clean: only `fetch` + typebox/yaml; node-coupling sits behind a
  `./node` subexport off the main barrel) + `@earendil-works/pi-ai/openai-completions`
  (the SUBPATH — the main `pi-ai` entry eagerly pulls aws/smithy/google/mistral).
  opencode's Effect/Bun server + native-spawn tool layer is a browser ceiling plus a
  permanent 900-file vendoring liability; Pi's tools are plain pluggable functions, so
  the swap is its PUBLIC extension API, not surgery. Fallback: raw Vercel AI SDK
  (known-good in rifty) + harvest Pi's prompt/edit (MIT) if the live streaming spike fails.
- **AI lives OUTSIDE rifty.** Litmus: "does this make sense with no AI at all?" Yes →
  rifty (VFS/shell/git/lsp/search/IDE-kit); No → here. The harness, tool-bindings,
  prompts, and OpenAI config consume only `@riftydev/*` public API (a down-dep; the
  no-reverse-imports hard rule keeps AI out of the runtime). Start co-located as an
  `apps/` consumer or a separate repo — the boundary is identical.

Tool-bindings (AI side): wrap rifty primitives as Pi `AgentTool`s — vfs read/write/edit
(node:fs→VFS), shell_exec (rifty shell, not spawn), grep (existing shell grep / runtime
vfsGrep), git (shell/git-command-isomorphic), typecheck (toolchain-build/ts-language-service).

## Options or Next

- De-risk #1 (live): OpenAI streaming over the SW-bridge (CORS / SSE / ReadableStream) — a non-streaming round-trip first.
- Bundle-check that the `pi-ai/openai-completions` subpath excludes aws/smithy/google/mistral.
- Point the client: a generic openai-compatible provider, `model.baseUrl` = endpoint, key via options (not env).
- Session: `InMemorySessionRepo`, or a VFS/OPFS-backed `SessionStorage` (storage injectable — data on rifty, schema here). Context compaction is already in Pi core.
- UI + orchestration are tracked separately (ai-ide-product-ui, ai-agent-subagent-orchestration).

## Reversibility

IRREVERSIBLE — new external dep (Pi) + a genuine product-direction choice + a new
top-of-stack consumer. Promote this direction to an ADR when the track starts (citing
the dropped opencode-facade exploration it supersedes).
