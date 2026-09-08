# Snapshot-only admission evidence — 2026-09-08

Baseline for this compile: `76c0ea1b8237e57fb5e30cf84a5111c2d9e5f911`
(I8 Final+GREEN + rechart). Goal I3 rows and intake:
`docs/backlog/distribution/reference/embedder-gaps-evidence.md` (I3:
`registryUrl` required; rejected first snapshot becomes deferred install).

## Current admission

`validateWorkbenchOptions` always calls `httpEndpointUrl(acquisition.registryUrl)`.
`inspectBootConfig` always `nonEmptyString(packageAcquisition.registryUrl)`.
ADR-0263: `PackageAcquisition` is a required validating `registryUrl`.

```text
$ pnpm exec vitest run packages/workbench/src/workbench/open-workbench.test.ts -t 'registry URL'
✓ rejects empty packageAcquisition.registryUrl (TypeError /packageAcquisition\.registryUrl/)
```

Empty object `packageAcquisition: {}` is the same missing-string path.

## Current snapshot rejection

`prepare-first-materialization` uses `fallback: 'snapshot-only'` then catches
`PackageAcquisitionError` `snapshot-unavailable` and returns
`#deferredInstallPlan` (`package-acquisition-authority.ts` ~1023-1046).
Registry-enabled first-materialization contract asserts that fallback
(`workbench-first-materialization.contract.test.ts` ~1877-1899).

Internal snapshot-only ensure already exists; the public catch undoes it.

I3 REDs (7 failing, Vitest 2.1.9): omitted `registryUrl` still required;
Eddy-without-registry throws the required-URL error, not
`packageAcquisition.eddy requires packageAcquisition.registryUrl`; missing,
corrupt, and id-mismatched required snapshots return `kind: 'install'`; a
compatible snapshot restores `kind: 'ready'` then `npm install left-pad@1.3.0`
still starts a network install.

## I8 composition

Unused new snapshot under `initial-deployment-only` does not fetch or reseed
(Final+GREEN @ `89c106c1c079ad6f66df5ffbdd188409d6a065ef`). Snapshot-only
must not re-open that policy.
