# ADR 0166: In-browser TS language service over VFS

Status: Accepted
Date: 2026-06-22

> TL;DR: real `ts.LanguageService` in a kernel worker over the rifty VFS; LSP-shaped public API; workspace TypeScript when present, vendored fallback otherwise; one service, two consumers (playground + M12 agent).

## Context

rifty type-strips via esbuild.wasm (syntactic only). Monaco's bundled TS worker
runs on its own in-memory model — no authoritative VFS, no real `tsconfig`/
`node_modules` — so its diagnostics diverge from real `tsc`: a happy-path stub
that lies. M12 agent also needs semantic TS tools (typecheck/hover/goto) without
a playground. Fidelity requires a single real LS backed by the actual VFS.

## Decision

**(a) Load the project TypeScript when present; keep a vendored fallback.** Parity
uses the same compiler on both sides → divergences isolate host/plumbing bugs, not
TS-version drift. Project `tsconfig` (lib/target/strict/paths/…) is honored. When
`node_modules/typescript` is absent, rifty's vendored compiler gives stable scratch
project UX.

**Correction 2026-06-22:** ADR-0169 extends this clause. The service now uses a
project-installed `node_modules/typescript` compiler + adjacent `lib/*.d.ts` when
that package is present and loadable from the VFS; the vendored compiler remains
the fallback for projects without workspace TypeScript and fails are loud.

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

**Scope**: full browser-achievable TS/JS `ts.LanguageService` surface in phases —
diagnostics → hover/def/completions → refs/rename/signature →
code-fixes/format/organize-imports → long tail (refactors, navigation,
decorations, call hierarchy, editor helpers, emit metadata). Remaining hard
ceilings stay explicit: package-install code-action commands throw
`NotImplementedError`, live compiler object graphs (`getProgram`,
`getCompletionEntrySymbol`) throw feature-tagged `NotImplementedError`s instead
of crossing the structured-clone protocol, code lens has no TS LS method, and
non-TS/JS native LSP is out of this package. No silent stubs.

New package `@riftydev/ts-language-service` (application tier, alongside
`shell`/`npm-client`); re-exported via `@riftydev/sdk/ts-language-service`. New
prod dep: `typescript`.

## Consequences

- **Irreversible**: new `typescript` prod dep + new public capability surface.
- Diagnostics match real `tsc` for the compiler selected by the project/fallback
  rule (same TS version both sides of parity).
- Single LS instance feeds playground editor + M12 agent (no duplicated VFS copies).
- `@riftydev/sdk/ts-language-service` umbrella export → additive public API,
  non-removable once published.
- Non-TS/JS languages → `NotImplementedError` (browser ceiling, out of scope).
- Project-installed TS version support → ADR-0169.
