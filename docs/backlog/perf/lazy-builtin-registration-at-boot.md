---
area: perf
subsystem: runtime-js
status: active
title: ADR-0089 — lazy builtin registration at worker boot (names-only split + deferred execSync handler install, hot-core eager)
created: 2026-06-08
why: worker boot eagerly evaluates 40+ builtin module bodies; a log-only worker drags whole builtin surface; child_process barrel pulls kernel/worker-spawn; write-before-code
user_story: As a dev whose worker only does `console.log`, I want boot to skip the 40+ builtin bodies it never touches, but today boot eagerly evals the whole surface and `child_process` drags in kernel/worker-spawn, slowing every cold start
sources: [perf-audit #26, adr-plan A/ADR-0089, ADR-0035 (not superseded — boundary, not timing)]
---
## Context
builtins/index.ts:1-117: worker boot evaluates 40+ builtin bodies; child_process.ts runs installRuntimeJsExecSyncHandler + pulls kernel/worker-spawn at barrel boot. Governs how cross-package builtin surface (registerBuiltin/isBuiltinSpecifier/listBuiltins/loadBuiltin, re-exported runtime-js index.ts:4) is wired — timing, not signatures. rule1 downgraded (no signature change) → rule4 (new names-only module + 40-entry barrel restructure + child_process factory move across >2 files).
## Options / Next
(1) split isBuiltinSpecifier/name-list into a names-only module so resolver stops pulling the barrel; (2) move installRuntimeJsExecSyncHandler install into the child_process factory. Hard rule: hot-core builtins (path/util/events/buffer/process/stream/fs/os/crypto) stay statically registered; loadBuiltin is on the sync require() path and must NEVER become async; preserve no-reverse-imports when re-wiring net's registerBuiltin.
## Reversibility
IRREVERSIBLE — rule4 (new module + barrel restructure across >2 files). Does NOT supersede ADR-0035 (package boundary, not timing). No decision subagent.
