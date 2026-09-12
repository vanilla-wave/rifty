# Scratch clean-publication probe

2026-09-09; source revision `e5122ed5f39ecf4eb411419b03c390306d381ebc`.
User requested assessment of the 2026-08-30 FS dirty-stamp wrap-up, not a repair.
The wrap-up identified `keepLocalDirty`; this probe narrows its consequence.

Run from the repository root after dependency installation:

```sh
node --input-type=module <<'JS'
import { build, version } from 'esbuild';
await build({entryPoints:['apps/playground/src/glue/page-store.ts'],outfile:'/tmp/rifty-dirty-stamp-page-probe-local.mjs',bundle:true,platform:'node',format:'esm',conditions:['browser'],nodePaths:['apps/playground/node_modules']});
const { createPageStore } = await import('/tmp/rifty-dirty-stamp-page-probe-local.mjs');
const store = createPageStore();
const snapshot = dirty => ({activeId:'scratch',projects:[],scratch:{starter:'node-worker',dirty,editedAt:'probe'}});
console.log(JSON.stringify({node:process.version,esbuild:version}));
store.hydrateIndex(snapshot(true));
console.log(JSON.stringify({stage:'owner-dirty',pageDirty:store.dirty()}));
store.hydrateIndex(snapshot(false));
console.log(JSON.stringify({stage:'owner-clean-after-reset',pageDirty:store.dirty(),expected:false}));
JS
```

Exit 0; observation probe, not a passing behavioral assertion:

```json
{"node":"v24.16.0","esbuild":"0.28.0"}
{"stage":"owner-dirty","pageDirty":true}
{"stage":"owner-clean-after-reset","pageDirty":true,"expected":false}
```

Real page-store/Solid implementation; caller-supplied catalog snapshots.
No owner, OPFS, browser or complete Reset execution in this probe.

Source → consequence → authority:

- `apps/playground/src/glue/page-store.ts:279`: `keepLocalDirty` preserves the
  old flag despite a same-starter clean publication.
- `packages/workbench/src/workers/playground-project-authority.ts:2115`: Reset
  records `dirty:false`; ADR-0165 owns starter reset semantics.
- `apps/playground/src/adapters/playground-app.tsx:744` and `:910`: active
  catalog subscription hydrates the store; Reset awaits the runtime operation
  without a local `confirmReset` call. Full browser consequence remains unproven.
