# @riftydev/shadow-registry

Consolidated data tables for in-browser package substitutions and shims. The npm installer's override hook (D-005) and the playground's Vite adapter both read their static data from here; consumer-side adapter code stays in the layer that owns it. Adding a new shim or override is a single-file edit in `src/index.ts`. See [`docs/adr/npm-client/0015-shadow-registry-consolidation.md`](../../docs/adr/npm-client/0015-shadow-registry-consolidation.md) for rationale and acceptance criteria.
