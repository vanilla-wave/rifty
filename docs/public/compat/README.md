# Compatibility matrices

These files are the public claim surface for rifty compatibility. Treat missing areas as
undocumented, not supported. The point is honest fit: tested support, visible caveats, and loud
unsupported rows.

Each markdown here cites the covering tests in `tests/conformance/` and `tests/integration/` for a
Node-compatible area. `fs.md`/`streams.md`/`http.md`/`zlib.md`/`git.md`/`esbuild-js-api.md`/`vite-command.md` are rendered by `pnpm compat:generate`
from static inventories whose cited test files are existence-checked, not re-run — deriving statuses
from test RESULTS is tracked in `docs/backlog/toolchain-build/compat-matrix-test-result-sink`.

- [modules.md](./modules.md) — M2 (Modules)
- [buffer.md](./buffer.md) — `Buffer` polyfill (`@riftydev/io`)
- [fs.md](./fs.md) — `node:fs` runtime VFS subset
- [streams.md](./streams.md) — `node:stream` subset
- [http.md](./http.md) — `node:http` / browser-local port registry subset
- [zlib.md](./zlib.md) — `node:zlib` web-compression-backed async subset (ADR-0159)
- [ts-language-service.md](./ts-language-service.md) — in-browser `ts.LanguageService` over the VFS (`@riftydev/ts-language-service`, ADR-0166)
- [package-tooling.md](./package-tooling.md) — real package CLIs in the browser shell (Prettier, ESLint, typed `typescript-eslint`)
- [esbuild-js-api.md](./esbuild-js-api.md) — exact esbuild 0.28.0 Final+GREEN over guest VFS, with explicit D4 loud gaps (ADR-0226)
- [git.md](./git.md) — git over the VFS (isomorphic-git, ADR-0167); offline-faithful porcelain + smart-HTTP network ceiling
- [vite-command.md](./vite-command.md) — playground `vite` command through the installed `.bin` CLI (ADR-0174)
- [process.md](./process.md) — process lifecycle / event-loop drain + the drain-cap divergence (ADR-0152); the terminal `node <file>` command + its gaps (ADR-0155/0157)
- [wasi.md](./wasi.md) — WASI preview1 syscall surface (`@riftydev/runtime-wasi`)
- [incompatible-packages.md](./incompatible-packages.md) — packages rifty can't run (native deps)
- (sqlite.md — coming with the `node:sqlite` `DatabaseSync` shim, ADR-0065)
- (browsers.md — coming with first cross-browser CI run)

Legend: ✅ implemented and tested · ⚠️ partial / known caveat · ❌ not implemented (throws `NotImplementedError` or `UNSUPPORTED_PROTOCOL`).
