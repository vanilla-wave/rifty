# PR #323 — npm/catalog reflection proof

2026-09-10; baseline `9c78f7db2ece433beab2917ac7461b667c3c014b`.
User: «добавляй доводи до зеленого ci и мержи», accepting one fault test at
real npm → catalog, RED on swallowed reflection error, GREEN on existing code.
Authority: ADR-0414; `scratch-dirty-ide-ownership.md` Fault matrix
`quota-perm-fail × catalog reflection → scenario`, read at `516b4dc14` before
delete-on-done. Existing behavior proof (`RDY-8`), no new runtime promise.

## Carrier

`packages/workbench/src/workers/playground-npm-catalog.fault.test.ts`:
real Shell/npm installer, real ms2.0.0 tarball, package authority, companion
observer and catalog. Existing DurableOwnerFs injects only persistence faults;
network returns committed upstream bytes. No installer/catalog mocks.

A successful `npm install --save-dev ms@2.0.0` makes clean Scratch dirty and
identifies its actual catalog write. Repeat from the same durable seed with
quota-report or permission-rejection at that write. Manifest change proves
the package operation took effect; command exits1 with the storage error.
Catalog remains the prior value both live and after durable restart.

## RED

Vitest2.1.9. Before this carrier, removing the observer's reflection-error throw
left 273 existing npm/runtime/catalog tests passing (inline review C1).
Reproduce the same mutant without editing tracked source:

```sh
node --input-type=module <<'JS'
import { writeFileSync } from 'node:fs';
const config = [{
  root: process.cwd(),
  test: {
    name: 'catalog-reflection-mutant',
    environment: 'node',
    include: ['packages/workbench/src/workers/playground-npm-catalog.fault.test.ts'],
  },
}];
const plugin = `[{name:'swallowed-reflection',enforce:'pre',transform(code,id){
  if(!id.endsWith('/playground-package-mutations.ts'))return;
  const target='if (reflectionFailure !== undefined) throw reflectionFailure;';
  if(!code.includes(target))throw new Error('mutation target absent');
  return code.replace(target,'/* swallowed reflection error */');
}}]`;
writeFileSync('/tmp/rifty-pr323-catalog-mutant.workspace.mjs',
  'export default ' + JSON.stringify(config).replace('"test":', '"plugins":' + plugin + ',"test":'));
JS
pnpm exec vitest run --workspace /tmp/rifty-pr323-catalog-mutant.workspace.mjs
```

Executed: both cases fail at `expect(result.exitCode).toBe(1)`:
`expected +0 to be 1`; 2 failed, 0 passed. Fault-path and changed-manifest
assertions before that line pass. No import/type/harness error counted as RED.
An initial carrier attempt omitted the upstream tarball route and failed during
healthy installation; corrected before this RED, never counted as product proof.

## GREEN

Without the transform, the same new file passes2/2. Production code unchanged.

`pnpm exec vitest run packages/workbench/src/workers/playground-npm-catalog.fault.test.ts packages/workbench/src/workers/owner-package-state.test.ts packages/workbench/src/workers/playground-project-catalog.contract.test.ts`:
74/74 pass, 3 files; both new fault cases and retained baseline.
