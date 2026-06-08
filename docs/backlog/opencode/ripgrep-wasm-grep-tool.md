---
area: opencode
status: parked
title: Real ripgrep/git tool fidelity (ripgrep-WASM / isomorphic-git) over the pure-JS vfsGrep marker
created: 2026-06-08
why: vfsGrep is a pure-JS ceiling marker; production-grade search/git fidelity needs a new vendored dep (IRREVERSIBLE) — deferred behind ADR-0062 tripwire until a measured need
sources: [Q-2026-05-30-061, decisions.md ADR-0062 draft, docs/opencode/README.md §deferred, docs/compat/opencode-tool-ceiling.md §Deferred, Q-2026-05-30-118, audit-digest]
code: [packages/runtime-js/src/utils/vfs-grep.ts:15]
---
## Context
F09 marks the FEASIBLE side of the tool ceiling with ONE read-only tool: `vfsGrep` — pure-JS walk + JS RegExp over `node:fs`/VFS, zero spawn, zero dep, private (not a public export). It does what opencode's read/grep tools do (read bytes + match) in-realm, unlike ripgrep-the-binary. A production-grade search/git substitute would vendor a NEW external dependency: ripgrep-WASM (via `runWasi`, like esbuild) or isomorphic-git / wasm-git (read-only `log`/`readBlob`) or a WASM-search engine — each IRREVERSIBLE.
## Options / Next
Decision (Q-2026-05-30-061/118, provisional): keep the marker pure-JS now; promote to ripgrep-WASM only if/when the facade's search tool is exercised AT SCALE — and only via its own ADR. ADR-0062 draft is a DEFERRAL TRIPWIRE: adopting ripgrep-WASM / isomorphic-git / wa-sqlite-search is BLOCKED until ratified; do NOT silently cross it while implementing the marker. The deferral preserves the option to pick ripgrep-WASM vs isomorphic-git vs JS later against concrete requirements.
## Reversibility
IRREVERSIBLE to adopt (new external dep, rule 2) → gated behind ADR-0062 (a tripwire, not ratified). The pure-JS marker itself is REVERSIBLE (private helper, node:fs + RegExp, ≤2 files; TODO(backlog: opencode/ripgrep-wasm-grep-tool), Q-2026-05-30-061). Parked until a measured need.
