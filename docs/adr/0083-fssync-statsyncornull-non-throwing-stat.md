# ADR 0083: FsSync.statSyncOrNull non-throwing stat

Status: Accepted (2026-06-06)
Date: 2026-06-06

Relates to:
- **ADR-0014** — shared `FsSync` sync surface (memory + OPFS backends).
- **ADR-0029 / ADR-0041** — precedent for additively growing the shared `FsSync`/`Vfs` interface (`utimes`, `readdirSync` dirents) the same way.
- **ADR-0037** — `FsSync` is the single sync contract consumed by the JS module loader.
- `docs/perf/js-runtime-perf-audit-2026-06-05.md` (item #11) + `docs/perf/js-runtime-perf-adr-plan-2026-06-06.md` (ADR-0083) — rationale.

## Context

The runtime-js module resolver probes the VFS with the `existsSync(x) && statSync(x)` idiom at **7 sites** (resolver.ts: the `fromFile` dir check, `resolveAsFileOrDir` base, the `${base}${ext}` loop, the `INDEX_FILES` loop, the directory case, `resolveInsidePackage`'s `package.json`, `findPackageScope`'s `package.json`). Each pays two syscalls — `existsSync` then `statSync` — and each normalizes the path twice (the wrapper re-normalizes on every entry). On the deep opencode import graph (thousands of resolution probes) that is a measurable constant-factor tax.

`statSync` itself stays **throwing** on a miss — Node parity (`fs.statSync` throws `ENOENT`), relied on by `chdir`, `fs.statSync` without `throwIfNoEntry`, and existing tests; it must not change.

## Decision

Add `statSyncOrNull(path): { isFile; isDirectory; size?; mtime? } | null` to the shared `FsSync` interface — a **non-throwing** stat returning `null` on a genuine miss. (`null` here is the method's contract, not a silent stub.) Implement in BOTH backends:

- `MemoryFsSync` — `exists(np) ? stat(np) : null` over a single `normalizeAbsolute`.
- `OpfsFsSync` — `index.has(norm) ? statSync(norm) : null` over a single `normalizePath`, reusing the warm-index + live-handle-size + utimes-side-table path `statSync` already uses.

Collapse the 7 resolver double-probes to one `statSyncOrNull` call each (`s?.isFile` / `s?.isDirectory`). The two bare `existsSync` sites with no paired `statSync` are left untouched (count is exactly 7).

Adding a method to the cross-package `FsSync` interface is reversibility rule 1 (public API between packages) → IRREVERSIBLE → ADR (ratified inline, ADR-0063), following the ADR-0029/0041 precedent.

## Alternatives considered

- **A — new `FsSync.statSyncOrNull`, both backends.** Chosen. One additive method; halves the normalize+lookup work per probe; resolver outcomes byte-identical; mirrors how `utimes` was added.
- **B — try/catch `statSync` at each call site.** Rejected: still two normalizes (existsSync then statSync) OR a throw-on-the-hot-path per miss; spreads the idiom across 7 sites; no interface change but worse ergonomics and no perf win.
- **C — keep `existsSync` + `statSync`.** Rejected: the redundant double-probe is the cost item #11 targets.

## Consequences

- (+) Resolver collapses 7 `existsSync`+`statSync` pairs to one probe each — half the normalize+lookup work, same resolution result.
- (+) `FsSync` surface grows by exactly one method; both backends implement it; `runtime-js → vfs` import stays forward (no reverse import, no new circular dep).
- (+) Behaviour identical at the resolver: `statSyncOrNull(x)` replicates the `existsSync(x) && statSync(x)` short-circuit, so resolution outcomes are unchanged (no Node-parity shift) — a pure constant-factor refactor at the call sites.
- (−) One more method on the shared interface to keep stable; any future `FsSync` implementer must provide it.
- Acceptance: resolver behaviour identical (`tests/conformance/modules/resolver.test.ts` + module parity cases green); `statSync` still throws `ENOENT` on a miss (untouched, both backends); `statSyncOrNull` returns `null` on miss / a stat on hit in both backends (vfs unit).
