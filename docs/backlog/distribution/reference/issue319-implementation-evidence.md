# PR #321 implementation evidence

## I3 reported persistence failure

Baseline 6288fe1f188ed4e8f055a7b8d50d3d7ba267ed39; real Chromium/no-COI SDK,
Worker, Memory VFS mirror + native OPFS. Only native createWritable rejection
injected; no product substitution. npm empty manifest produces real lockfile;
real CLI writes output.txt.

Command: `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi no-coi-persistence.fault.spec.ts`.
RED: 2 failed; install and build both returned `{resolved:true}` despite native
QuotaExceededError. First CLI fixture attempt used an unsupported launcher;
corrected to existing emitted launcher form before capturing the two REDs.

Root: no-coi-toolchain-worker flushMirror casts away PersistFailureReport.
Class quota-perm-fail/provenance-lie; storage boundary. Sibling install/run-bin/
restore-activation share flushMirror and now the complete `total` check.
Other workbench durability consumers already inspect total. Generic runtime eval/
fs use the same cast; evaluated separately before warm-open proof relies on them.
No lost/reordered OPFS operation exclusions assumed.

GREEN I3: same command, 2 passed (4.8s); both failures settle as explicit errors.
I4 RED: `RIFTY_NO_COI_PORT=5511 RIFTY_NO_COI_ORACLE_PORT=5512 RIFTY_NO_COI_RESOURCE_PORT=5513 pnpm test:no-coi no-coi-install-dedup.spec.ts`: 1 failed, expected zero writes/mkdir; actual index.js writes=4, nanoid mkdir(create)=5. Same-length repair passed before count assertion.
