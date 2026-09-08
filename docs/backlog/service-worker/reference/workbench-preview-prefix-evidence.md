# Workbench preview-prefix evidence — 2026-09-09

Baseline for this compile: `b7b504b51`
(I6 Final+GREEN + rechart). Goal I5 and intake:
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` (I5:
fixed `/preview/<port>`; no prefix option).

## Current addressing

`packages/io/src/preview-protocol.ts` `PREVIEW_PREFIX_RE` is
`/^\/preview\/(\d+)(\/.*)?$/`. `parsePreviewPath` takes one argument.
`packages/workbench/src/workers/preview-registry.ts` hardcodes
`` `/preview/${port}/` ``. SW `matchPreviewUrl` calls `parsePreviewPath`
with no prefix.

Node v24.16.0, this tree:

```text
$ node --input-type=module -e "
import { parsePreviewPath, PREVIEW_PREFIX_RE } from './packages/io/src/preview-protocol.ts';
const paths = [
  '/preview/5173/',
  '/preview/5173/src/main.ts',
  '/sandbox/preview/5173/',
  '/sandbox/preview/5173/src/main.ts',
  '/api/preview/5173/',
];
for (const p of paths) {
  console.log(JSON.stringify({ path: p, parsed: parsePreviewPath(p), re: PREVIEW_PREFIX_RE.test(p) }));
}
"
{"path":"/preview/5173/","parsed":{"port":5173,"rest":"/"},"re":true}
{"path":"/preview/5173/src/main.ts","parsed":{"port":5173,"rest":"/src/main.ts"},"re":true}
{"path":"/sandbox/preview/5173/","parsed":null,"re":false}
{"path":"/sandbox/preview/5173/src/main.ts","parsed":null,"re":false}
{"path":"/api/preview/5173/","parsed":null,"re":false}
```

`WorkbenchOptions.deployment` has no `previewPrefix`.
`validateWorkbenchOptions` ignores an extra key. `SW_ROUTING_VERSION` is
`'6'`.

## I5 REDs

Vitest 2.1.9, Node v24.16.0 — 12 failed | 1 passed (omitted `/preview/`
parse still works). Failures are unimplemented prefix, not import/typecheck:

```text
$ pnpm exec vitest run packages/io/src/preview-prefix.contract.test.ts \
  packages/workbench/src/workbench/workbench-preview-prefix.contract.test.ts \
  packages/workbench/src/workbench/workbench-preview-prefix.fault.test.ts \
  packages/workbench/src/workers/preview-prefix.contract.test.ts \
  packages/service-worker/tests/preview-prefix.contract.test.ts
parse('/sandbox/preview/5173/', '/sandbox/preview') → null
admitted.previewPrefix → undefined
invalid prefix / out-of-scope prefix → no throw
registry url → '/preview/5173/'
match('/sandbox/preview/5173/', '/sandbox/preview') → null
```

Playwright 1.60.0 Chromium:

```text
$ RIFTY_PLAYGROUND_PORT=5411 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts \
  tests/browser-unit/workbench-preview-prefix.spec.ts
1 failed: parsePreviewPath('/sandbox/preview/5173/src/main.ts',
  '/sandbox/preview') is null (not import/NotFound).
```
