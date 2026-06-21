# ADR 0166: In-browser TS language service over VFS

Status: Accepted
Date: 2026-06-22

> TL;DR: real `ts.LanguageService` in a kernel worker over the rifty VFS; LSP-shaped public API; vendored `typescript` + `lib.*.d.ts`; one service, two consumers (playground + M12 agent).

## Context

rifty type-strips via esbuild.wasm (syntactic only). Monaco's bundled TS worker
runs on its own in-memory model — no authoritative VFS, no real `tsconfig`/
`node_modules` — so its diagnostics diverge from real `tsc`: a happy-path stub
that lies. M12 agent also needs semantic TS tools (typecheck/hover/goto) without
a playground. Fidelity requires a single real LS backed by the actual VFS.

## Decision

**(a) Vendor a fixed `typescript` version** for v1. Parity uses the same vendored
version both sides → divergences isolate host/plumbing bugs, not TS-version drift;
stable UX. Project `tsconfig` (lib/target/strict/paths/…) is honored. TS *version*
is rifty's alone. Deferred: "use project's installed TS version" (workspace-
version override) → `backlog/toolchain-build/ts-language-service-workspace-version`.

**(b) Real `ts.LanguageService` over a `FsSync`-backed `LanguageServiceHost`**.
File access/module resolution/tsconfig loading all go through the authoritative
VFS via the existing fs.* sync-RPC seam. Open-document overlay (path→version+text
map) provides as-you-type squiggles without VFS writes — exact `didOpen`/`didChange`/
`didClose` semantics. `lib.*.d.ts` vendored as an asset; loaded via env-config URL
precedence (bootstrap global → `import.meta.env` → `process.env` → default
`/ts-lib/`) — same D-004 pattern as `getQuickjsWasmUrl()`.

This is real `typescript` code executing via the LanguageService API — "real tsc
hosted natively", a stepping stone to the north-star guest-process approach.

Rejected alternatives:
- **Monaco bundled TS worker** — runs on its own model, not the VFS; pinned TS,
  no real `node_modules`/`tsconfig` → diverges from real `tsc` → a stub that lies.
  No headless agent path.
- **tsc/tsserver as a guest Node process on runtime-js** — north-star / future
  dogfood; too risky for v1.

**(c) Worker-resident `serve:true` service**. Kernel-spawned worker reads VFS via
fs.* sync-RPC. Reached async (MessagePort/fork-IPC) by two consumers:
playground (Monaco, main thread) and M12 agent (headless, out-of-rifty). One
instance, two consumers.

**(d) Public API is LSP-shaped** (0-based line/character). Returns
`Diagnostic`/`Hover`/`CompletionItem`/`Location`/`SignatureHelp`/`WorkspaceEdit`/
`CodeAction`… — ecosystem-standard, no ts-internal structures. Maps cleanly to
Monaco markers/providers and gives the agent clean JSON.

**(e) `lib.*.d.ts` vendored as an asset** (see (b) above for load precedence).

**Scope**: full tsserver surface in phases — diagnostics → hover/def/completions →
refs/rename/signature → code-fixes/format/organize-imports. Long tail
(refactorings, inlay hints, semantic highlighting, call hierarchy) and non-TS/JS
LSP → honest `NotImplementedError` + compat ❌ + backlog. No silent stubs.

New package `@riftydev/ts-language-service` (application tier, alongside
`shell`/`npm-client`); re-exported via `@riftydev/sdk/ts-language-service`. New
prod dep: `typescript`.

## Consequences

- **Irreversible**: new `typescript` prod dep + new public capability surface.
- Diagnostics match real `tsc` (same TS version both sides of parity).
- Single LS instance feeds playground editor + M12 agent (no duplicated VFS copies).
- `@riftydev/sdk/ts-language-service` umbrella export → additive public API,
  non-removable once published.
- Non-TS/JS languages → `NotImplementedError` (browser ceiling, out of scope).
- Project-installed TS version override → backlog.
