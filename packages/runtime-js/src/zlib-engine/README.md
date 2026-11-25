# zlib-engine (ADR-0573)

Node v24.16.0's `deps/zlib` as `zlib.wasm` and a port of Node's native zlib handle over it.
Until `runtime-js/zlib-node-lib-port`, only tests import this directory (`check:arch` rule
`zlib-engine-has-no-production-importer`; it sees imports, not `new URL('…', import.meta.url)`
asset references — none exist).

- `engine.ts` — one wasm instance; checked `malloc` (0 → `RangeError`), fresh views after every call.
- `handle.ts` — `node_zlib.cc` ZlibContext + CompressionStream as `binding.Zlib`, and `binding.crc32`.
  Declared limit: a write's input is snapshotted when the write starts (Node reads it live).
- `wasm-bytes.ts` — the committed module's bytes.
- `generated/` — output of `tools/publishing/generate-zlib-wasm.mjs`; never edit by hand.

## Regenerating

`pnpm zlib-wasm:generate` (Node v24.16.0, darwin-arm64 / linux-x64 / linux-arm64: the hosts
`sources.json` pins a wasi-sdk for; others are refused by name). Pins — URL and sha256 of the Node
tarball, wasi-sdk per host, binaryen — live only in `generated/sources.json`.

- `check:zlib-wasm-drift` (`--check`, no toolchain): the committed module decodes to
  `sources.json`'s bytes and sha256, `LICENSE` and the test fixtures match their pins. It does not
  rebuild: an edit to `build.*` or `toolchain` in `sources.json` shows only in `--rebuild`.
- `zlib-wasm:rebuild` (`--rebuild`, CI `unit-and-conformance`/`run`): builds in a temp dir and
  requires byte equality with every committed file.
- Download cache `~/.cache/rifty-zlib-wasm` (`--cache DIR`): every archive's sha256 is checked
  on each run before use; the unpacked trees (`x/<sha>/.done`) are trusted as written. CI caches
  only `dl/` and unpacks fresh, so its rebuild never reads a stale tree; locally, delete `x/` after
  editing anything under it.
