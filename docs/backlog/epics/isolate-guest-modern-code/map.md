# Map — isolate-guest-modern-code

## Items

None seeded (draft split-out). Drafts that carry its facts (`epic:` set so they travel with it, not
seeded units): `runtime-js/isolate-guest-url`,
`runtime-js/isolate-esm-files`, `runtime-js/esm-import-binding-asi` (every host),
`runtime-js/isolate-web-globals-captured-at-load` (its `URL` rows, the seam; re-typed here 2026-11-25).

## Open questions

- Whether this goal runs now — owner: user — split out 2026-11-25.
- Cost of `URL` + `ada::idna` tables per isolate (warm call, guest bundle) — owner: user — at FIT,
  with a measured `ada::idna` port.
- ES modules in `-e` (`runCode` with `import()` or ESM syntax) — owner: user — at FIT.

- `reference/seam-esm/run.mjs:154` compares only stdout and exit code with Node (PR #443 review N1)
  — owner: agent — compare stderr too when this goal's FIT reruns the probe.

## Out of scope

- `data:` URL imports (`runtime-js/process-module-loader-surface`), ESM diagnostics text (direction F).
