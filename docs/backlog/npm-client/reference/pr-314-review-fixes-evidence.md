# PR #314 review corrections

Baseline: `0c3b9248e`; original migration authorities at `0feeb5c89`.

## Cause and scope

- Broad quoted-relative-path rewriting changed fixture values `.` / `..` into filesystem paths. Restore the Chokidar literals; execute empty/current/parent/ordinary-child cases.
- Registry entry preparation treated its host tracker as optional even for detached Vite actions. Class: corrupt-input / false-fallback at local host-capability admission. Siblings: direct CLI preparation and planner before adapter activation; one validation function serves both. Info and unrelated entries need no action tracker. No transport or new coordination mechanism.
- ADR-0384 names active ADR-0361, with its correction note; retired ADR-0335 is not the owner.
- CI run `34163092320`, job `101868842719`: Markdown SSG served real HTML, but its assertion still expected `[real-vite/worker]`; all three attempts failed that old prefix. Align with accepted generic provenance. No snapshot/dependency changes.

## RED → GREEN

Node v24.16.0 / Vitest 2.1.9. `pnpm exec vitest run tests/integration/vite-cli-prep.test.ts`: before fixes, 6 failed / 79 passed. Four action modes accepted missing tracker; two Chokidar cases admitted `.` / `..` due to corrupted fixture constants.

Targeted command from handoff (both integration files, ownership gate, Workbench entry contract and registry runtime directory): 119 passed / 8 files. Covers missing/stale-global/non-callable trackers, info/eval preservation and restored Chokidar behavior. Removing the guard call from direct CLI preparation then from the planner independently makes its targeted tests fail (exit 1); both restored.

Chromium `playwright.browser-unit.config.ts`, isolated port 5579, workers=1: all 7 esbuild/Vite scenarios passed (50.6s), including actual CLI actions, direct module identity, offline/cache behavior, and helper/ordinary npm project paths.

Markdown SSG rerun: `RIFTY_PLAYGROUND_PORT=5580 pnpm exec playwright test tests/e2e/markdown-ssg.spec.ts --project=chromium-light --workers=1` → 1 passed (10.7s), real generated HTML and preview bridge.
