# Workbench namespace preparation evidence

Authority: goal I4 and raw selected-root/no-migration answers in
self-hosted-snapshot-workbench. ADR-0402 owns the additive API/handle route.
I3 accepted source0f8ec6f96b35983a141937e86fbadcff2ed3c85b is BASE.

Independent source research: workbench-storage-namespace-pickup.md.
Initial scratch source before I3 (namespace behavior unchanged):
/tmp/rifty-316-i4-red/EVIDENCE.md. Options30=16 semantic RED/14 baseline GREEN;
actual native OPFS22 assertions=12RED/10GREEN, Chrome148.0.7778.96,
Node24.16.0. Supplied selected handle was ignored; A/B read origin and wrote
outside their physical roots. No VFS/Worker/OPFS methods were replaced.

## Tracked Contract+RED carriers

Source baseline892f4eb71e64e7be9b402ac9d2fc68df853542db; no I4 production edits.
Exact test hashes/commands: /tmp/rifty-316-i4-carriers.json;
independent preparation report: /tmp/rifty-316-i4-carriers.md.

- Vitest workbench-storage-namespace.contract.test.ts:30 cases,
  16 semantic RED/14 controls GREEN. Public selection is discarded and valid
  private selection refused. Raw /tmp/rifty-316-i4-options-red.json.
- Playwright opfs-storage-namespace, workbench-storage-namespace and
  workbench-web-lock specs:7 semantic RED/4 controls GREEN,14.0s,
  Chrome148.0.7778.96. Raw /tmp/rifty-316-i4-browser-red-final.log.
  Native A/B/default handles, call-through outside-file preload observation,
  paired persisted reads/cache paths, selected-root re-init, actual public
  required/preferred/file-conflict/ephemeral paths, acknowledged write then
  uncooperative page reload, real persistent A/B origin-lease contention.
  Invalid public a/b currently reaches Worker/Web Lock/SW once each.
- Focused Workbench and browser fixture TypeScript, Biome and diff checks GREEN.
  /tmp/rifty-316-i4-options-typecheck.log, /tmp/rifty-316-i4-browser-types.log,
  /tmp/rifty-316-i4-biome.log. Candidate lower API overload casts produce real
  baseline behavior; public packed proof uses the typed requested API directly.

Only legacy test fixture options gained optional namespace. Existing assertions
stay unchanged. Private boot fixture uses I3's mode:registry discriminator;
public omitted mode remains unchanged.

Mandatory packed carrier: storage-namespace-proof.ts is called after the accepted
I3 saved-state journey and before its unchanged zero-egress checks. Public typed
namespace A/B, identical saved project id, different source/binary markers, real
Node ms reference output, close/reopen, exact default saved files and native host
sentinel. Definitions are owner-local; snapshot identity/manifest come from the
real published producer. `pnpm test:packed-consumer`: expected RED after real
build/pack/offline install,75.14s. Installed declarations reject namespace with
TS2345; no browser result claimed for this stopped run.
Raw /tmp/rifty-316-i4-packed-red.log. Lower semantic browser REDs above distinguish
mount behavior independently of this public API absence.

Prior owner storage policy/proof carriers rerun at the same baseline:
`pnpm exec vitest run packages/workbench/src/workers/owner-storage.test.ts
packages/workbench/src/workers/workbench-owner-storage.test.ts`:15/15 GREEN,
including exact persisted read-back refusal and bounded preferred fallback.
Raw /tmp/rifty-316-i4-storage-controls.log. `pnpm docs:check` GREEN,
/tmp/rifty-316-i4-prep-docs.log.
