# No-COI warm-open — Contract+RED preparation

2026-09-08. Goal I1/I2 and claim-related I3; implementation not started by this
agent. Checkout HEAD at capture:
`6288fe1f188ed4e8f055a7b8d50d3d7ba267ed39`; shared working tree also contains
the driver's independent persistence/preload work. No public open implementation
was present during either browser run.

## Executed RED

Node v24.16.0; Playwright 1.60.0; Chromium 148.0.7778.96. Public SDK, real
Workbench Worker, native OPFS, headerless no-COI page. Native wrappers forward
real calls; quota tests substitute only native `createWritable` rejection.

```sh
RIFTY_NO_COI_PORT=5521 RIFTY_NO_COI_ORACLE_PORT=5522 RIFTY_NO_COI_RESOURCE_PORT=5523 pnpm exec playwright test --config playwright.no-coi.config.ts tests/no-coi/no-coi-warm-open.spec.ts --reporter=list
```

First sandboxed attempt failed before tests (`listen EPERM 127.0.0.1:5521`).
Authorized local-browser retry with `--grep 'full page warm-open'`: one failure,
815 ms. Full spec afterward: 12 failures, all at the same discriminating public
admission assertion:

```text
[warm-open] Chromium/148.0.7778.96
Expected: { coi: false, openType: 'function' }
Received: { coi: false, openType: 'undefined' }
12 failed
```

The remaining Vite, preservation, cached repair, drift and persistence-fault
assertions are executable GREEN targets, not baseline observations. The RED
proves missing public activation only. No local Vite timing/success claim.
`pnpm exec biome check` on the three new test/fixture files passed.

## Node execution oracle

Executed Node v24.16.0 against real temporary files, then removed only that
temporary fixture:

```js
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const fixture = mkdtempSync(join(tmpdir(), 'warm-open-node-oracle-'));
try {
  const packageDir = join(fixture, 'node_modules', 'fixture');
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'edited.cjs'), 'module.exports = { nanoid: () => "saved-edit" };');
  const require = createRequire(join(fixture, 'entry.cjs'));
  const edited = require(join(packageDir, 'edited.cjs')).nanoid();
  let missing;
  try { require(join(packageDir, 'deleted.cjs')); } catch (error) { missing = error.code; }
  console.log(JSON.stringify({ node: process.version, edited, missing }));
} finally { rmSync(fixture, { recursive: true, force: true }); }
```

Command: `node --input-type=module` with the script on stdin. Output:

```json
{"node":"v24.16.0","edited":"saved-edit","missing":"MODULE_NOT_FOUND"}
```

The browser full-page case asserts these observed module-loading outputs.
Explicit install repair follows the accepted rifty baseline, not npm's repair
policy.

## Independent authority research

- Current no-COI install calls npm-client directly and returns host-held
  activation state; it never mints Workbench claims. 0.6 saved tree/lock alone
  cannot prove a successful installation or its durability.
- Replay install violates the accepted preservation policy. A separate persisted
  activation receipt duplicates existing authority and lock bindings.
- v4 install stamp owns root, exact manifest, lock hash and generated artifact
  policy identity. An explicit no-COI protocol/request discriminator can reuse
  its existing identity slot; incompatible/missing claims stay untouched.
- `npm-client/internal` exports `planShadowSubstitutionsFromLockfile`; it checks
  canonical trace/provenance and yields bindings without materialization. No
  second binding metadata file is required.
- Reserved claim protection currently belongs to
  `createOwnerVfsAuthorityComposition`: ordinary fs is separate from privileged
  claim IO. Reusing the raw mirror would permit imported/copied trust claims.
- That full wrapper also owns tree revisions/journal/eager indexing. A smaller
  shared reserved-claim adapter would need extraction from its existing guards,
  not a new generic trust framework. Composition must happen before the runtime
  module loader captures the mirror (`runtime-js/src/worker-entry.ts`, after
  backend selection/fallback and before `createModuleLoader`). `initBackend`
  always replaces the mirror; pre-import initialization or late replacement
  does not establish a single captured authority.
