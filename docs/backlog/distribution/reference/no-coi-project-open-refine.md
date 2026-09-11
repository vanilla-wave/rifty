# No-COI project open — refine evidence

2026-09-10, source baseline `2c7f9bbf4`.

## Request and sources

User first requested integration-issue validity and grouping into one/two
iterations. After the proposed #327+#328+#329 startup/storage/snapshot group,
user requested: «$rifty-refine первую часть». This authorizes refinement only.

Original sources:
- https://github.com/vanilla-wave/rifty/issues/327 — published producer consumer,
  snapshot-only acquisition, saved open, explicit update, source preservation,
  input/persistence honesty and no completed claim after interrupted restore.
- https://github.com/vanilla-wave/rifty/issues/328 — selected OPFS namespace
  before indexing/preload; required/preferred storage; no global override,
  migration, security isolation, eviction guarantee or same-namespace owner claim.
- https://github.com/vanilla-wave/rifty/issues/329 — validated effective
  configurable startup/hydration budget, defaults, teardown and late-result honesty.

All three bodies were read through GitHub CLI. They describe a static published
0.7.0 audit, not a supplied standalone reproduction. Current public types and
worker call paths confirm the SDK interface gaps; no implementation is claimed.
Dedup and wider issue disposition: `product-integration-issue-triage.md`.

## Scope sources

| Source | Observable consequence | Authority / owner |
|---|---|---|
| #327, ADR-0387/0398 | Existing producer format; browser registry capability absent in snapshot-only mode; local lock/cache replay still available | Accepted reuse; no new installer/archive format or guest-network prohibition |
| #327, ADR-0394 | Initial materialization distinct from saved open and explicit apply; unused changed artifact cannot reseed saved files | Existing application policy, not a new user choice |
| ADR-0394 decisions 1/4/5 | Explicit apply runs even for same identity; error by default, overwrite selectable, untargeted files retained | Reused generic path/type/byte conflict policy; no dependency-specific merge |
| ADR-0392; ADR-0415 retained clause | Current SDK toolchain.open rejects missing/pending/incompatible trust | Baseline changed by the round 1 user answer; superseded gate in ADR-0417 |
| #328, ADR-0402 | Literal namespace fixed for worker lifetime; omission retains origin root; selected new directory starts empty; no migration | Existing namespace meaning and issue host responsibility |
| #328, owner-storage.ts | Required rejects unavailable OPFS; preferred reports memory fallback; unreadable existing preload stays fatal | Existing storage policy, not eviction protection |
| #329, host.ts | Budget starts with existing worker startup/handshake; includes code startup and OPFS hydration; initial sandbox SW admission and later snapshot apply are distinct phases | Existing timer owner; document scope, no whole-open latency SLA |
| #329, ADR-0410 range policy | Validate before effects; finite positive native-range budget; no hidden shorter deadline for the same promised startup work | Reuse bounded native timer semantics; exact transport/API is agent-owned |
| Round 1 user answer | Open actual saved files without install-status admission; failure at installation/use, optional force overwrite | User rejected both proposed status-based recovery branches; ADR-0417 |
| Current no-COI tier, rifty/README.md | Real Vite 7 is an acceptance carrier; threaded-WASM remains the existing loud gap | No new package/toolchain compatibility promised by these issues |

The budget is not claimed to cover later snapshot download/materialization or
guest execution. Existing bounded archive acquisition still owns body stalls and
size limits. Pickup must inspect all reachable startup timers before choosing the
configuration carrier. API names remain agent-owned; a new first-open receipt or
installation stamp cannot be introduced as an internal detail after round 1.

## Executed reference checks

Node `v24.16.0`, Vitest `2.1.9`:

```text
pnpm exec vitest run packages/workbench/src/workers/owner-storage.test.ts packages/workbench/src/workers/workbench-snapshot-only-acquisition.contract.test.ts packages/workbench/src/workers/workbench-snapshot-apply-rollback.contract.test.ts
3 files passed; 26 tests passed; 3.32s.
```

Real existing storage selection and Memory VFS/catalog/producer contracts; only
external boundaries use test fixtures. Establishes reusable Workbench behavior,
not SDK snapshot consumption, native OPFS crash behavior or future GREEN.

Current SDK source: no-coi-toolchain-worker.ts demotes before install and promotes
after flush; missing proof makes openInstallation reject. Shared
dep-snapshot-application.ts provides preflight/cache/overlay but no rollback.
Workbench rollback is in its catalog transaction (ADR-0394 decisions 6–7), not
createNoCoiInstallContext. Thus automatic rollback is not a free SDK API forwarding.

## Challenge

Fresh read-only critic `/root/startup_scope_critic` received the original issue
bodies, user request, existing draft and applicable ADRs; no author conversation.
Verdict verbatim:

> challenge: 2026-09-10 — 1 problem: crash/reload outcome of the new SDK snapshot application remains user-owned. Preserved sources plus explicit retry versus automatic recovery of the previous installation is unresolved. Premise and reuse direction are supported; no additional independent material fork found.

Verified against #327, SDK demote/install/promote, shared overlay helper and
ADR-0394 catalog ownership. No new independent fork was found. This is an early
premise check, not the final written-result review.

## Round 1

Asked: if the tab closes during snapshot update, preserve sources and explicitly
report incomplete installation for host-triggered retry (recommended), or
automatically recover the previous working installation? #327 only requires
truthful non-completion; the stronger recovery promise changes observable scope.
User answer verbatim:

> Мне кажется тут надо поступить так же как и с dirty check, который недавно выпилили. Среда не должна знать статус установки - ровно как и в реальной экосистеме. Если не получается поставить вываливается ошибка. Максимум  - флаг форса про "поставь сюда и перетри все что будет мешать"

This rejects BOTH proposed status-based recovery branches. Ordinary saved access
is not contingent on a completed-install certificate, nor an obligatory retry.
After a partial application, use actual files; missing dependencies fail at use.
Explicit apply returns its own failure. Force means conflicting payload targets,
including descendants of a directory replaced by a file, not whole-project reset.
The host chooses initial creation/update timing; it need not track installation
status. No automatic retry or rollback promise is added. Existing Workbench
catalog rollback and real VFS recovery are not removed by this SDK-only decision.

Precedent checked: `docs/backlog/playground/reference/project-open-ide-boundaries-refine.md`
contains the user's prior «да, ок, ровно поведение node» for saved access after
interrupted install. ADR-0415 explicitly retained ADR-0392's SDK gate, so extending
that behavior requires the scoped supersession now recorded in ADR-0417.

## Native reference after the answer

Executed with Node `v24.16.0`; no npm invocation or real installation interruption
is claimed. Disposable directory contains a manifest requiring an absent package,
invalid lock JSON, a local CJS program and a CJS require of that absent package:

```js
import {mkdtempSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const root=mkdtempSync('/tmp/rifty-sdk-open-reference-');
writeFileSync(root+'/package.json', JSON.stringify({name:'sdk-open-reference',private:true,dependencies:{'rifty-absent-reference-package':'1.0.0'}}));
writeFileSync(root+'/package-lock.json', 'interrupted lockfile');
writeFileSync(root+'/local.cjs', "console.log('LOCAL_SOURCE_OK')\n");
writeFileSync(root+'/missing.cjs', "require('rifty-absent-reference-package')\n");
const local=spawnSync(process.execPath,[root+'/local.cjs'],{encoding:'utf8'});
const missing=spawnSync(process.execPath,[root+'/missing.cjs'],{encoding:'utf8'});
console.log(JSON.stringify({node:process.version,localExit:local.status,localOutput:local.stdout.trim(),missingExit:missing.status,missingCode:missing.stderr.includes('MODULE_NOT_FOUND')?'MODULE_NOT_FOUND':'unexpected'}));
```

Command: `node --input-type=module` with this script on stdin. Exit 0:

```json
{"node":"v24.16.0","localExit":0,"localOutput":"LOCAL_SOURCE_OK","missingExit":1,"missingCode":"MODULE_NOT_FOUND"}
```

This discriminates project-wide install-status admission from ordinary Node
execution. Snapshot import, native browser persistence and adapter laziness still
need their Contract+RED and final browser proof during implementation.

## Revised Challenge / DEC-2

Fresh read-only `/root/sdk_open_decision` received original sources, exact answer,
prior raw dirty/open decision and ADRs, not the author conversation. Verbatim:

> challenge: 2026-09-10 — revised premise supported. User rejects persisted installation-status admission, including explicit-install-required after interrupted materialization. Ordinary saved access and independent commands remain available; dependency/adapter failures belong at use. Explicit validated snapshot application with optional conflict overwrite needs no completion ledger, automatic retry or rollback guarantee. No unresolved user-owned fork found. Preserve real input integrity, validated adapter facts and existing storage recovery; do not infer removal of unrelated Workbench transaction policy.

Verified: SDK open currently checks stamps before decoder/adapter activation;
removing only the stamp check can move refusal into eager adapter activation.
Goal therefore requires independent commands to remain available with unusable
lock/adapter bytes, with actual adapter use failing explicitly. No fake adapter.
The new ADR supersedes only SDK gate/certification clauses in ADR-0392 and the
corresponding retained exception in ADR-0415. ADR-0394 Workbench catalog policy and
ADR-0398 registry absence/local replay remain active.

## Final written-result check

Fresh read-only `/root/refine_final` reviewed all 13 actual documentation files at
`5bc41b01e3def0919f28c38c5320adbd58e88837` against raw sources and user answers:
PASS, no findings; exact verdict in `no-coi-project-open-refine-final-green.json`.
Goal promoted ready after review; children remain draft. SDK implementation and
I1–I6 browser proof remain future work, not completed refinement checks.

`pnpm pr:check`: docs-only 20/20 pass. Source lanes typecheck, build:libs,
check:arch, test:run, test:parity skipped by classifier. Initial sandbox attempt
failed four tsx checks on local IPC permission and the missing dist gate; unchanged
build:libs completed, elevated pr:check passed. No gate changes or test weakening.
