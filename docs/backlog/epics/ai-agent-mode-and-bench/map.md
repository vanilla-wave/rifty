## Items

1. `distribution/ai-ide-pi-agent-harness` — **core** — headless agent package + COI Workbench host adapter, Pi 0.85.x ADR, tools, budgets, trace, mock-model proof; minimal pattern first.
2. `playground/ai-mode-chat` — **hands-on** — "+chat" panel over 1; settings; `?agentBench=1` hooks — depends on 1.
3. `distribution/ai-agent-no-coi-host` — **no-COI host** — `sandbox.project()` adapter, host-owned mode switch, full-cycle e2e edit → build → preview → edit in `tests/no-coi` — depends on 1; blocked on the resident-exit substrate (fog below).
4. `distribution/agent-bench` — **measurement** — lanes `rifty` (over 2), `rifty-no-coi` (over 3), `local-reference`; 5 tasks on the #300 template; report — depends on 2 and 3.

## Open questions

- Pi `pi-ai/dist/utils/provider-env.js` static `node:fs` import (0.85.1): bundler alias vs upstream change — owner: agent — core pickup spike; alias must be unreachable or loud.
- `tsc --noEmit` via `.bin`, vitest under rifty, and the no-COI ⚠️ rows (`node -e/-p`, shell built-ins, `git`, foreground pipes) of the believed baseline — owner: agent — measured by the bench lanes, not pre-probed.
- no-COI resident/finite coexistence (agent project fs/commands while the dev server lives) — owner: agent — `distribution/public-api-ai-agent-preview-question` pickup; not prescribed by this goal.
- no-COI resident exit: `restart` re-runs the resident (`sandbox.ts` residentRequest never cleared; `SandboxResidentBin` has no stop), so preview mode cannot be left without `dispose()` — owner: agent — the full-cycle e2e needs a public host-side exit (new SDK surface → ADR at no-COI host pickup) or names this as its blocker.

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
