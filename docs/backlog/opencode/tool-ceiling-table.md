---
area: opencode
status: active
title: Maintain the canonical FEASIBLE-vs-IMPOSSIBLE tool-ceiling table in docs/backlog/opencode/
created: 2026-06-08
why: docs/backlog/opencode/tool-ceiling-table.md (this file) is manually maintained until the tool layer is wired; long-term shape (Option C) auto-regenerates from NotImplementedError keys
sources: [Q-2026-05-30-062, Q-2026-05-30-117, docs/compat/opencode-tool-ceiling.md, audit-digest]
---
## Context
This file (`docs/backlog/opencode/tool-ceiling-table.md`) is the M12 source-of-truth for the no-tool-execution boundary: ✅/⚠ feasible read substitutes (`fs.readFileSync`/`readdirSync`, `vfsGrep`, `statSync`) vs ❌ fundamentally-impossible spawn/native tools (bash/shell, native git, ripgrep binary, PTY → ENOENT-127 / throw). It lives in `docs/backlog/opencode/` (the documented what-works source-of-truth per CLAUDE.md), cross-linked from the feasibility doc. Today it is MANUALLY maintained because opencode's tool wiring is not modified — the doc records rifty-side capability + the boundary a later tool-substitution integration would consume.
## Options / Next
(A) docs/backlog/opencode/ manual table (current). (C, long-term) encode impossible tools as `NotImplementedError` compat-matrix feature KEYS so `pnpm compat:generate` auto-regenerates the ❌ rows — presupposes the tool-layer integration exists. Next: keep the manual table accurate while the tool layer is unwired; migrate to Option C only once an opencode tool-substitution layer is actually wired. Also tracks the ⚠ glob/include row + the degraded-but-non-fatal rows (file-watch, arborist auto-install). NOTE: this status/roadmap doc gets dissolved later; its open rows are tracked as separate items (glob-filter-widening, file-watch-and-autoinstall, ripgrep-wasm-grep-tool, spawn-ceiling-end-to-end).
## Reversibility
REVERSIBLE — documentation placement only (the "always reversible" category; Q-2026-05-30-117). Option C migration is gated on the tool layer existing. Awaits end-of-M12 review.
