# ADR 0190: AI mode on Pi agent loop as a playground app-level consumer

Status: Active
Date: 2026-07

> TL;DR: the in-playground AI coding agent embeds Pi (`@earendil-works/pi-agent-core`
> + `@earendil-works/pi-ai` via the `api/openai-completions` subpath) as an
> app-level consumer in `apps/playground`; zero AI code or deps in `@riftydev/*`.

## Context

M12 needs a real in-browser coding agent (epic `ai-mode-mvp`): chat over the live
playground project — edit files, run shell, verify preview — plus an external bench
measuring rifty vs a local reference. Building an agent loop from scratch duplicates
solved work; embedding one raises two irreversible choices: which loop, and where AI
lives relative to the rifty runtime.

Prior exploration (backlog `ai-ide-pi-agent-harness`, now folded into this ADR +
`distribution/ai-mode-playground`): opencode's Effect/Bun server + native-spawn tool
layer is a browser ceiling and a ~900-file vendoring liability. Pi's tools are plain
pluggable functions; the swap is its public extension API.

Verified against 0.80.3 tarballs + live runs (2026-07-02):

- `pi-agent-core` deps (`pi-ai`, `ignore`, `typebox@1.1.38`, `yaml`) are
  browser-safe; node-coupling isolated behind the `./node` subexport.
- `pi-ai` heavy provider SDKs (aws/smithy/google/mistral/anthropic) load only via
  dynamic `import()` inside `api/*.lazy.js`; the static graph of
  `api/openai-completions` bundles for browser (esbuild `--platform=browser`,
  entry ~98 KB gz **with code splitting; splitting is mandatory** — monolith is 5.3 MB).
- `AgentTool` = typebox-typed `execute()` returning content parts; streaming via
  `agent.subscribe()` events (`message_update` text deltas, `tool_execution_*`,
  `agent_end`); abort, usage accounting, compaction built in.
- The provider takes arbitrary `baseUrl`/`apiKey`/`model` (OpenAI-compatible,
  SSE over fetch, `dangerouslyAllowBrowser` set by pi-ai itself).

## Decision

- **Pi, not opencode, not a hand-rolled loop.** Depend on
  `@earendil-works/pi-agent-core` + `@earendil-works/pi-ai` (exact-pinned; ESM-only;
  fast-moving upstream). Provider access ONLY through the
  `pi-ai/api/openai-completions` subpath — one streaming chat-completions contract,
  no provider zoo. Fallback recorded: raw Vercel AI SDK + harvest Pi's prompt/edit
  logic (MIT) if Pi breaks irreparably.
- **AI lives outside the runtime.** Litmus: "does this make sense with no AI at
  all?" Yes → `@riftydev/*`; no → AI mode. The agent, tool bindings, prompts,
  provider config live in `apps/playground` (top-of-stack consumer); they consume
  runtime capabilities via existing playground adapters (terminal manager, owner
  RPC fs, git bridge, ts-LS client, preview). The no-reverse-imports arch rule
  keeps AI out of `@riftydev/*` by construction.
- **Tools are the standard coding-agent surface** wrapping rifty primitives — no
  rifty magic the bench would then measure instead of the environment.
- **Prompt = Pi baseline + rifty compat adaptation only** (tool mapping, browser
  environment facts, preview-verification habit), versioned as a named profile —
  no benchmark tuning, so bench deltas measure the environment, not prompt drift.

## Consequences

- The playground gains its first AI dep; bundle impact contained by code splitting
  and lazy provider chunks; exact pins make upstream churn a deliberate bump.
- `@riftydev/*` packages stay AI-free; a future product IDE (ai-ide-product-ui)
  reuses the same boundary or moves the consumer out of the repo — the seam is
  identical.
- Local-reference bench lane can run Pi's own CLI (`pi-coding-agent`) with the same
  model/prompt profile — same loop both sides isolates the environment variable
  (ADR-0191).
- Supersedes the provisional direction in backlog `ai-ide-pi-agent-harness`
  (deleted; opencode facade dropped for the reasons above).
