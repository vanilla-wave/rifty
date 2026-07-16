# ADR 0277: Playground companion semantic contract

Status: Accepted
Date: 2026-07
Refines: ADR-0263

> TL;DR: the Playground companion accepts exact finite project plans, owns a
> durable semantic catalog, and binds TS/SCM/archive handles to one live
> Workbench session; transports, owner identity, roots, and UI models stay
> private.

## Context

ADR-0263 chose `@riftydev/workbench/playground` but left three public choices
open: trusted snapshot shape, catalog operations during a live session, and the
exact TS/SCM/archive interfaces. They are irreversible package commitments.

PR #136 exported the opposite seam: `ProjectSpec`, controllers, owner handles,
snapshot ports, and raw bridges. Reusing it would retain page-owned
coordination. The companion instead hides the same owner, mutation ordering,
project roots, and teardown behind semantic values.

## Decision

### Entry and plans

```ts
openPlaygroundWorkbench(options: WorkbenchOptions): Promise<PlaygroundWorkbench>

interface PlaygroundWorkbench extends Workbench {
  readonly playground: {
    define(plan: VitePlaygroundPlan): ProjectDefinition<PreviewHandle>
    define(plan: NodeServerPlaygroundPlan): ProjectDefinition<PreviewHandle>
    define(plan: NodeCliPlaygroundPlan): ProjectDefinition<void>
    readonly catalog: PlaygroundProjectCatalog
    forSession<T>(session: ProjectSession<T>): PlaygroundSessionTools
  }
}

type PlaygroundFirstMaterialization =
  | { readonly kind: 'snapshot'; readonly snapshot: PlaygroundTrustedSnapshot }
  | { readonly kind: 'install' }

interface PlaygroundTrustedSnapshot {
  readonly snapshotId: string
  readonly assetUrl: string
  readonly templateId: string
}

interface PlaygroundPlanBase {
  readonly kind: 'vite' | 'node-server' | 'node-cli'
  readonly id: string
  readonly starterId: string
  readonly templateId: string
  readonly files: Readonly<Record<string, string | Uint8Array>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly devDependencies?: Readonly<Record<string, string>>
  readonly firstMaterialization: PlaygroundFirstMaterialization
}

interface VitePlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'vite'
  readonly port: number
  readonly viteVersion?: string
}

interface NodeServerPlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'node-server'
  readonly entryPath: string
  readonly port: number
}

interface NodeCliPlaygroundPlan extends PlaygroundPlanBase {
  readonly kind: 'node-cli'
  readonly entryPath: string
  readonly args?: readonly string[]
}
```

`VitePlaygroundPlan` adds `kind: 'vite'`, required `port`, and optional
`viteVersion`.
`NodeServerPlaygroundPlan` adds `kind: 'node-server'`, `entryPath`, and `port`.
`NodeCliPlaygroundPlan` adds `kind: 'node-cli'`, `entryPath`, and optional
`args`. No other fields are accepted.

Plans are plain clone-safe exact-key data. Construction defensively copies byte
views and freezes every enclosing record, map, and array (ECMAScript cannot
freeze a non-empty typed-array view). Accessors, custom prototypes, functions,
symbols, unknown fields, `ProjectSpec`, callbacks, runtime registries, and UI
data reject before effects. `define()` is the only companion path to internal
Node factories.

`id` is the durable project identity; `starterId` is durable baseline
provenance; `templateId` is the finite runtime/pin identity. They are not
interchangeable. Definition identity includes runtime kind, id, starter id,
template id, exact normalized seed bytes, runtime fields (including the Vite or
server port), and first-materialization kind. The companion also mints an
internal baseline fingerprint over the same value without durable `id`; catalog
operations use it to prove Starter association. Snapshot identity includes its
`snapshotId` and `templateId`, not its resolved asset location. Changing those
semantic fields causes `ProjectDefinitionMismatchError`; relocating identical
trusted assets does not.

The app maps product policy one way:

```text
ProjectSpec + Starter/Preset.setup
              -> PlaygroundProjectPlan
              -> ProjectDefinition
```

`instant` maps to `kind: 'snapshot'`; a missing descriptor is a mapping error,
not a falsely labelled instant path. `from-scratch` maps to `kind: 'install'`
and cannot carry a snapshot.

`snapshotId` is bake-owned provenance, never inferred from `templateId` or URL.
Every snapshot-backed `ProjectSpec` carries generated
`bakedNodeModulesSnapshotId`; `pnpm snapshots:bake` computes it from the exact
uncompressed serialized v2 bytes, writes the generated identity manifest, and
the artifact check rejects a missing or stale identity. The mapper copies that
field exactly. Its only accepted spelling is lowercase
`sha256:<64 hexadecimal digits>`. The id therefore changes when baked bytes
change and remains stable across URL relocation or gzip recompression of the
same serialized bytes. `templateId` names the template inside snapshot v2; it
may differ from the plan template id only for an explicit shared dependency
snapshot.

`openPlaygroundWorkbench()` captures the API base and client URL once before
the page claim, through the same URL-context snapshot used to validate root
options. `define()` resolves `assetUrl` against that immutable API base and
checks the captured client origin; it never rereads `document`, `location`, or
another global. The URL must be credential-free, fragment-free,
client-same-origin HTTP(S). The owner applies a 10s header and per-chunk
no-progress timeout plus a 128 MiB cap to both fetched and decompressed bodies,
then verifies `snapshotId` against SHA-256 of the exact HTTP-decoded
serialized bytes before parsing, then requires exact descriptor template id,
definition `package.json`, snapshot dependency map, and current generated
`installArtifactIdentity`. A hash mismatch records `snapshot-id-mismatch`; any
miss records its reason and continues through
the real install path. This hash proves the selected transport artifact, not a
perpetual hash claim over the later mutable `node_modules` tree; ADR-0261's
root-bound install-stamp proof remains the sole tree-trust authority. Root
Workbench options never accept snapshot URLs.

Project open seeds the project and may validate/restore an exact trusted
snapshot, but it never performs a real install before the session/default
terminal exists. It returns an owner-born private acquisition decision:
already ready with provenance, or install with recorded snapshot failures.
`ProjectSession.run()` consumes that decision before the runtime command. A
fresh `kind: 'install'` plan never fetches a snapshot and runs the real
`npm install` on that terminal; its `$ npm install` line and package progress
precede Vite/server/CLI output. A valid existing package claim reuses the tree
without another install. A rejected `kind: 'snapshot'` probe prints its recorded
reason and performs the same visible real install before the runtime command.
Snapshot, fallback, terminal installs, and manifest mutations remain one owner
FIFO.

### Catalog

```ts
type PlaygroundProjectRef =
  | { readonly kind: 'scratch' }
  | { readonly kind: 'project'; readonly id: string }

interface PlaygroundProject {
  readonly id: string
  readonly name: string
  readonly starterId: string
  readonly editedAt: string
}

interface PlaygroundScratch {
  readonly starterId: string
  readonly dirty: boolean
  readonly editedAt: string
}

interface PlaygroundCatalogSnapshot {
  readonly active: PlaygroundProjectRef | null
  readonly scratch: PlaygroundScratch | null
  readonly projects: readonly PlaygroundProject[]
}

interface PlaygroundProjectCatalog {
  snapshot(): PlaygroundCatalogSnapshot
  subscribe(listener: (snapshot: PlaygroundCatalogSnapshot) => void): () => void
  createScratch(input: {
    readonly definition: ProjectDefinition<unknown>
    readonly preserveDirtySameStarter?: boolean
  }): Promise<PlaygroundCatalogSnapshot>
  saveScratch(input: {
    readonly id: string
    readonly name: string
    readonly definition: ProjectDefinition<unknown>
  }): Promise<PlaygroundCatalogSnapshot>
  activate(target: PlaygroundProjectRef): Promise<PlaygroundCatalogSnapshot>
  rename(id: string, name: string): Promise<PlaygroundCatalogSnapshot>
  reset(input: {
    readonly target: PlaygroundProjectRef
    readonly definition: ProjectDefinition<unknown>
  }): Promise<PlaygroundCatalogSnapshot>
  delete(id: string): Promise<PlaygroundCatalogSnapshot>
}
```

Catalog snapshots are frozen owner-authoritative values and subscriptions
replay the latest snapshot. Project refs are discriminated; no string sentinel,
root, index path/key, operation id, or frame crosses the interface.

`preserveDirtySameStarter` defaults to false. When true and a dirty Scratch
already has the exact arriving definition's starter id and baseline
fingerprint, `createScratch` is an exact no-op: it changes no bytes, timestamp,
active ref, snapshot identity, or subscription. A clean Scratch, a different
starter/baseline, or false reseeds from the supplied definition normally.

An empty catalog has `active: null`. Activating Scratch requires a present
Scratch; activating a project requires a present id. Deleting the active
project selects Scratch when present, otherwise the first remaining project in
stored creation order, otherwise `null`. Non-active deletion preserves the
active ref.

The companion reserves definition id `scratch` for Scratch; named catalog ids
cannot equal it. Supplied definitions must belong to the same companion and
match their target id. Starter id is never accepted as a second caller claim:
`createScratch` derives it from the companion-minted definition. `saveScratch`
requires a target-id definition with the same starter id and baseline
fingerprint as Scratch. `reset` is the explicit operation allowed to replace a
target's starter id and baseline fingerprint. `openProject` requires the stored
catalog provenance to match the definition, so a caller cannot label Starter A
with Starter B's bytes. `createScratch`, `saveScratch`, `activate`, `reset`, and
`delete` reject with `ProjectBusyError` while a session is live. `rename` and
automatic dirty publication are metadata mutations and may run live.

Scratch dirty is owner-born, never caller-marked. After first materialization,
the owner marks the active Scratch dirty for real user/guest/SCM/archive/file
and package-manifest/lock mutations before the originating operation and
catalog subscriber reflection settle. Seed, dependency arrival, and reserved
authority metadata do not mark it dirty.

Save is an inactive-session conversion: validate the target definition, copy
Scratch bytes without authority metadata, install the target definition
identity, flip the catalog pointer last, then remove the source. Recovery rolls
back a pre-flip orphan or finishes a post-flip source removal. Reset is a
whole-project re-seed from its supplied Starter-derived definition. Delete is
immediate; Undo delay remains app policy. Every mutation resolves after owner
apply, required durability, and catalog subscriber reflection. Ephemeral mode
keeps the same ordering for the Workbench lifetime.

Inherited root operations cannot bypass the catalog. `openProject()` accepts
only a definition minted by this companion whose id matches the active ref.
`deleteProject(id)` delegates to the same serialized operation as
`catalog.delete(id)` and discards its returned snapshot. Catalog tree methods,
inherited deletion, and materialization share one owner/materializer authority;
no parallel index or project store exists.

### Durable legacy adoption

The first-party companion captures the current legacy workspace id from the
historical `rifty.workspaceId` session-storage entry once at open, before
effects. A non-empty id maps each code unit outside `[A-Za-z0-9._-]` to `_`,
reproducing `workspaceVfsPrefix`. The companion passes
`/workspaces/<slug>` as optional typed owner boot field
`legacyWorkspacePrefix`, never guest env. A missing/empty entry means there is
no selected legacy workspace; inaccessible session storage does not authorize
scanning, guessing, or minting a replacement id.

When durable storage has no companion catalog but the selected legacy prefix
contains `/.rifty-project-index.json`, owner startup performs one idempotent
migration before exposing the catalog. It fully validates exact index keys,
unique ids, active ref, every indexed tree, Scratch/tree agreement, and any
existing migration journal. Corrupt or missing referenced state rejects open
loudly; a valid legacy catalog is never represented as empty.

The owner durably records catalog metadata plus internal `pending-adoption`
records first. Their public snapshots preserve active ref, creation order,
names, starter ids, dirty flag, and edited timestamps. A pending ref is adopted
when `openProject()` first receives a same-companion definition with matching
id and starter provenance: copy its complete ordinary tree and `.git` bytes
through the materializer stage, omit every `node_modules` subtree, reserved
`/.rifty` metadata, and every nested install claim, attach the new definition
and baseline identities, durability-gate promotion, then mark that ref adopted.
Mismatch rejects without changing source or catalog. Inactive refs therefore
need no eager Starter registry or caller callback.

Each ref has a journaled copy/promote/mark/source-cleanup state. Retry discards
an unpromoted stage, resumes an already promoted matching tree, and removes the
legacy source only after the adopted catalog record is durable. The legacy
index is tombstoned only after all refs are adopted; until then rollback data
remains. Memory/ephemeral mode never claims to migrate durable OPFS data.

### Session tools

```ts
interface PlaygroundSessionTools {
  readonly typescript: PlaygroundTypeScript
  readonly scm: PlaygroundScm
  readonly archive: PlaygroundArchive
}
```

`forSession()` memoizes one frozen tools value. It accepts only a live session
returned by that exact `PlaygroundWorkbench`. Forged or foreign sessions throw
`TypeError`; closing or closed owned sessions throw `ClosedHandleError`. There
is no identity argument. Tools expose no `close()` or `dispose()`.

TypeScript has the session root implicitly. Its exact initial interface uses
public `@riftydev/ts-language-service/lsp-types`:

```ts
interface PlaygroundTypeScript {
  open(path: string, text: string): Promise<void>
  update(path: string, text: string): Promise<void>
  close(path: string): Promise<void>
  invalidate(path: string): Promise<void>
  getSemanticDiagnostics(path: string): Promise<readonly Diagnostic[]>
  getSyntacticDiagnostics(path: string): Promise<readonly Diagnostic[]>
  getQuickInfo(
    path: string,
    position: Position,
    options?: QuickInfoOptions,
  ): Promise<Hover | null>
  getDefinitionLinks(path: string, position: Position): Promise<DefinitionLinks>
  getTypeDefinition(path: string, position: Position): Promise<readonly Location[]>
  getCompletions(
    path: string,
    position: Position,
    options?: CompletionOptions,
  ): Promise<CompletionList>
  getCompletionDetails(
    path: string,
    position: Position,
    label: string,
    source?: string,
    data?: unknown,
    options?: CompletionDetailsOptions,
  ): Promise<CompletionItem | null>
  getReferences(
    path: string,
    position: Position,
    context: ReferenceContext,
  ): Promise<readonly Location[]>
  prepareRename(
    path: string,
    position: Position,
    options?: RenameOptions,
  ): Promise<PrepareRenameResult | null>
  getRenameEdits(
    path: string,
    position: Position,
    newName: string,
    options?: RenameOptions,
  ): Promise<WorkspaceEdit>
  getSignatureHelp(
    path: string,
    position: Position,
    options?: SignatureHelpOptions,
  ): Promise<SignatureHelp | null>
  getCodeFixes(
    path: string,
    range: Range,
    errorCodes: number[],
    options?: CodeFixOptions,
  ): Promise<readonly CodeAction[]>
  getCombinedCodeFix(
    path: string,
    fixId: unknown,
    options?: CombinedCodeFixOptions,
  ): Promise<WorkspaceEdit>
  organizeImports(path: string, options?: OrganizeImportsOptions): Promise<WorkspaceEdit>
  getRefactorActions(
    path: string,
    range: Range,
    options?: RefactorOptions,
  ): Promise<readonly CodeAction[]>
  getFormattingEdits(
    path: string,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>
  getRangeFormattingEdits(
    path: string,
    range: Range,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>
  getOnTypeFormattingEdits(
    path: string,
    position: Position,
    key: string,
    options: FormattingOptions,
  ): Promise<readonly TextEdit[]>
  getImplementation(path: string, position: Position): Promise<readonly Location[]>
  getDocumentSymbols(path: string): Promise<readonly DocumentSymbol[]>
  getFoldingRanges(path: string): Promise<readonly FoldingRange[]>
  getInlayHints(
    path: string,
    range: Range,
    options?: InlayHintOptions,
  ): Promise<readonly InlayHint[]>
  getDocumentHighlights(
    path: string,
    position: Position,
    filesToSearch: readonly string[],
  ): Promise<readonly DocumentHighlight[]>
  getEncodedSemanticClassifications(
    path: string,
    range: Range,
  ): Promise<EncodedClassifications>
  getSelectionRange(path: string, position: Position): Promise<SelectionRange | null>
  getLinkedEditingRange(
    path: string,
    position: Position,
  ): Promise<LinkedEditingRanges | null>
}
```

Every direct path and the exact nested path input `filesToSearch` is validated
as normalized project-rooted `/...` and translated once to the session owner
root. Current option records contain no path fields and pass through unchanged;
adding one requires an explicit companion-contract revision and differential
case. Every returned direct or nested
location is translated back, including `Location`, `DefinitionLinks`,
completion additional edits, `CodeAction` edits, and every `WorkspaceEdit`
change key. An owner path outside the exact session rejects the whole response;
partial filtering and owner-root leakage are forbidden. `init(root)`, relay
messages, Monaco types, generic request frames, and disposal are absent.

SCM is byte-honest and finite:

```ts
interface PlaygroundScmChange {
  readonly path: string
  readonly code: string
  readonly area: 'staged' | 'working'
}
interface PlaygroundScmSnapshot {
  readonly branch?: string
  readonly history: readonly LogEntry[]
  readonly changes: readonly PlaygroundScmChange[]
}
interface PlaygroundScmBlob {
  readonly source: 'head' | 'index' | 'working' | 'empty'
  readonly bytes: Uint8Array
}
interface PlaygroundScmDiff {
  readonly original: PlaygroundScmBlob
  readonly modified: PlaygroundScmBlob
}
interface PlaygroundScm {
  snapshot(): PlaygroundScmSnapshot
  subscribe(listener: (snapshot: PlaygroundScmSnapshot) => void): () => void
  refresh(): Promise<PlaygroundScmSnapshot>
  diff(change: PlaygroundScmChange): Promise<PlaygroundScmDiff>
  stage(path: string): Promise<void>
  unstage(path: string): Promise<void>
  discard(path: string): Promise<void>
  commit(message: string): Promise<string>
}
```

Paths are project-rooted; `.git`, Git instances, owner keys, and status channels
remain private. Mutations resolve after Documents invalidation, Files
reflection/durability, and refreshed SCM state. `discard` rejects untracked
files; confirmation remains UI policy.

SCM and archive coordinate through the session's Documents authority, never a
caller-provided flush callback. They await an already-admitted save before
reading the affected path/root, then recheck. `diff(change)`, `stage(path)`,
`unstage(path)`, and `discard(path)` reject `DirtyProjectDocumentError` when
that path remains dirty. `commit()`, `archive.export()`, and whole-tree
`archive.import()` reject while any project document remains dirty. No
operation silently autosaves editor text. Discard/import require callers to
explicitly close dirty documents with save/discard before the call, then
invalidate the exact path or every open clean document as one owner-applied
mutation.

Archive retains one portable JSON contract:

```ts
interface PlaygroundArchiveV1 {
  readonly version: 1
  readonly root: '/'
  readonly files: readonly {
    readonly path: string
    readonly encoding: 'base64'
    readonly content: string
  }[]
}

interface PlaygroundArchive {
  export(): Promise<string>
  import(archiveJson: string): Promise<void>
}
```

Top-level JSON has exactly `version`, `root`, `files`; each file has exactly
`path`, `encoding`, `content`. Paths are non-empty normalized root-relative
strings with no leading slash, empty/`.`/`..`/NUL segment, duplicate decoded
target, or file-as-ancestor collision. Content is canonical RFC 4648 base64
with required padding and must round-trip byte-for-byte. Export walks in
ascending raw JavaScript code-unit path order (`<`/`>`, never locale collation)
and emits compact `JSON.stringify` output, so equal trees yield equal strings.

V1 is finite: the input/output JSON string is at most 48 Mi UTF-16 code units,
`files` contains at most 10,000 entries, one decoded file is at most 16 MiB,
and total decoded content is at most 32 MiB. Export rejects once any file,
count, or total limit would be crossed and also rejects an oversized final JSON
string. Import checks JSON length before `JSON.parse`, computes canonical base64
decoded sizes before allocation, and rejects every limit before staging or
live-tree effects. Larger/streaming projects remain the explicit
`vfs/workspace-archive-scalability` backlog gap.

Outward v1 archives use public root `/`, never the owner root. Export omits any
directory segment named `node_modules`, `.git`, `.vite`, or `dist`, the reserved
root `.rifty`, and every nested install-claim path. Import requires root `/` and
rejects, rather than drops, any such derived/reserved path. It checks exact
keys, all paths, all base64, all collisions, and every bound before effects,
then builds an owner-private stage and promotes it as one recoverable
whole-project replace. Import resolves after package-claim revocation,
Documents invalidation, Files reflection, SCM refresh, and durability; a failed
validation or unpromoted stage leaves the live tree unchanged.

Dirty document preflight runs before tool teardown. A rejected dirty close
leaves tools live. An admitted session close stops new tool calls, drains or
cancels admitted TS/SCM/archive work, closes those implementations, then closes
runtime/PTY/content/project transport. Failures aggregate; one physical owner
and the Workbench origin lease remain until Workbench close.

This corrects ADR-0165's physical owner respawn mechanism for the Workbench
migration. Switch closes the active session/runtime/preview and opens the next
session on the same physical Workbench owner. The user-visible restart and
single-active-root invariant remain; no live root re-point and no second owner
are introduced.

## Fault matrix

| fault × operation | honest outcome / Contract+RED proof |
|---|---|
| `corrupt-input` × plan/URL/archive | exact-key/path/base64 validation and captured-base resolution reject before effects |
| `provenance-lie` × stale/corrupt snapshot | SHA-256 artifact proof, exact v2 rejection reason, and real-browser provenance case |
| `false-fallback` × rejected optional snapshot | rejection stays visible, then the same real terminal install succeeds |
| `unbounded-read` × snapshot/archive | bounded response/body, JSON, file-count, per-file, and total-byte rejection before effects |
| `concurrent-same-key` × acquisition/manifest/terminal install | one owner FIFO; concurrent prepare/install and warm-reuse fault cases |
| `torn-state` × dirty document vs SCM/archive | affected operation rejects; admitted save drains first; no caller flush callback |
| `torn-state` × save/reset/delete/catalog pointer | stage/copy first, durability-gated pointer last, deterministic recovery tests |
| `torn-state` × legacy adoption crash | source retained through journaled promote/mark; retry resumes or rolls back without empty catalog |
| `quota-perm-fail` × catalog/archive/migration durability | mutation rejects without publishing false snapshot; live/source tree remains recoverable |
| `torn-state` × dirty close/tool work/core close | dirty preflight leaves tools live; admitted tools drain/cancel before core teardown |

Contract+RED includes unit fault tests for each semantic boundary plus real
browser-owner cases for companion minting, real npm/process execution,
non-default Vite port, selected-legacy boot wiring, and the real TypeScript
service. Synthetic relay/process fixtures remain unit-ordering evidence only;
they never close observable acceptance.

## Consequences

- Playground gets its full first-party behavior through one deep module and
  one owner lifetime.
- The public cost is finite semantic data/handles, not controller or transport
  extensibility.
- App migration must close a session before Save/switch/reset/delete, then open
  the catalog-selected definition; this matches the observable restart model.
- PR #136 remains an implementation quarry for validators, TS relay, Git,
  archive, and browser scenarios; none of its public controller seam survives.
