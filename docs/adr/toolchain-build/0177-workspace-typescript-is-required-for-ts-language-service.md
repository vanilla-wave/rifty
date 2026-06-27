# ADR 0177: Workspace TypeScript is required for TS language service

Status: Accepted
Date: 2026-06-26

> TL;DR: the TS language service requires the project to install
> `node_modules/typescript`; missing or broken workspace TypeScript fails loudly.

## Context

ADR-0166 introduced the in-browser `ts.LanguageService` and ADR-0169 made the
project's `node_modules/typescript` win when present, with rifty's vendored
compiler as fallback when absent. That fallback is deterministic, but it is not
faithful to a real project toolchain: a project without `typescript` installed
does not have a workspace TypeScript version. Silently substituting rifty's
compiler can make diagnostics/quick-info/refactors look valid for a dependency
state the project did not actually declare.

The TypeScript starter is the first consumer that wants TS editor intelligence on
boot. It must own that dependency in its generated `package.json` and snapshot
instead of sharing the plain Vite `node_modules` snapshot.

## Decision

Supersede ADR-0169's absent-workspace fallback rule:

1. On service init, walk from `projectRoot` upward and require
   `node_modules/typescript/lib/typescript.js` in the rifty VFS.
2. If absent, throw
   `TypeScript is not installed in this project; run npm install -D typescript`.
3. If present, evaluate that workspace `typescript.js` as the compiler API and
   load adjacent `lib/*.d.ts` from the same package.
4. If the workspace compiler or libs are invalid/unreadable, throw loudly.
   Never fall back to a vendored compiler for a broken or missing workspace TS
   install.
5. Starter templates that need TS language-service behavior must declare
   `typescript` themselves and bake/use a snapshot that contains it.

## Consequences

- Diagnostics and editor queries now describe the project's declared toolchain,
  never rifty's undeclared fallback compiler.
- Plain JS/Vite projects without `typescript` show a visible/actionable TS-LS init
  failure instead of silently using rifty's compiler.
- The TypeScript starter owns a `typescript` devDependency and a distinct baked
  node_modules snapshot.
- The vendored `lib*.d.ts` asset remains a package/test resource, not the service
  compiler fallback.
