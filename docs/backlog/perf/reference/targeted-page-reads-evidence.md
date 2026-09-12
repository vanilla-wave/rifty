# Targeted page reads — 2026-09-12

Baseline: PR #299 `76827da3231e95d2991a9c5cdb63972fc29e66d4`, including
main `acf594da9`. Chromium 1.60.0 Playwright distribution, macOS, local Vite,
real Worker / Memory VFS / owner authority / page request adapter.

## RED

`pnpm exec vitest run packages/workbench/src/workers/workbench-project-vfs.test.ts -t 'reads atomically'`:
1 failed / 39 skipped. File reply reads three paths instead of its one path;
the other two include an inactive project's file. Exact reply assertions kept.

`RIFTY_PLAYGROUND_PORT=5399 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/targeted-page-reads.spec.ts`:
1 failed in 13.9 s; content-read observation, no import or harness failure.

| tree | entries | file median, ms | directory median, ms | content reads per request |
|---|---:|---:|---:|---:|
| small | 521 | 0.638 | 0.627 | 516 |
| T + targets | 17,338 | 42.591 | 48.750 | 15,601 |

T fixture: original gzip decoded, each `nodeModules.files` base64 content's
decoded length recorded with its relative path; sorted lexicographically.
Snapshot SHA-256 and counts live in the manifest `stats`. Payload bytes are
generated at those exact lengths; this proves read/storage cost, not execution
of the original dependencies. Whole snapshot asset is not committed.

PR-4: baseline test demanded `snapshot()` once per request, cementing the
defect. Transparent real-backend read observation replaces only that internal
call-count criterion; exact existing protocol responses remain checked.
