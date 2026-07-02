---
area: distribution
status: ready
title: AI mode in the playground — chat + vibe views, Pi agent loop, standard coding-agent tools
created: 2026-07-02
why: M12 needs a real in-playground agent to measure and to try by hand; the MVP-shaped concretization of the Pi direction ratified in ADR-0190
user_story: As a playground user, I want to toggle AI mode and vibecode my project via chat while the agent edits files, runs shell, and verifies the preview, but today the playground has no agent at all
epic: ai-mode-mvp
blocked_by: []
sources: [ADR-0190, docs/backlog/epics/ai-mode-mvp.md]
code: [apps/playground/src/App.tsx, apps/playground/src/adapters/terminal-manager.ts, apps/playground/src/glue/owner-rpc-fs.ts, apps/playground/src/glue/git-owner-port.ts, apps/playground/src/glue/ts-ls-client.ts, apps/playground/vite.config.ts]
---

## Context

Full AI mode, not a stub — app-level consumer in `apps/playground`, zero AI in
`@riftydev/*` runtime packages (ADR-0190; no-reverse-imports keeps it honest).
Integration seams already exist: `TerminalManager.runLine` (shell, exit code +
streamed chunks), `SnapshotFs` (sync reads), `OwnerRpcFs` (acked writes),
same-origin preview iframe, `TsLanguageServiceClient` (diagnostics),
`bridgeGitOwnerRpc` (diff/show for trace), localStorage settings pattern,
vite dev proxy (`/npm-registry` precedent for the AI CORS proxy).

## Acceptance

- AI mode toggle in the playground with two views, both shipped: **"+chat"** (full
  IDE + chat panel) and **"vibe"** (chat + preview only; editor/terminal hidden).
  Layout state persists like existing layout signals.
- Settings UI: `baseUrl` / `apiKey` / `model` against any OpenAI-compatible
  endpoint; stored via localStorage; key never appears in traces or exports.
  Dev-only vite proxy route for CORS-blocked providers, config-driven (D-004).
- Agent loop = Pi (`@earendil-works/pi-agent-core` + `@earendil-works/pi-ai`
  `api/openai-completions` subpath, exact-pinned, per ADR-0190). Chat renders
  streamed text deltas live; each tool call shows name + args + collapsed result;
  Stop aborts the run; done = final assistant message without tool calls.
- Per-run limits (max tool calls, wall clock) enforced by the loop; exceeding
  surfaces as a distinct `budget-exceeded` state in chat and trace, never a
  silent stop.
- Tool surface (exact, all implemented, none stubbed): `shell`, `read_file`,
  `write_file`, `edit_file(old,new)`, `apply_patch` (unified diff),
  `list_files`, `grep`, `glob`, `preview_fetch`, `preview_query`,
  `preview_click`, `preview_type`, `diagnostics` (ts-LS). Tool results
  size-capped with explicit truncation markers; tool errors are thrown and
  rendered as errors, never empty-string successes.
- Agent session starts against the real workspace state: repo open, dev server
  possibly running — no bench-only environment.
- Writes land directly (no approve gate); SCM panel reflects agent edits; user
  can stop the run and reset the chat.
- Trace: one JSON per session — transcript, tool calls/results (size-capped),
  timings, token usage, terminal output of agent-run commands, final git diff,
  config snapshot without the key. "Export session" button downloads it;
  `globalThis.__riftyAgentBench.exportTrace()` returns the same object under
  `?agentBench=1` (ADR-0191).
- Prompt profile versioned in code as `pi-baseline+rifty-adapter-v1`: Pi baseline
  text (vendored, MIT) + rifty adapter block (tool mapping, browser environment
  facts, preview-verification habit). No benchmark-specific tuning.
- e2e (CI, no real model): mock OpenAI-compatible streaming endpoint drives a
  scripted session — send message → agent writes a file + runs a shell command →
  chat shows both tool calls → file content visible in editor/preview → exported
  trace contains transcript, tool calls, diff.
- AI mode code is lazy-loaded (dynamic import; Pi chunks split) — a session that
  never opens AI mode downloads none of it.

## Parity cases

Same observable behavior as human hands on the same runtime (each a test):

- `shell` tool running `node -e "console.log(1)"` yields the same stdout/exit
  code as the identical line typed into a user terminal (same pty path).
- `write_file` on a file the dev server watches triggers the same HMR/preview
  update as saving that edit in the editor.
- `edit_file` with a non-matching `old` string fails loudly with a
  string-not-found error (no fuzzy matching, no silent no-op) — matching real
  coding-agent edit-tool semantics.
- `diagnostics` on a file with a type error returns the same diagnostics the
  Problems panel shows for that file.
- Streaming works against a real OpenAI-compatible endpoint (manual check
  documented in the PR: one hosted provider or local llama.cpp/vLLM), not only
  against the e2e mock.

## Out of scope

- Provider zoo and auth flows: only the OpenAI-compatible chat-completions
  contract. Endpoints unreachable from the browser (CORS — e.g. Anthropic,
  Gemini direct) fail with an explicit error naming the dev-proxy escape hatch —
  never a silent hang.
- Approve/permission gate for writes and shell — deliberately absent (MVP
  safety = tab sandbox + trace + SCM diff + stop/reset).
- Subagent orchestration (`docs/backlog/distribution/ai-agent-subagent-orchestration.md`).
- Chat/session persistence across page reload — reload starts a fresh session;
  export is the persistence story. Attempting nothing; no half-restored state.
- Image/multimodal input; audio.
- Product IDE surface (`docs/backlog/distribution/ai-ide-product-ui.md`) — this
  is the playground MVP, not the product chrome.

## Decisions

- Loop/dep/boundary/prompt-profile/fallback: ADR-0190.
- Bench hooks contract (`__riftyAgentBench`, `?agentBench=1`): ADR-0191.
- Chat panel placement: right-side panel in "+chat" (coexists with preview);
  "vibe" = chat + preview split, layout-only difference — one runtime path.
- Shell tool uses a dedicated agent terminal session (visible in the terminal
  panel, labeled), commands serialized within the session; user terminals
  untouched.
- Tool results capped at 16 KiB per result with head+tail truncation and an
  explicit `[truncated N bytes]` marker; caps recorded in the trace.
- `apply_patch` accepts standard unified diff (what models emit); rejects on any
  hunk mismatch (no fuzz), reporting the failing hunk.
- Preview tools operate on the same-origin preview iframe DOM
  (`frame.contentWindow`); `preview_fetch` uses page `fetch` against
  `/preview/<port>/…`.
- Settings key `rf.ai.v1` in localStorage via the existing safe-storage pattern;
  plaintext apiKey in localStorage is accepted MVP risk, called out in the
  settings UI copy.
- Pi context compaction stays at Pi defaults (enabled); no UI in MVP.
- typebox schemas use Pi's re-exported `typebox` (v1, exact same version as Pi
  pins) — never `@sinclair/typebox`.
