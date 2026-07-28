# Vite 8 durable tree replacement refine probe

- Recorded: 2026-07-28
- Current application: `4e64671e539b86cb0230fb5436e337a7abc5ec8c`
- Predecessor carrier: `c043302541f639464d310fe1e9ab74a4c084f136`
- Node: 24.16.0
- Playwright: 1.60.0
- Chrome for Testing: 148.0.7778.96

The predecessor's five proof paths were restored without product changes:

- `tests/e2e/fixtures/vite8-pre-policy/baked-snapshot-identities.json`
- `tests/e2e/fixtures/vite8-pre-policy/project-definition-source.json`
- `tests/e2e/fixtures/vite8-pre-policy/snapshot-delta.json`
- `tests/e2e/helpers/vite8-cross-build.ts`
- `tests/e2e/vite8-durable-reopen-invalidation.spec.ts`

Command:

```sh
RIFTY_PLAYGROUND_PORT=5291 pnpm exec playwright test \
  tests/e2e/vite8-durable-reopen-invalidation.spec.ts \
  --project=chromium-heavy --workers=1
```

The raw predecessor carrier failed immediately after confirmed Reset: it
expected one snapshot request and a complete dependency tree but observed zero
requests. Source tracing showed that Reset of inactive A replaces A with its
definition seed while the runtime reopens the previously live B. Acquisition
belongs to the later explicit open of A. The predecessor's activation
half-switch had accidentally left A active and hidden this phase distinction.

A disposable corrected carrier proved:

1. immediately after Reset, B remains live; A keeps its durable id and exact
   current definition seed; the user edit, old lock, and old `node_modules`
   tree are absent; acquisition requests are zero;
2. explicit online open of A performs exactly one current snapshot request,
   writes the v4 claim and exact current 367-path tree, and executes the
   Rolldown binding/core/runtime tuple;
3. offline B→same-A reopens with zero acquisition, the identical current tree,
   Vite build, hashed production asset, and preview output.

The strict corrected run passed 1/1 in 57.1 seconds. The carrier remains
uncommitted because moving the complete-tree oracle from Reset to explicit open
conflicts with the ready contract and requires manual refinement first.
