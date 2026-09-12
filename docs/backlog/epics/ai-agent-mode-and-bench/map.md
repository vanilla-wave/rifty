## Items

1. `playground/ai-mode-chat` — **hands-on** — next: "+chat" panel over delivered core; settings; `?agentBench=1` hooks.
2. `distribution/agent-bench` — **measurement** — lanes `rifty` (over 1), delivered `rifty-no-coi` host, `local-reference`; 5 tasks on the #300 template; report — depends on 1.

## Open questions

- `tsc --noEmit` via `.bin`, vitest under rifty, and the no-COI ⚠️ rows (`node -e/-p`, shell built-ins, `git`, foreground pipes) of the believed baseline — owner: agent — measured by the bench lanes, not pre-probed.
- no-COI resident/finite coexistence (agent project fs/commands while the dev server lives) — owner: agent — `distribution/public-api-ai-agent-preview-question` pickup; not prescribed by this goal.

## Out of scope

- "vibe" layout — agent cut, REV-7 (goal Decisions, 2026-09-12).
- approve/permission gate — user «без апрува», 2026-09-12.
- chat persistence across reload (export is the persistence story) — carried #111.
- Product UI (`distribution/ai-ide-product-ui`), subagents (`distribution/ai-agent-subagent-orchestration`), demo page (`epics/open-bolt-ai-sandbox-demo`) — separate items.
- playground no-COI mode; examples/ page — user, 2026-09-12.
- npm publication of the agent package — confirm-first (DEC-3).
- Provider zoo / auth flows: the shipped transport is OpenAI-compatible chat-completions only; other wire shapes and auth enter via the public `fetch`/`streamFn` seam; CORS-blocked endpoints fail loudly naming the dev-proxy escape hatch (carried #111).
- Multimodal input; image/audio.
- Integrator-specific tools, transports and delivery (app publish actions, same-origin LLM channels) — never in rifty; they enter through the public seams (user, 2026-09-12).
- Raw `sandbox.fs` fallback in the standard no-COI adapter (user, 2026-09-12).
