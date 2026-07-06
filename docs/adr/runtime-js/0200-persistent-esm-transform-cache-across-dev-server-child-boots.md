# ADR 0200: Persistent ESM transform cache across dev-server child boots

Status: Accepted
Date: 2026-07

> TL;DR: `createModuleLoader` accepts an injected `persistentEsmTransformCache` (sync get/put of `{source, result}` per module id); the playground backs it with one OPFS JSON store per format version, hydrated before the dev-server child's first import — the loader validates every hit by EXACT source equality, so the store can degrade or vanish but never lie.

## Context

`esmAstCache` (acorn parse+rewrite — the heaviest per-module CPU step) lives per
loader instance; the dev-server child creates a fresh loader per boot, so every
preset pick / dev restart / reload re-parses the whole vite dist. Measured on
real vite dist bytes (node V8): 2.8 MB → 263 ms cold, ~0 ms cached; the
in-browser vite 7 dist is larger → ~0.5–1 s repaid per boot. Resolves
Q-2026-05-30-202 (transformEsm result cache + hook on loader deps).

## Decision

- **Hook (public, `@riftydev/runtime-js/loader`):** `ModuleLoaderOptions.persistentEsmTransformCache?: PersistentEsmTransformCache` with sync `get(id) → {source, result} | undefined` / `put(id, {source, result})`. Sync because `transformEsm` sits on the synchronous load path.
- **One validation boundary:** the LOADER compares `stored.source === source` before using a hit (same contract as the in-memory cache). A store cannot poison execution — worst case it wastes a lookup. `put` happens only on recompute, so store content is always loader-produced.
- **Key = module id** (absolute path), NOT content hash: identical to the in-memory cache contract; a changed file under the same id self-heals on the source compare (recompute + overwrite). `loader.invalidate()` does not touch the persistent store — the source compare already guards staleness.
- **Format bust = `ESM_TRANSFORM_FORMAT` constant** colocated with `transformEsm` in `esm-ast.ts` and baked into the store filename. Changing the transform/`TransformResult` shape REQUIRES bumping it (loud comment at both sites); workspace package versions never bump in dev, so a manual colocated constant is the only honest key.
- **Playground store (OPFS, worker realm):** `createOpfsEsmTransformCache()` in the dev-server child; single JSON file `esm-transform-cache/v<format>.json` at the OPFS root (outside all project VFS mounts). Hydrated (read+parse) inside `bootDevServer` before `createModuleLoader` — an absent file costs nothing; a present one costs one read against a ~0.5–1 s parse win.
- **Write-behind:** `put` filters to `/node_modules/` ids (user files churn — out of scope per the backlog item), queues, and flushes the whole file debounced; a flush failure warns once and disables further writes (degraded, visible).
- **Scope:** wired in the dev-server child only (the measured pain). The hook is generic; other realms (node-entry, ts-lsp) can adopt with their own measurements.

## Fault matrix

- poisoned-cache (file changed under same id) → source-compare miss → recompute + overwrite (transparent).
- poisoned-cache (transform code changed, same source) → format-constant filename bust (cold start); manual-bump risk recorded above.
- corrupt-input (truncated/malformed/foreign JSON, wrong format/shape) → discard store + delete file + one console.warn; boot proceeds cold.
- unbounded-read (hydrate) → refuse files > 64 MB (discard + warn).
- torn-state (crash mid-flush) → next hydrate hits corrupt-input path; whole-file JSON is the integrity unit.
- concurrent-same-key (two children flushing) → whole-file last-wins; each file internally consistent; lost entries are re-learned next boot.
- false-fallback (no OPFS / quota / open error) → loader runs uncached, one warn — never a boot failure.

## Consequences

- Vite import phase stops re-paying acorn on every dev-server boot; bench `presetBootToPreviewLiveMs` is the regression gate.
- +1 OPFS artifact outside project trees (cleared by browser-sandbox reset like everything origin-scoped).
- The manual `ESM_TRANSFORM_FORMAT` bump is a recorded drift risk (colocated constant + comments mitigate).
