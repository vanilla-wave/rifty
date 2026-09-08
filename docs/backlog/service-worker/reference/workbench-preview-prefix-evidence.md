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

Vitest 2.1.9, Node v24.16.0 — 13 failed | 1 passed (omitted `/preview/`
parse still works). Failures are unimplemented prefix / routing version,
not import/typecheck:

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
SW_ROUTING_VERSION still '6' (pin expects '7')
```

Playwright 1.60.0 Chromium — page is `/sandbox/unit-harness.html`, SW
scope `/sandbox/`, prefix `/sandbox/preview`. Failure is unimplemented
prefix routing, not harness 404:

```text
$ RIFTY_PLAYGROUND_PORT=5412 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts \
  tests/browser-unit/workbench-preview-prefix.spec.ts
1 failed (9.5s): advertisedUrl `/preview/43872/` (expected
`/sandbox/preview/43872/`); prefixed iframe/asset are the Vite SPA shell;
rootRelativeBody ''; hmrInjected false. `/preview/43872/` still serves
the guest (today's default prefix).
```
