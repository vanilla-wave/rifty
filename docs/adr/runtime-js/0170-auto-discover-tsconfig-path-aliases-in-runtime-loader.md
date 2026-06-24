# ADR 0170: Auto-discover tsconfig path aliases in runtime loader

Status: Accepted
Date: 2026-06-22

> TL;DR: keep Node-faithful resolution by default; when opted in,
> `autoDiscoverTsconfigPaths` derives `paths` from the nearest VFS
> `tsconfig.json` via the real TypeScript config parser.

## Context

ADR-0066 added explicit `ModuleLoaderOptions.paths`: callers read tsconfig and
pass an already-absolute alias map. That unblocked opencode but left the "open a
TS project" user story with manual wiring. The TypeScript sandbox preset is now a
real consumer: users expect `@/x` aliases to work from the checked-in
`tsconfig.json`, including JSONC, `extends`, `baseUrl`, and modern `paths`
without `baseUrl`.

Hand-parsing tsconfig would be another divergence source. The hard ceiling is the
TypeScript compiler API's own config parser.

## Decision

- Add `autoDiscoverTsconfigPaths?: boolean` to `ModuleLoaderOptions` /
  `ResolverOptions`.
- Default stays `false`: vanilla projects keep Node-style bare-specifier
  resolution, and `@/foo` remains `MODULE_NOT_FOUND` unless the caller opts in or
  supplies explicit `paths`.
- When enabled and no explicit `paths` map is supplied, the resolver locates the
  nearest `tsconfig.json` from the importing file's directory upward, parses it
  with `typescript.parseJsonConfigFileContent`, follows `extends`, accepts JSONC,
  and resolves `compilerOptions.paths` targets against `baseUrl` or TypeScript's
  `pathsBasePath`.
- Explicit `paths` still wins when both are supplied; this preserves ADR-0066's
  deterministic harness path.
- Config parse/read failures throw `ModuleLoadError` with a `TSCONFIG_*` code.
  Empty-project diagnostics are ignored because they do not affect path mapping.
- Resolver caches include nearest-config and parsed-alias maps, cleared by
  `resolver.clearCaches()` / `loader.invalidate()`.

## Consequences

- Adds a `typescript` production dependency to `@riftydev/runtime-js`, because
  published loaders cannot rely on root hoisting.
- `tests/conformance/modules/resolver.test.ts` pins JSONC parse, `extends`,
  `baseUrl`, default-off behavior, explicit override precedence, and cache
  invalidation.
- ADR-0066 remains active for the explicit map contract; only its "resolver does
  not read tsconfig" clause is corrected by this opt-in path.
