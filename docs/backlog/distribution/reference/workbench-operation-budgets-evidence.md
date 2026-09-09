# Workbench operation-budget evidence — 2026-09-09

Baseline for this compile: `f57c2c809`
(I5 Final+GREEN + rechart). Goal I7 and intake:
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` (I7:
hidden 30 s ready/proof and 60 s file/tool budgets).

## Current hidden duration owners

Node v24.16.0, this tree. `validateWorkbenchOptions` drops unknown
`deployment` keys. Extra `ownerStartupTimeoutMs` / `projectFileTimeoutMs`
/ `sessionToolsTimeoutMs` are absent from the admitted owner deployment:

```text
$ node --input-type=module -e "…"
{
  "keys": ["workers", "wasm", "previewProbeTimeoutMs"],
  "previewProbeTimeoutMs": 3000
}
```

Shipped defaults (module constants / `??` fallbacks):

| Path | File | Default |
|---|---|---|
| owner ready + close/exit observe | `workbench-owner-port.ts` `WORKSPACE_OWNER_LIFECYCLE_TIMEOUT_MS` | 30_000 |
| OPFS proof | `workbench-owner-storage.ts` `DEFAULT_PROOF_TIMEOUT_MS` | 30_000 |
| VFS commit | `workbench-browser-owner.ts` `PROJECT_VFS_COMMIT_TIMEOUT_MS` | 60_000 |
| session-tools SCM/archive/flush | `playground-session-tools-transport.ts` `requestTimeoutMs ?? 60_000` | 60_000 |
| owner operation silence | `ownerOperationSilenceTimeoutMs` (ADR-0360, already public) | 60_000 |

`installWorkbenchOwnerStorageAuthority` already accepts internal
`proofTimeoutMs`; `runWorkbenchOwner` does not pass it
(`workbench-owner-runtime.ts` storage install is persistence + namespace
only). `createBrowserPlaygroundSessionTools` is called without
`requestTimeoutMs`. Owner initialize `exact()` admits
`previewPrefix` but not a startup duration.

Catalog create/list use ADR-0360 silence only (no hidden total-duration
sibling). `tsRequestTimeoutMs` and `previewProbeTimeoutMs` stay out of
this unit.

## Packed-host composition gap

`tests/integration/fixtures/workbench-vite-consumer/src/main.ts` still
opens with `registryUrl`, SW scope `/`, no `previewPrefix`, ephemeral
storage without `namespace`, and no public duration budgets. The packed
runner materializes the committed Vite JSON snapshot; it does not call
`produceDepSnapshot` from an installed `@riftydev/workbench/dep-snapshot`
tarball.

## I7 REDs

Vitest 2.1.9, Node v24.16.0 — 25 failed | 29 passed (28 existing
browser-owner cases + omitted-budget admission). Failures are
unimplemented public duration budgets and packed-host composition, not
import/typecheck:

```text
$ pnpm exec vitest run \
  packages/workbench/src/workbench/workbench-operation-budgets.contract.test.ts \
  packages/workbench/src/workbench/workbench-operation-budgets.fault.test.ts \
  packages/workbench/src/workbench/workbench-browser-owner.test.ts \
  tests/integration/workbench-packed-host-scenario.contract.test.ts
admitted ownerStartupTimeoutMs / projectFileTimeoutMs / sessionToolsTimeoutMs → undefined
invalid 0/-1/Infinity/NaN/'80' → no TypeError
hung ready at 80 ms still uses hidden 30 000 ms
raised startup 60 000 ms still dies at 30 000 ms
initialize + ownerStartupTimeoutMs → TypeError Invalid owner boot deployment
hung file durability at 80 ms still pending; raised 120 000 ms still dies at 60 000 ms
hung session-tools at 80 ms still pending; raised 120 000 ms still dies at 60 000 ms
packed runner/fixture lack produceDepSnapshot, /sandbox/, snapshot-only, prefix, namespace, budgets
```

## Challenge

Goal I7 and scenario step 7 already chose public effective boot / file /
catalog-SCM-archive budgets and “raising is not defeated by a hidden
shorter sibling.” Cheaper rivals (one mega-timeout; export every timer;
two knobs) die on ADR-0360 semantics and the named groups. No new
user-observable fork.
