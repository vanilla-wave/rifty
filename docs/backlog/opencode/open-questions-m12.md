---
area: opencode
status: active
title: End-of-M12 review of the 19 reversible opencode provisional decisions (Q-2026-05-30-101..-119)
created: 2026-06-08
why: 19 REVERSIBLE provisional decisions (now in docs/backlog/) each carry "Needs human review by: end of M12" + a code marker; the review gate is unresolved
sources: [docs/opencode/decisions.md §Section B, OPEN_QUESTIONS.md Q-2026-05-30-101..-119, audit-digest]
---
## Context
decisions.md Section B is the REVERSIBLE provisional-decision block for the opencode facade, since migrated into docs/backlog/: Q-2026-05-30-101 … -119 (renumbered globally from -101 to dodge the landed -001/ADR-0051). Each carries a `TODO(backlog: opencode/…)` code marker and "Needs human review by: end of milestone M12". These are the per-decision review obligations behind the technical items already split out: 101 (vendor/facade-manifest — see m12-vendor-opencode-tree), 102/103 (sqlite throw-stub registration + bun condition order — db-pty + adr-0054-resolution-conditions), 104/105/106 (esbuild loader/cache/workspace — runtime-js), 107/108/109 (listen overload, drain, pipe-sink — net), 110/111/112/114/115/116 (boot harness + LLM env — headless-boot + phase3), 113 (SSE chunk boundary — v3-sse-frame-bump), 117 (boundary doc placement — tool-ceiling-table), 118/119 (vfsGrep marker + spawn-ceiling test — ripgrep-wasm-grep-tool + spawn-ceiling-end-to-end).
## Options / Next
This item tracks the GATE, not the technical work (each Q's substance lives in its owning area item). Next: at the M12 close, review each entry → promote to ADR via `pnpm adr:new <area>` (manual, re-anchors the owning `TODO(backlog: …)` marker), defer (bump the review date), or reject. Several are shipped-and-tested code merely awaiting confirm→promote. Done: OPEN_QUESTIONS.md was retired into the backlog — the ~13 dangling code markers were re-anchored to `TODO(backlog: opencode/…)`, and the `adr:promote`/`todo:adr` tooling that parsed the file was replaced by `pnpm backlog:check`.
## Reversibility
REVERSIBLE — each Q is a provisional decision recorded per ADR-0008/0063 (rule 5). The review itself is process, not a code fork; promotion to ADRs is the closing step. Gate: end of milestone M12.
