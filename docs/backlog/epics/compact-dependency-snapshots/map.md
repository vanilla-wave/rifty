# Map — compact-dependency-snapshots

## Items

Empty. Final+GREEN/CLOSE PASS; all invariants proven.

## Open questions

None. ADR-0547 owns profile/format; existing packed Vite carrier proves the
shared preparation/application path without cache writes or new persistence state.

## Out of scope

- New install prohibition, offline reinstall guarantee or automatic registry
  fallback. Existing explicit install errors remain honest.
- Replay-preserving deduplication: `playground/snapshot-carries-substituted-bytes-twice`.
- Required compact support for Workbench/COI; shared implementation may support
  it, but must preserve ordinary-consumer behavior regardless.
- New package/version admission, native esbuild execution, compiler substitution
  changes, deleted installed WASM or a special esbuild-only snapshot recipe.
- Shared-cache purge, saved-data migration, general immutable-files enforcement,
  new project reset semantics, crash atomicity or performance targets beyond I1.
