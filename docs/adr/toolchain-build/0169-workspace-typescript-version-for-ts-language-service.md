# ADR 0169: Workspace TypeScript version for TS language service

Status: Accepted
Date: 2026-06-22

> TL;DR: the TS language service uses the project's own `node_modules/typescript`
> when it can load a self-contained browser-safe compiler bundle; rifty's
> vendored compiler remains the loud, deterministic fallback.

## Context

ADR-0166 deliberately started with one vendored `typescript` version so parity
isolated host/VFS bugs from compiler-version drift. That was correct for the
first engine cut, but editor fidelity is not complete until diagnostics,
quick-info, completions, refactors, and code actions match the version the
project actually pins. VSCode's normal model is "use workspace version" when a
project installs TypeScript; rifty previously always used its own vendored
compiler, so a project using newer/older TS semantics could diverge from its own
`tsc`.

## Decision

Extend ADR-0166's compiler selection:

1. On service init, walk from `projectRoot` upward and look for
   `node_modules/typescript/lib/typescript.js` in the rifty VFS.
2. If absent, use rifty's vendored `typescript` and vendored `lib*.d.ts` bundle.
3. If present, evaluate that workspace `typescript.js` as a CommonJS compiler
   bundle in a browser-safe compartment with no Node `process`/`require`
   authority, validate the required LanguageService surface, and load its
   adjacent `lib/*.d.ts` files from the same package.
4. If the workspace compiler or libs are present but invalid/unreadable, throw
   loudly. Never silently fall back to the vendored compiler for a broken
   workspace TS install; that would lie about the project's actual toolchain.

This does not change ADR-0166's VFS host, worker residency, LSP-shaped wire
surface, or vendored fallback. It only changes which real TypeScript compiler
backs that host.

## Consequences

- Projects that pin TypeScript now get LS behavior from that pinned version,
  including its lib declarations and diagnostics.
- Parity tests remain version-stable for the vendored path and add a workspace
  compiler-loader regression proving the project compiler is used when present.
- The workspace compiler must be the standard TypeScript package shape whose
  `lib/typescript.js` is self-contained enough to evaluate without Node ambient
  globals. Nonstandard toolchain packages fail loud.
- The vendored compiler is still required as fallback for projects with no
  installed TypeScript and as the package's own tested baseline.
