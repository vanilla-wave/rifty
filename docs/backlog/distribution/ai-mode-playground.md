---
area: distribution
status: draft
title: AI mode in the playground — chat + vibe views, Pi agent loop, standard coding-agent tools
created: 2026-07-02
why: M12 needs a real in-playground agent to measure and to try by hand; the MVP-shaped concretization of the ai-ide-pi-agent-harness direction
user_story: As a playground user, I want to toggle AI mode and vibecode my project via chat while the agent edits files, runs shell, and verifies the preview, but today the playground has no agent at all
epic: ai-mode-mvp
blocked_by: []
sources: [docs/backlog/distribution/ai-ide-pi-agent-harness.md, docs/backlog/epics/ai-mode-mvp.md]
code: [apps/playground/src/App.tsx, apps/playground/src/adapters/terminal-manager.ts]
---

## Context

Full AI mode, not a stub — app-level consumer in `apps/playground`, zero AI in
`@riftydev/*` runtime packages (no-reverse-imports keeps it honest). Grilled
decisions, all resolved:

- **Two views, one runtime**: "+chat" (full IDE + chat panel) and "vibe mode"
  (chat + preview only, editor/terminal hidden). Both ship in MVP; layout-only diff.
- **Agent loop**: Pi (`pi-agent-core` + `pi-ai/openai-completions` subpath) per
  ai-ide-pi-agent-harness; that item's ADR ratifies the dep when this starts.
- **Prompts**: Pi baseline + rifty compat adaptation ONLY (tool mapping, browser
  environment facts, preview-verification habit) — no benchmark tuning; profile
  versioned `pi-baseline+rifty-adapter-v1`.
- **Tools**: standard coding-agent surface, no rifty magic — `shell` (rifty shell,
  honest limits), `read_file`/`write_file`/`edit_file(old,new)`/`apply_patch`
  (both edit styles), `list_files`/`grep`/`glob`, preview tools (fetch/text/
  query/click/type), diagnostics (ts-LS). Agent starts like a real one: repo open,
  dev server may already run.
- **No approve gate**: writes land directly; safety = browser-tab sandbox + visible
  trace + git diff via SCM panel + stop/reset.
- **Provider**: any OpenAI-compatible endpoint; settings `baseUrl`/`apiKey`/`model`;
  dev-only proxy for CORS (full provider/auth story explicitly out of MVP; CORS
  research 2026-07-01: most providers pass, Anthropic/Gemini don't). One streaming
  chat-completions contract + thin adapter — no provider zoo.
- **Done semantics**: final assistant message without tool calls; per-run limits
  enforced by the loop.
- **Trace**: one JSON per session — transcript, tool calls/results (size-capped),
  timings, usage tokens, terminal output, final git diff, config snapshot (no key);
  "Export session" button; same object `__riftyAgentBench.exportTrace()` serves the
  bench.
