# Changelog

## [Unreleased]

### Changed

- **Activate esbuild from the admitted installed tree (ADR-0371).** Package
  admission projects the exact registry-twin path into existing Node/dev-server
  bootstrap metadata; each child verifies the 13,918,738-byte SHA-pinned member
  through its `FsSync` before compile. The owner CAS, asset server/client, and
  kernel capability-port wiring are deleted.

- **Supervised FS relays consume SyncRpc v5 binary requests (ADR-0366).** Node
  entries, dev-server children, and recursive relay peers receive the complete
  JSON + binary kernel sync API with no legacy fallback.

### Fixed

- npm shell `EBROKENLOCK` stderr line surfaces the installer's message (which
  entries, which reason) instead of a `(unknown package)` placeholder; the
  `delete package-lock.json and retry` recovery hint stays.
- **Owner operation deadline measures durability-progress SILENCE, not total
  duration (#255, ADR-0360).** `OWNER_OPERATION_TIMEOUT_MS` was a hard 60 s
  module constant on an operation's total wall clock, so a first `openProject`
  restoring a 98 MB baked snapshot (~42 s of OPFS flush on warm hardware,
  minutes on slow) raced the budget and, on losing, called `failProtocol` —
  killing the transport for an environmental condition. Every arriving
  owner-level `workbench:durability-progress` frame (ADR-0359) now re-arms the
  deadline of ALL pending operations, so a slow-but-alive owner completes at
  any wall clock. No other traffic resets it: a chatty transport must not mask
  a wedged flush. Genuine silence keeps today's fatality — reject + kill, since
  only peer death settles an admitted mutation — and the timeout message now
  names the cause (`… timed out after Nms without owner durability progress`).

### Added

- **Owner-authoritative command completion and direct VFS entries (ADR-0362).**
  `ProjectTerminal.complete()` uses a bounded, correlated PTY request against
  the owning Shell's live cwd/VFS. Owner errors, close, timeout, and death
  reject without a stale result; malformed ranges cannot escape their original
  line/cursor request. The supervised entry adapter now marks only
  `node_modules/.bin` launchers as `bin:true`; ordinary explicit paths run as
  `bin:false`, while Vite/nodemon policy stays installed-bin-only.
- **`deployment.ownerOperationSilenceTimeoutMs` (#255, ADR-0360).** Host budget
  of owner progress silence on `WorkbenchOptions` (and therefore
  `PlaygroundWorkbenchOptions`), validated by the same positive-finite
  authority as `previewProbeTimeoutMs`; unset keeps the shipped 60 000 ms. The
  published-dist pnpm patch that raised the old constant to 300 s is no longer
  needed — the default handles the 42 s first open unconfigured.

### Fixed
- `@emnapi/core@1.10.0` installs receive the exact upstream child-thread
  orphaned-reference cleanup backport before stamp promotion. A Vite 8
  unresolved import now returns Vite's normal non-zero build error instead of
  crashing a Rolldown pthread and stranding the command; nested copies and
  baked-snapshot restores use the same version-gated transform.

- **First-open materialization drain now emits `durability-progress` (#256,
  epic project-open-drain-latency final slice; ADR-0359 corrected
  2026-08-16).** Progress rides a new owner-LEVEL `workbench:durability-
  progress` control message on the existing owner→page ipc — durability is
  owner-scoped and the first-open promote proof-flush completes before any
  project runtime exists, so the slice-3 per-project vfs frame hop (late-
  bound emit slot, token-gated republish) was mute for the epic's central
  case and is removed; one channel now carries ALL drains. Coalescing,
  counts honesty, reach, and the `WorkbenchOwnerHealthEvent` surface are
  unchanged.

### Added

- **Durability-drain progress on the owner port (#256, epic
  project-open-drain-latency slice 3, ADR-0359).** New
  `{ kind: 'durability-progress', persisted, total }` member of
  `WorkbenchOwnerHealthEvent`: REAL drain-owner counts, arrival doubles as
  the heartbeat, terminal `persisted === total` only for a clean drain.
  Worker forwards coalesced `rifty:owner-vfs-durability-progress` frames
  (O(progress): first + terminal + at most one per 200 ms) over the active
  project's vfs channel; the page republishes them token-gated in frame
  order. BREAKING (accepted loud migration, ADR-0359): embedders with
  exhaustive switches over health-event kinds must handle or default-case
  the new kind.

### Changed

- **Trusted install-stamp writes carry an explicit full fence (#256,
  ADR-0358).** `promote()` awaits the drain's real-settle fence immediately
  before publishing a trusted stamp — under the parallel OPFS drain a
  trusted stamp still implies every earlier-enqueued persist settled
  (FIFO admission no longer provides this implicitly); pending/demote
  writes are unfenced (one fence per transition).

- **Snapshot-restore mkdir dedup (#256, epic project-open-drain-latency
  slice 1).** `prepareWorkspaceArchiveImport().apply()` issues one `mkdirSync`
  per distinct file dirname instead of one before every write — on OpfsFsSync
  every call is an async persist op, so a big-tree restore drained ~2 FIFO
  ops/file. Same-pass first-seen dedup: duplicate mkdir calls
  disappear by design; surviving-op order, interleaving, partial-failure
  prefixes, and error identity are byte-identical to before (trace-pinned); ledger heal-on-retry, prepared re-apply, foreign-rm honesty, and
  mid-drain realm-death recovery are fault-pinned over real OpfsVfs/OPFS.
  Real-browser acceptance: 3002-file restore enqueues exactly 602 mkdir
  persists (was 3003).

### Fixed

- Starter Git baselines again use Git's ignore pruning, exclude every nested
  `node_modules` tree, and rebuild an interrupted unborn index before staging.
  Ref and object read failures now propagate before baseline mutation instead
  of masquerading as Git absence and risking replacement history; the
  guarantee lives in the `@riftydev/git` facade (ADR-0357), so the local
  Starter read-latch and preflight object reads are gone.

- Dependency snapshot v3 now carries the exact integrity-pinned cache closure
  required by registry-backed shadow replay, verifies it before mutation, and
  merges it before publishing the restored lockfile. The first explicit install
  after instant Vite 8 restore no longer fails `EBROKENLOCK` (ADR-0346).

### Added

- The terminal `node` command now admits Node 24-compatible CommonJS
  `-e`/`--eval`, `-p`/`--print`, and explicit `--input-type=commonjs`
  invocations through the same supervised physical child, VFS, preview, signal,
  and exit lifecycle as `node <file>`. An empty first token after `--` remains
  eval argv; accepted ESM, TypeScript, preload, and print-to-program contexts
  fail in their named gaps.

- **Installed nodemon owns curated Node-server development (ADR-0327).** Exact
  script bytes select direct-entry or installed-bin execution; recursive apps
  reuse PTY/preview ownership and the owner-root finite `ps` surface.

- Initial sealed Workbench root, Playground companion, and five explicit worker
  deployment entries (ADR-0263, ADR-0282).

- Dispatch admitted runtime bindings by recipe `adapterId` before guest entry.
  Direct CJS/ESM esbuild and Vite 7 consume the same installed registry twin;
  Vite 8 keeps an empty plan, and the `esbuild` bin fails loudly as
  `NotImplementedError('esbuild.cli')` (ADR-0308/0311/0371). Runtime binding
  rows ride existing entry bootstrap metadata; process-visible IPC is unchanged.

### Changed

- Regenerated install-artifact identity now binds esbuild's static CommonJS
  named-export recipe, invalidating stale install stamps and baked snapshots
  before reuse.

- Remove unreachable page-side bin execution and PTY routing classifiers; the
  owner child executor and sealed Workbench protocol remain the runtime owners.

- Package-owner install and replay now prove the zero-runtime-asset Sass recipe
  through the same FIFO, lock, provenance, and durable tree owner as existing
  catalog substitutions.
- Package-owner installs now commit and replay protocol-v2 shadow facts while
  retaining the same-project FIFO through materialization and lock publication.

- Exact Vite 8.0.16 definitions serialize the visible npm-standard proven
  Rolldown WASI runtime override before project identity; an explicit caller
  value wins and every other Vite version remains unchanged (ADR-0336).
- Derive default and runtime direct-Node commands from one canonical formatter.

- Regenerated install-artifact identity now binds the schema-2 builtin shadow
  catalog, invalidating stale worker install stamps after the policy authority
  change (ADR-0328).
- Removed dead zero-caller surface: `installStampAuthorityFor` + its
  `ownerAuthorities` registry and the two unused owner-VFS terminal equality
  helpers; module-surface tests pin their absence.

- Remove the public host-supplied esbuild WASM deployment URL. Worker and
  sqlite deployment assets remain host-resolved; esbuild is now registry-owned
  with no host fallback (ADR-0311).

### Fixed

- Foreground stdout and stderr now decode UTF-8 incrementally per stream and
  flush decoder tails before exit or peer-failure settlement in byte-admission
  order, preserving split code points and exact stream identity.

- `ProjectTerminalRun` now exposes the owner-authored shell status beside its
  exact physical exit, preserving Ctrl-C status `130` without reconstructing it
  from `SIGTERM` (ADR-0341).

- Preserve an exact trusted dependency tree across Scratch-to-project Save:
  the existing package FIFO copies claim-free bytes, then mints target-root
  trust before the durable catalog pointer commits (ADR-0329).
- Node-entry bundles now adopt the kernel-installed process once before guest
  import, preserving recursive PID authority in production builds (ADR-0334).

- Recursive owner `execSync` now captures the kernel handle's semantic
  stdout/stderr streams instead of replacing its raw `MessagePort` handlers,
  preserving terminal drain accounting and finite Chromium completion.

- Preview routes now consume PID-scoped private listening control and retain
  newer live ownership when stale or never-listening child teardown arrives.

- Preserve `ShellCommandLifecycleError` through project-path redaction,
  including inside `AggregateError`, so nodemon Worker peer death stays a PTY
  lifecycle error instead of a fabricated command exit.

- Physical child/owner peer death now settles recursive execution, TypeScript
  requests, owner lifetime, and direct-server preview teardown without hangs.

- Preserve the live `package.json` during deferred first install, and fold its
  exact generated lockfile into the untouched Starter root under the
  package/SCM FIFO. Staged or explicit user dependency changes stay visible.

- Abort a terminal install waiter immediately when its lifecycle closes behind
  the package FIFO head, while retaining its cancelled admission until that
  FIFO position so quiescence and stamp ownership stay exact.

- Preserve the exact owner outcome of file mutations admitted before project
  close; close drains those commits while fencing future and unhanded work
  (ADR-0319).

- Extend the generic runtime-adapter boundary to every owner admission/asset/
  controller module and move the concrete runtime projection into its existing
  owner-protocol seam.

- Keep the already-published live package tree available to Node after a
  manifest-only edit while demoting its durable install claim; real tree
  mutations still revoke admission, and empty trees are re-attested.

- Register installed `vite preview` listeners as the production-preview source
  from owner-trusted CLI mode, with launch-scoped teardown that cannot clear a
  newer preview.

- Match npm 11 non-workspace prefix discovery for typed
  `package.json`/`node_modules` markers and stat misses; selected or ancestor
  workspace roots now throw before package or lifecycle mutation instead of
  conflating npm's root lock/tree prefix with its selected member target.

- Admit Node children across exact package-tree ancestry: deferred plans
  replace stale facts only after exact empty proof, byte-exact install
  rollbacks recover, every child ingress reserves its concrete entry, nested
  roots retain ancestor runtime bindings, structural tree replacements stay
  fenced without serializing exact sibling work, and partial/torn trees stay
  blocked.

- Abort an active npm acquisition from the owning terminal/project lifecycle;
  package admission remains held until the cancelled install actually settles.

- Keep live-owner Project VFS snapshot and atomic reads pending until the exact
  reply; only failed admission or confirmed owner death settles them.

- Fence Vite run retirement on the shared preview-route revocation proof, while
  reporting one causal close failure once.

- Keep recursive `execSync` and `worker_threads` launches in the active
  project's public filesystem namespace across owner and dev-server realms
  without exposing its physical root.
