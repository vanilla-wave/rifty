---
area: toolchain-build
status: draft
title: Ratchet check — no new source-grep tests, burn down the existing 12
created: 2026-07-02
epic: playground-testable-core
why: 12 playground test files assert readFileSync'd source text (App.test 392 asserts, real-vite-bootstrap 79, …) — they pin strings, prove no behavior, break as stale-string noise on merges; nothing stops the pattern from growing
user_story: As a reviewer, I want CI to refuse a new expect(source).toContain-style test so the extraction epic's payoff isn't silently re-accumulated, but today the pattern passes every gate.
sources: [tools/checks/pr-check.mjs]
---
## Context
Current 12 (2026-07-02): App.test.ts, glue/realVite.test.ts, glue/ts-ls-monaco-providers-source.test.ts, components/{EditorHost,PreviewPanel}.test.ts, components/FileExplorer.source.test.ts, workers/{node-entry-bootstrap,kernel-worker-entry,build-boot,vite-cli-prep,dev-server-boot,real-vite-bootstrap}.test.ts.
## Options / Next
- Check with explicit allowlist = today's 12; any new file or per-file count increase fails; burn-down rides items `playground/app-orchestration-headless-core` + `toolchain-build/browser-mode-unit-lane`.
- Closing gate: allowlist empty, or each residual carries a recorded constraint (why behavioral is impossible there) — mirrors the honest-❌ compat stance.
