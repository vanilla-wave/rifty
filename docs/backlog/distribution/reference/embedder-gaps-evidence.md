# Embedder intake evidence — 2026-09-07

Baseline: main 333224fe46f22fe9c974429a81fbc4b7d0cc63f8 (2026-09-06).
User source: in-session review of the 2026-08-21 Tracker embedder report against
Workbench 0.4.0, followed by selection 3, 6, 7, 4, 8, 5, 10 + gzip.
The report's 105 MB / 16 s figures are not reproduced measurements.

## Main observations

| Goal row | Repro/source | Observed result |
|---|---|---|
| I1 | packages/workbench/src/workbench/public.ts; packages/workbench/package.json; apps/playground/tools/bake-dep-snapshots.ts | producer imports private checkout modules; public producer/current identity absent |
| I2 | packages/workbench/tsup.config.ts; packages/workbench/README.md; tests/integration/fixtures/workbench-vite-consumer/host-builtins.ts | external package imports remain; consumer needs aliases and QuickJS host wrapper |
| I3 | packages/workbench/src/workbench/internal/workbench-options.ts; packages/workbench/src/workers/package-acquisition-authority.ts | registryUrl required; rejected first snapshot becomes deferred install |
| I4 | packages/vfs/src/sync-mirror.ts; packages/vfs/src/opfs-sync.ts | installOpfsFs has no root; init gets origin root and preloads all files |
| I5 | packages/io/src/preview-protocol.ts; packages/workbench/src/workbench/internal/workbench-options.ts | fixed /preview/<port>; no prefix option |
| I6 | browser probe below; packages/workbench/src/workers/playground-project-authority.ts | unjournaled orphan blocks createScratch; recovery handles owned journals/stages, not this case |
| I8 | snapshotId replacement probe in Re-fit scope audit below; packages/workbench/src/workers/playground-project-authority.ts | same-project new snapshotId reseeds dirty Scratch; no generic overwrite/error application policy |
| I7 | packages/workbench/src/workbench/workbench-owner-port.ts; packages/workbench/src/workers/workbench-owner-storage.ts; packages/workbench/src/workbench/workbench-browser-owner.ts; packages/workbench/src/workbench/internal/playground-session-tools-transport.ts | hidden 30 s ready/proof and 60 s file/tool budgets |

These are product observations, not real-Node oracle claims. Existing fidelity
and trust gates stand; each child's Contract+RED supplies its deliverable proof.

## Executed checks

Vitest 2.1.9 on the baseline:

```text
pnpm exec vitest run packages/workbench/src/workers/owner-storage.test.ts \
  packages/workbench/src/workers/playground-project-catalog.contract.test.ts \
  packages/workbench/src/glue/git-initial-baseline.test.ts \
  packages/workbench/src/glue/git-initial-baseline.fault.test.ts \
  packages/shell/tests/command-resolver-discovery.test.ts \
  packages/workbench/src/workbench/project-files.contract.test.ts \
  packages/workbench/src/workbench/workbench-browser-owner.test.ts \
  packages/workbench/src/glue/dep-snapshot.test.ts
8 files passed; 162 tests passed.

pnpm exec vitest run packages/workbench/src/glue/dep-snapshot.test.ts -t 'raw gzip bytes'
1 file passed; 1 test passed, 23 skipped.
```

The gzip test passes raw gzip bytes and already-decoded JSON through the real
fetchDepSnapshot decoder. Only fetch is substituted (external boundary).
The producer already uses gzipSync; loader recognizes magic bytes, bounds both
compressed and decompressed bodies at 128 MiB, and verifies snapshotId over
uncompressed serialized bytes. That existing decoding is preserved; the user later clarified the missing
capability is ordinary tar.gz file entries, not this compressed JSON format.

Playwright 1.60.0 Chromium, disposable test on real COI Workbench/OPFS:

```text
RIFTY_PLAYGROUND_PORT=5397 pnpm exec playwright test \
  --config playwright.browser-unit.config.ts temporary-embedder-audit.spec.ts
2 passed (5.3s).
ProjectFiles: beforeReload {dirty:true,persisted:false};
             afterReload {dirty:true,text:"user edit"}.
Orphan: {ok:false,messages:["Catalog mutation target already exists: scratch"]}.
```

Reproduce orphan: fresh isolated browser context → gotoHarness → use native
navigator.storage.getDirectory()/getDirectoryHandle(create:true) to create
/.rifty/workbench/v1/projects/scratch/tree/user.txt with bytes `orphan bytes`,
without catalog.json or transaction.json → attemptBootOwner with
{workspaceId:'embedder-audit',hiddenEmptyBoot:true,persistence:'required'}.
Actual result is the quoted error. This proves recovery is missing for that
state; it does not prove that a normal interrupted catalog transaction creates
that state. The 50 existing catalog contract tests, including fault/restart
rows, passed. Disposable probe code was removed after the run.

## Dedup and boundary inventory

Searched docs/backlog titles, code refs, epic maps/links and
`docs/adr/README.md` Declined concepts for producer, snapshot-only, prebuilt
workers, OPFS root, orphan Scratch, preview prefix and configurable timeouts.
No exact matching item/declined concept for the original seven capabilities.
After the archive clarification, the existing representation question in
playground/snapshot-carries-substituted-bytes-twice matches that part: it is
assigned to dep-snapshot-producer, leaving cache/tree deduplication separate.
Related owners retained:

- docs/backlog/distribution/embed-host-vite-example.md and
  docs/backlog/epics/embeddable-dev-loop.md: ready React/registry-backed dev-loop;
  new goal is the static-assets/snapshot-only headless path, no ready recut.
- docs/backlog/distribution/create-rifty-template.md: new-app scaffolding,
  not an asset distribution or existing-app requirement.
- docs/backlog/playground/baked-snapshot-regeneration.md: first-party freshness,
  cadence and git size; no public producer delivery.
- docs/backlog/distribution/public-api-ai-agent-contract-snapshot-restore.md:
  whole Sandbox state/fork, not baked dependency snapshots.
- docs/backlog/playground/workspace-to-scratch-migration.md: ancient /workspace
  adoption; this namespace choice explicitly does not migrate.
- docs/backlog/playground/project-ingress-transaction.md: folder/Git/archive
  ingress; existing catalog owner is reused, no second transaction authority.
- docs/backlog/playground/reload-crash-consistency-fault-e2e.md: global existing
  operation crash rows; this goal owns new namespace/orphan transition proof.
- docs/backlog/epics/fault-honest-sw-preview/goal.md: termination semantics,
  not configurable addressing; routing prefix preserves that boundary.

Fault models: network (snapshot/assets), storage (OPFS/catalog), Worker/Port
(owner operations), SW (preview). Use docs/process/rules/fault-classes.md.
Existing mechanisms: catalog durable transaction/journal, owner origin lease,
package acquisition FIFO, VFS commit coordinator, owner deadlines and canonical
preview parser. No new coordinator is prescribed; any proposed addition needs
its Class-kill inventory at pickup. Node/package behavior is not approximated.

## Archive scope — user decisions

2026-09-07: producer-generated standard tar.gz, not an arbitrary local
node_modules import. User requires collision-free rifty-specific paths.
Control/cache and user payload must occupy disjoint envelope branches; a user
path with the same text as a control path remains nested in payload. Standard
archive inspection must work without a rifty decoder. No performance number for
tar.gz is claimed. Existing base64 research is context, not this format's proof.

## Standard-archive namespace probe

Python 3.9.6 + bsdtar 3.5.3 / libarchive 3.7.4. Run from any disposable directory:

```python
import io, pathlib, subprocess, tarfile, tempfile
root = pathlib.Path(tempfile.mkdtemp(prefix="rifty-envelope-"))
archive = root / "snapshot.tar.gz"
files = {
    "rifty/manifest.json": b'{"format":1}',
    "rifty/replay-cache/source.tgz": b"cache bytes",
    "payload/rifty/manifest.json": b"user manifest",
    "payload/.rifty/manifest.json": b"user hidden file",
    "payload/payload/user.txt": b"user nested payload",
}
with tarfile.open(archive, "w:gz", format=tarfile.PAX_FORMAT) as out:
    for name, contents in files.items():
        entry = tarfile.TarInfo(name)
        entry.size, entry.mtime = len(contents), 0
        out.addfile(entry, io.BytesIO(contents))
target = root / "extracted"
target.mkdir()
subprocess.run(["tar", "-tzf", str(archive)], check=True)
subprocess.run(["tar", "-xzf", str(archive), "-C", str(target)], check=True)
assert all((target / name).read_bytes() == data for name, data in files.items())
print("5/5 entries preserved by system tar; user and control paths disjoint")
```

Observed listing: all five names above; final assertion passed. This proves
ordinary-tool interoperability of a candidate envelope and same-name separation,
not the future rifty writer/reader, all tar entry types or its input validator.
Names/PAX writer above are a disposable probe, not a mandated implementation.

## Re-fit scope audit

2026-09-07, at 1f5a932fe (product code unchanged from baseline):

- `RegistryClientOptions` has baseUrl/custom fetch, no dedicated auth option;
  current bake script supplies a plain fetch. The goal promises configured
  registry but neither states nor proves authenticated private-registry access.
- `playground-project-definition.ts` includes snapshotId in baseline identity.
  `createScratch` preserves dirty bytes only for a matching baseline. Whether a
  deployed replacement snapshot should refresh an existing edited project or
  await explicit action is not defined in this goal.

Disposable Vitest probe extended the existing real Memory VFS/catalog harness:
create a snapshot-backed Scratch (snapshot id `sha256:` + 64 `a` characters),
open, write user.txt, record a file mutation, close; call createScratch with
otherwise identical definition and id `sha256:` + 64 `b` characters, passing
preserveDirtySameStarter:true. The input asset URL stays unchanged. No package
installation runs in this catalog harness; it isolates catalog selection.

```text
pnpm exec vitest run packages/workbench/src/workers/temporary-refine-scope-audit.test.ts -t 'scope audit:'
Vitest 2.1.9: 1 passed, 50 skipped.
Before: dirty=true, user.txt contains "user edit".
REFINE_SCOPE_SNAPSHOT_UPDATE {"dirty":false,"userFileExists":false}
```

The probe asserts that observed current behavior; it is not a failing regression
or a claimed repair. Temporary test removed. This qualifies the earlier same-
definition reload proof: that proof never changed snapshotId and still stands.

## Round 2 decisions and dependent frontier

User: builder-owned authentication is unnecessary; embedding environment owns
private-registry access. User: explicit apply-snapshot and initial-deployment-
only modes, with the latter default and saved state taking priority; chose
preserve all old files and stop on incompatibility before explicit update.
This adds I8, false on the same baseline as the snapshotId reseed probe above.

Apply mode now exposes two user-owned branches not answerable before mode
selection: reapply unchanged identity vs only changed id (F3); reject a changed
dependency request vs replace its package.json/lockfile (F4). These are asked in
round 3; no internal choice or implementation has settled them.

## Round 3 resolution

User rejected dependency/package-specific branches: generic file conflicts
must select overwrite or error through explicit configuration. The same answer
covers repeated snapshot identity and changed package manifest. Derivation:
apply mode evaluates payload independently of previous id; identical entries
are not conflicts; error defaults under the earlier preserve/stop choice.
No implicit deletion of unrelated saved paths is requested. Archive validation,
compatibility and integrity checks still apply to producer artifacts.

The new distribution/workbench-snapshot-application-policy child owns I8 and
composes before snapshot-only admission. No matching existing draft was found:
namespace migration, orphan recovery, source ingress and cache representation
items own other boundaries. This replaces the earlier catalog reseed behavior
by an explicitly user-selected default, without a generic dependency merge.
