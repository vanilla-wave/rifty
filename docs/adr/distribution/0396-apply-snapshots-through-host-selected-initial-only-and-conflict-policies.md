# ADR 0396: Apply snapshots through host-selected initial-only and conflict policies

Status: Accepted
Date: 2026-09
Refines: ADR-0279, ADR-0261, ADR-0307, ADR-0346, ADR-0386

> TL;DR: Hosts pass `snapshotApplication` on catalog create/open; default
> initial-deployment-only keeps saved files and ignores unused snapshotId;
> apply evaluates snapshot payload with error/overwrite preflight.

## Context

Goal self-hosted-snapshot-workbench I8. `createScratch` reseeds when
`baselineFingerprint` changes, and that fingerprint includes `snapshotId`.
A disposable catalog probe (embedder-gaps-evidence) writes `user.txt`, then
calls `createScratch` with a new snapshotId and `preserveDirtySameStarter`:
dirty becomes false and `user.txt` is gone. Named `openProject` throws
`ProjectDefinitionMismatchError` on the same drift. Hosts need saved state
after first seed, and an explicit apply with generic file conflicts.

User-owned policy is settled: default initial-deployment-only; apply is
requested; conflict is overwrite or error (error default); no
package.json/lock/`node_modules` special case. This ADR names the carrier
and install-claim seam.

## Decision

Public types on `@riftydev/workbench` Playground catalog/open:

```ts
type SnapshotConflictPolicy = 'error' | 'overwrite';
type SnapshotApplication =
  | { readonly mode: 'initial-deployment-only' }
  | { readonly mode: 'apply'; readonly conflict?: SnapshotConflictPolicy };
```

Omitted `snapshotApplication` is `{ mode: 'initial-deployment-only' }`.
Apply `conflict` omitted is `'error'`. The field is an operation input, not
a plan/identity field (it must not enter `identityFields`).

Carriers:

- `PlaygroundProjectCatalog.createScratch({ definition, snapshotApplication?, preserveDirtySameStarter? })`
- `PlaygroundProjectAuthority.openProject` / `PlaygroundProjectOpenOptions.snapshotApplication`
- the existing owner `create-scratch` and `playground-open-project` frames

`preserveDirtySameStarter` stays for non-snapshot starter/baseline preserve.
Snapshot-backed projects use `snapshotApplication` instead of treating
snapshotId drift as a reseed.

**Initial-deployment-only.** If Scratch or the named project is absent, seed
with the existing create/first-materialization owners. If it exists, keep
saved files even when the supplied snapshotId (or unused snapshot
templateId) changes. Do not fetch or restore that unused asset. Catalog
adoption/baseline stays the last applied snapshot, not the unused new id.
`openProject` must not throw definition mismatch solely for unused snapshot
provenance. Other identity drift (starter, template, plan files, kind)
keeps today's mismatch/reseed. Missing or stale install trust is not
"project absent" and does not reseed or auto-install. Unreadable/missing
tree fails loudly with retained bytes.

**Apply.** Every requested apply evaluates the snapshot *payload* (tar
`payload/` or v3 `nodeModules` + `package-lock.json`) against the existing
tree, including when snapshotId is unchanged. Control/`rifty/` and tarball
cache are not project files. Root `package.json` is an ordinary conflict
only when that path is in the payload. Conflict is structural: different bytes at a
file path, or file-vs-directory / ancestor type clash. Identical bytes and
directory/directory coexistence are not conflicts. Missing payload paths are
additions. Extra saved paths are not deletions.

Error: report every conflicting path on `SnapshotApplicationConflictError`
(`name`, `paths: readonly string[]`) before any payload write, including
additions. Overwrite: replace conflicting targets (and the subtree of an
incompatible directory target), add missing payload files, keep extras.
Then update catalog adoption to the applied snapshot.

Policy owns selection and preflight. Effects stay on ADR-0279 catalog
transactions and existing snapshot restore/acquisition. After overwrite,
ADR-0261/0307 retire and rederive install claims from the resulting tree;
do not run `install()` to manufacture a clean claim.

Crash/reopen: a partial apply is not published as complete; the preserved
copy remains. Use the existing catalog transaction / prepare-then-apply
restore, not a second write coordinator.

Candidates: keep snapshotId in baseline and reseed — violates I8. Add
`applySnapshot()` and leave `createScratch` reseeding — boot path still
wipes files. Put policy on the plan — it would enter identity and lie
about unused ids. Operation-level `snapshotApplication` plus last-applied
catalog identity — selected.

## Consequences

Embedders reopen with a newer baked snapshot without losing edits. Explicit
apply is the only update. Snapshot-only admission (I3) reads this policy
before it demands a snapshot. Playground first-party UI may keep passing
`preserveDirtySameStarter` for starter changes.
