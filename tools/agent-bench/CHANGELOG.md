# @riftydev/agent-bench

## Unreleased

- New workspace tool: external two-lane validation harness over the playground
  (ADR-0191, docs/backlog/distribution/agent-bench-harness.md).
- CLI (`pnpm agent-bench`): `run --lane rifty|local-reference|both [--task]
  [--runs] [--config] [--mock-model] [--dry-judge]` + `report <dir>` summary
  regeneration.
- Lane `local-reference`: temp dir per run, playground preset source
  (react-vite / hono-api) + seed overlay, real npm install (registry.npmjs.org),
  local vite / node dev server, pinned `@earendil-works/pi-coding-agent@0.80.3`
  (`--mode json`, isolated `PI_CODING_AGENT_DIR`); enforces
  runTimeoutMs/maxToolCalls/toolTimeoutMs as distinct `budget-exceeded`.
- Lane `rifty` (pass B): fresh browser context per run → playground deep-link
  boot (`?preset=<id>&agentBench=1&autorun=1`) → `rf.ai.v1` settings pre-seed
  (key from the config-named env var, ephemeral context only) → task seed via
  `__riftyAgentBench.seed` → prompt typed into the real chat textarea →
  `exportTrace()` as the lane trace (terminal/finalDiff/turns derived from it);
  maxToolCalls+runTimeoutMs enforced by the session itself (same config
  values), toolTimeoutMs + wall-clock backstop enforced harness-side.
  `JudgeContext.readFile` reads through the `__riftyAgentBench.readFile`
  hook (full-byte owner read, never the capped page snapshot).
- Judges run against the rifty lane's own browser context
  (`/preview/<devPort>/` is service-worker-routed there); judges enter via
  `previewUrl` + in-app navigation so one judge.ts serves both lanes.
- Task set `task-set-v1` (5 tasks) with user-voice prompts and lane-agnostic
  `judge.ts` per task; diagnostic report with human `failureClass`/`note`.
- `--mock-model` scripted OpenAI-compatible SSE server (CORS-enabled for the
  browser lane; emits `read`/`read_file` per offered tool surface) for
  tokenless smoke runs; parity-invariant unit tests (prompt byte-identity,
  seed-overlay tree equality incl. the rifty seed payload, config, report
  aggregation/shape, status→outcome and trace→LaneTrace mappings).
