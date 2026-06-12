# Compatibility matrices

These files are the public claim surface for rifty compatibility. Treat missing areas as
undocumented, not supported. The point is honest fit: tested support, visible caveats, and loud
unsupported rows.

Each markdown here mirrors the test results in `tests/conformance/` and `tests/integration/` for a Node-compatible area.

- [modules.md](./modules.md) — M2 (Modules)
- [buffer.md](./buffer.md) — `Buffer` polyfill (`@riftydev/io`)
- [fs.md](./fs.md) — `node:fs` runtime VFS subset
- [streams.md](./streams.md) — `node:stream` subset
- [http.md](./http.md) — `node:http` / browser-local port registry subset
- [wasi.md](./wasi.md) — WASI preview1 syscall surface (`@riftydev/runtime-wasi`)
- [incompatible-packages.md](./incompatible-packages.md) — packages rifty can't run (native deps)
- (sqlite.md — coming with the `node:sqlite` `DatabaseSync` shim, ADR-0065)
- (browsers.md — coming with first cross-browser CI run)

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws `NotImplementedError` or `UNSUPPORTED_PROTOCOL`).
