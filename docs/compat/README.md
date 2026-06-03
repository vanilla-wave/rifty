# Compatibility matrices

Each markdown here mirrors the test results in `tests/conformance/` and `tests/integration/` for a Node-compatible area.

- [modules.md](./modules.md) — M2 (Modules)
- [buffer.md](./buffer.md) — `Buffer` polyfill (`@riftydev/io`)
- [m10-tooling.md](./m10-tooling.md) — M10 foundations
- [wasi.md](./wasi.md) — WASI preview1 syscall surface (`@riftydev/runtime-wasi`)
- [sqlite.md](./sqlite.md) — `node:sqlite` `DatabaseSync` shim (`@riftydev/net`, sql.js — ADR-0065)
- (browsers.md — coming with first cross-browser CI run)

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws `NotImplementedError` or `UNSUPPORTED_PROTOCOL`).
