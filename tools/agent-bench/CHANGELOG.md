# @riftydev/agent-bench

## Unreleased

- New workspace tool: external two-lane validation harness over the playground
  (ADR-0191, docs/backlog/distribution/agent-bench-harness.md — pass A).
- CLI (`pnpm agent-bench`): `run --lane local-reference [--task] [--runs]
  [--config] [--mock-model] [--dry-judge]` + `report <dir>` summary regeneration.
- Lane `local-reference`: temp dir per run, playground preset source
  (react-vite / hono-api) + seed overlay, real npm install (registry.npmjs.org),
  local vite / node dev server, pinned `@earendil-works/pi-coding-agent@0.80.3`
  (`--mode json`, isolated `PI_CODING_AGENT_DIR`); enforces
  runTimeoutMs/maxToolCalls/toolTimeoutMs as distinct `budget-exceeded`.
- Lane `rifty`: loud NOT-YET-WIRED refusal — pass B lands with the
  `distribution/ai-mode-playground` hooks.
- Task set `task-set-v1` (5 tasks) with user-voice prompts and lane-agnostic
  `judge.ts` per task; diagnostic report with human `failureClass`/`note`.
- `--mock-model` scripted OpenAI-compatible SSE server for tokenless smoke runs;
  parity-invariant unit tests (prompt byte-identity, seed-overlay tree equality,
  config, report aggregation/shape).
