---
area: vfs
status: ready
title: Capability-derived OPFS selection without COI + reload proof
created: 2026-08-28
epic: no-coi-sandbox-tier
why: boot.ts:23 forces the memory backend whenever !crossOriginIsolated, but OpfsFsSync needs only a dedicated-worker realm (isSupported checks createSyncAccessHandle presence, never COI) — spike-proven policy gate, costs persistence in the no-COI tier
user_story: As an agent platform on a headerless page, I want a project to survive a page reload, but today the VFS silently degrades to memory because the OPFS backend is COI-gated by policy
sources: [ADR-0002, ADR-0072, ADR-0165, ADR-0372, docs/backlog/distribution/reference/no-coi-hmr-spike-record.md, docs/backlog/vfs/opfs-persistence-browser-roundtrip.md]
code: [packages/vfs/src/boot.ts, packages/vfs/src/opfs-sync.ts, packages/vfs/src/opfs.ts]
---

## Context

`detectVfsBackend` currently requires `crossOriginIsolated === true`, then asks
`OpfsVfs.isSupported()`. That is the wrong authority for the paired backend:
`installOpfsFs()` always constructs `OpfsFsSync`, whose actual requirement is a
dedicated Worker exposing
`FileSystemFileHandle.prototype.createSyncAccessHandle`. Chrome exposes that
capability without COI; `OpfsVfs.isSupported()` checks only the async
`navigator.storage.getDirectory` surface and is true in a main window that
cannot host the sync mirror.

Current-source evidence C148-OPFS ran against production source
`e924531ba2d46116406a68c9d4a86e59106ef24b`, Playwright 1.60.0, Chrome for
Testing 148.0.7778.96:

```sh
RIFTY_PLAYGROUND_PORT=5314 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-no-coi-policy.spec.ts -g preservation
# 4 passed
# headerless page main realm: async=true, sync=false, detected=memory
# headerless dedicated Worker: COI=false, SAB=undefined, async=true, sync=true;
# direct OpfsFsSync write+flush(total=0)+page reload+fresh Worker read returned
# [0,1,2,127,128,254,255,13,10]
# COI dedicated Worker kept detected=opfs and the same exact-byte reload result
# injected getDirectory NotAllowedError surfaced as "NotAllowedError: pickup denied"

RIFTY_PLAYGROUND_PORT=5314 pnpm exec playwright test --config playwright.browser-unit.config.ts tests/browser-unit/opfs-no-coi-policy.spec.ts -g "no-COI capable"
# 1 failed at the intended policy assertion after every realm/capability/header
# precondition passed: detected=memory, backend=memory, flush=null; fresh Worker
# read → VfsError ENOENT. Expected detected/backend=opfs + clean flush + exact bytes.
```

ADR-0372 corrects only ADR-0072's inherited backend-selector clause and
ADR-0165's generic detector description. ADR-0165/D-001 still require the
Playground/Workbench page to be COI; this unit never creates a Playground
no-COI mode. The direct browser carrier cross-links the older COI shell-path
residual `docs/backlog/vfs/opfs-persistence-browser-roundtrip.md` without
claiming to close it.

## Challenge

challenge: 2026-08-28 — 4 problems
- Evidence not where the doc points: sources list [ADR-0072, runtime-js/reference/no-coi-degradation-probes.md], but the probes doc contains zero OPFS/reload/durability rows (verified grep; its provenance is the first spike only) and ADR-0072 is about the content cache — the load-bearing reload-proof lives only in FINDINGS-HMR.md §5-6 on rot-prone branch t3code/prototype-hmr-agent-scenarios, which that same probes doc says must be inlined to a durable record before building on it.
- Factual error in `why`: OpfsVfs.isSupported (packages/vfs/src/opfs.ts:46-50) checks navigator.storage.getDirectory presence, never createSyncAccessHandle — so the promised 'capability-based selection' as described does not actually test the sync-access-handle capability OpfsFsSync needs, and the doc's stated basis for the flip misdescribes the code.
- Proof vehicle has no substrate at this map position: the scoped proof is 'a no-COI sibling of tests/e2e/owner-persistence-reload.spec.ts', but that spec drives the playground owner UI (launcher/terminal helpers), the playground COI hard-assert is pinned by ADR-0165 and playground no-COI mode is explicitly out of the epic's scope (map §Out of scope), and the alternative no-COI sandbox composition only arrives in the later build-loop slice (map item 4) — the item must name what harness actually hosts its e2e or it cannot close its own acceptance.
- Recorded-decision handling unscoped: ADR-0072:5 explicitly carries ADR-0013's boot detector 'unchanged' and ADR-0165:17 restates detectVfsBackend's isolated-only semantics, yet the item scopes no superseding/amending ADR for overturning that condition (CLAUDE.md: contradicting an ADR is IRREVERSIBLE → adr:new).

<!-- Post-challenge edits: P1 → sources now cite the inlined durable record
     (distribution/reference/no-coi-hmr-spike-record.md). P2 conflated OpfsVfs with
     OpfsFsSync — the doc's claim was about OpfsFsSync.isSupported (opfs-sync.ts:241-252,
     checks createSyncAccessHandle); Context now names both classes explicitly. P3 → proof
     vehicle named (browser-unit no-COI page from bare-sab-guard substrate; e2e rides
     build-loop lane). P4 → amending ADR added to pickup scope. -->

## User scenario

An agent platform serves a headerless Chromium page on its own origin. The
page remains `crossOriginIsolated === false` with no `SharedArrayBuffer`. It
starts a real dedicated Worker, calls the ordinary `initBackend()` selection
path, writes the exact byte vector
`[0,1,2,127,128,254,255,13,10]`, receives a clean `flush()` report, terminates
the Worker, reloads the page, starts a fresh Worker, and reads the exact vector
back. No test-only backend force participates in this acceptance path.

## Reference contract

- Browser oracle: Chrome for Testing 148.0.7778.96, actual dedicated Worker,
  OPFS and `FileSystemFileHandle.prototype.createSyncAccessHandle`; Evidence
  C148-OPFS above records raw command/output on source `e924531ba`.
- Selector authority: `OpfsFsSync.isSupported()` is realm-local and requires
  Worker + sync-access-handle capability. `OpfsVfs.isSupported()` proves only
  the paired async surface; ADR-0372 records the policy.
- Node oracle: Node v24.16.0 has neither browser OPFS realm; the existing
  memory pair remains the exact outcome.

## Acceptance

1. The proof page response has no COOP/COEP headers before and after reload;
   page and dedicated Worker both report `crossOriginIsolated === false` and
   `typeof SharedArrayBuffer === 'undefined'` before backend assertions.
2. In that dedicated Worker, sync-handle capability makes
   `detectVfsBackend()` return `opfs`; `initBackend()` installs an
   `OpfsFsSync`/`OpfsVfs` pair. Async OPFS presence alone never authorizes the
   sync backend.
3. Selection-path `writeFileSync` of the exact byte vector followed by
   `flush()` returns `total:0`; after handle close, Worker termination, page
   reload and a fresh Worker/backend init, `readFileBytesSync` returns every
   byte exactly.
4. Node, main-window and sync-handle-unsupported realms select memory. A COI
   capable dedicated Worker remains OPFS with exact reload durability.
5. Storage permission failure during selected OPFS init rejects loudly before
   `initBackend()` can return `opfs`; existing caller-owned memory fallback may
   continue only with its existing visible failure signal. Write-through
   quota/permission failures remain visible in `flush().total/failures`, never
   a clean durability acknowledgement.
6. Playground/Workbench still hard-rejects no-COI per ADR-0002/0165. Its COI
   owner-backed storage state stays authoritative; a main-realm capability
   probe must not relabel a durable owner as ephemeral.

## Parity cases

1. Headerless dedicated Worker, sync handle present: select OPFS, clean flush,
   reload/fresh Worker, exact bytes. Artifact: Evidence C148-OPFS; preservation
   direct path green and selection path RED, Chrome 148.0.7778.96 / Playwright
   1.60.0.
2. Headerless main window with async OPFS but no sync handle: memory. Artifact:
   Evidence C148-OPFS main-window preservation, Chrome 148.0.7778.96.
3. Node browser-API absence: memory pair with shared sync/async backing.
   Artifact: `pnpm exec vitest run --project conformance
   tests/conformance/builtins/vfs-boot.test.ts --reporter=dot` → 2 passed,
   Node v24.16.0 / Vitest 2.1.9.
4. COI dedicated Worker: OPFS and exact reload bytes remain green. Artifact:
   Evidence C148-OPFS COI preservation, Chrome 148.0.7778.96.
5. OPFS init permission denial: `initBackend()` rejects the exact browser
   `NotAllowedError`, never returns an OPFS success. Artifact: Evidence
   C148-OPFS permission preservation, Chrome 148.0.7778.96.
6. Write-through permission/quota denial: mapped async errors stay loud and
   `flush()` reports dirty durability until healed. Artifact: `pnpm exec vitest
   run --project unit packages/vfs/src/opfs-sync.test.ts
   packages/vfs/src/opfs-errors.test.ts -t "flush\\(\\) resolves \\(never
   rejects\\)|NotAllowedError on getFileHandle|QuotaExceededError on
   writeFile" --reporter=dot` → 3 passed, Node v24.16.0 / Vitest 2.1.9.

## Fault matrix

| axis × operation | honest outcome | reproducible artifact / fault target |
|---|---|---|
| `false-fallback` × no-COI capable Worker selection | OPFS, not silent memory | Evidence C148-OPFS selection RED; Acceptance/Parity 1 |
| `sibling-drift` + `provenance-lie` × realm/capability detection and installed pair | sync capability is the one authority; returned backend equals installed mirror | C148-OPFS main/direct/COI rows; Acceptance 2, 4 |
| `quota-perm-fail` × OPFS init | loud rejection before an OPFS success claim; caller fallback retains its visible signal | C148-OPFS permission green; Acceptance/Parity 5 |
| `quota-perm-fail` × write then flush | dirty report carries exact failed operation/path; no clean durability ack | targeted Vitest command in Parity 6 |
| `torn-state` + `lossy-aggregate` × acknowledged flush then reload | `total:0` followed by fresh-realm exact bytes, not count/text-only equality | C148-OPFS direct green + selection RED; Acceptance 3 |
| `concurrent-same-key` × inherited write-through | existing per-path serialization remains the sole owner; policy adds no queue/lock | `pnpm exec vitest run --project unit packages/vfs/src/opfs-sync.test.ts -t "same-path ops complete in call order" --reporter=dot`, Node v24.16.0 / Vitest 2.1.9 |

## Out of scope

- Forced termination before an acknowledged `flush()` does not promise a
  whole-tree generation. The spike observed per-file old-or-new but mixed
  trees; goal I10's later `distribution/no-coi-dev-hmr-restore` slice owns the
  boot-visible pending-write marker. No journal/recovery is claimed at `works`.
- `docs/backlog/vfs/opfs-persistence-browser-roundtrip.md` remains the direct
  COI VFS-level residual; this unit adds the required no-COI selector proof and
  does not delete that item.
- Playground app no-COI mode remains forbidden by ADR-0002/0165 and the goal
  map. The headerless carrier is the browser-unit harness, never Playground UI.
- OPFS API behavior, write-through scheduling, directory semantics, public API
  shape and dependencies do not change; only backend-selection policy does.

## Decisions

ready-verdict: 2026-09-01 — Contract+RED @ 61cf57f9b0f2283215b93e25d2d3462379b4a6b1
final-green: 2026-09-01 — blocker @ 7308d2c9ae2551a34ac9d5c9ae83652e4ec07b60
final-green: 2026-09-01 — pass @ 029f9726dbec274b3552bbc010486b1a62f03e5e

review: checkpoints — persistence/browser policy and reload durability.

- ADR-0372 selects realm-local `OpfsFsSync.isSupported()` and rejects both the
  COI proxy and async-only authority. ADR-0072/0165 remain active with named
  correction pointers; D-001 and Playground COI stay unchanged.
- Evidence C148-OPFS exhausts the user-observable fork: the capability and
  durability work in current Chrome; current selection alone blocks them. No
  user-owned fork remains.
- Expected RED batch is one selection+reload browser scenario; direct no-COI,
  main-window memory, COI OPFS and permission failure are green preservation
  pins.
- No production implementation has started. The RED carrier imports public
  VFS entry points and drives a real dedicated Worker/OPFS; no mock of the
  built backend.
