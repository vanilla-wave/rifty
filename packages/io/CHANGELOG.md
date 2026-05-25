# Changelog

## [Unreleased]

### Added

- `NotImplementedError` helper exported for cross-package use.
- **ADR-0012:** promoted the shared Node-compatible primitives into this package as the source of truth:
  - `EventEmitter` + `once()` promise helper (`src/event-emitter.ts`).
  - `Buffer` factory + per-instance method patching (`src/buffer.ts`, split across `src/buffer-codec.ts` and `src/buffer-methods.ts`).
  - Stream primitives — `Readable`, `Writable`, `Duplex`, `Transform`, `PassThrough`, plus `pipeline` and `finished` — under `src/streams/`.
  - `runtime-js`, `kernel`, and `net` now import these from `@rifty/io`; their previous in-package copies became re-export shims.
