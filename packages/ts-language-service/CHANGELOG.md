# Changelog

## [Unreleased]

### Added

- Package skeleton for `@riftydev/ts-language-service`.
- Pinned `typescript@5.9.3` as a prod dependency (ADR-0166: the vendored fixed
  compiler is the single source of truth for both the compiler and its lib files).
- `scripts/vendor-ts-lib.mjs`: build-time generator that reads every `lib*.d.ts`
  from the installed compiler and emits `vendor/lib-bundle.json` (the committed,
  vendored std-lib asset). Wired into `build` via a `prebuild` hook.
- `src/lib-dts.ts`: std-lib `.d.ts` loader. `loadLibDts()` returns a memoized
  `Map<filename, contents>` — Node reads from the installed compiler's `lib/`,
  the browser fetches the vendored bundle via `getTsLibUrl()` (env-config URL
  precedence, D-004: bootstrap global → `import.meta.env` → `process.env` →
  `/ts-lib/lib-bundle.json`).
