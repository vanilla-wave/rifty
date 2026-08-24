# ADR 0362: One command resolution authority across execution and owner-backed discovery

Status: Accepted
Date: 2026-08

> TL;DR: one internal shell resolver owns registered, direct-VFS, and nearest
> `.bin` resolution plus command-name discovery; the owner answers completion
> requests from that same live Shell, and every resolved VFS entry runs through
> the existing supervised Node-entry executor with `.bin` classification kept.

## Context

ADR-0137 fixed bare-name order: registered command, nearest ancestor
`node_modules/.bin/<name>`, miss. Execution, `which`, typo suggestions, and
`Shell.commandNames()` still query different inventories. A path containing `/`
never enters `.bin` lookup, but today always misses, so
`./node_modules/.bin/vite` and `./scripts/tool.mjs` cannot run.

ADR-0104 also says Playground shell modes consume the shell completer. The
owner-worker migration removed that wiring: the authoritative Shell/VFS is now
in the owner (ADR-0146), while the page terminal has no discovery request. A
page-local reconstruction would revive two command authorities.

The VFS has no executable-mode bit. Frozen GNU bash 3.2.57 evidence in
`docs/backlog/shell/reference/command-resolver-discovery-bash-3.2.57.md` pins
path recognition, discovery, and 126/127 classes; it cannot decide a nonexistent
VFS permission bit.

## Decision

**Authority.** Add one internal `CommandResolver` module with two entry points:
`resolve(name, cwd)` and `names(cwd)`. It owns these ordered outcomes:

1. registered builtin/custom command;
2. path-like regular VFS file, normalized against live cwd;
3. nearest ancestor regular `node_modules/.bin/<name>` file;
4. typed miss: bare, missing path, non-directory path component, or directory.

`names(cwd)` returns the sorted union of registered names and regular-file names
from every ancestor `.bin`, deduplicated. Direct files are discovered by path
completion, not injected as bare names. Execution, `which`, `hasCommand`, typo
suggestions, and `commandNames` query this module. `help` remains the registered
command synopsis, not an installed-package inventory.

**Direct VFS programs.** A regular VFS file selected by an explicit path is a
Node-entry carrier. It uses the frozen `BinExecutor` path with an absolute entry:
paths under `/node_modules/.bin/` launch with `bin:true`; all other direct paths
launch with `bin:false`. The production owner-child adapter adopts the same
classification already used by the retired in-realm adapter. Missing path is
127/`No such file or directory`; ENOTDIR or directory is 126; a found entry
without an executor remains 126. Relative `which` output preserves the spelling
the user supplied; execution receives the normalized absolute path.

This deliberately does not invent POSIX mode bits. Native host PATH, native
binaries, VFS execute permissions, and shebang selection beyond the existing
Node-entry loader remain unsupported and public compat says so.

**Owner-backed completion.** `Shell.complete(line, cursor)` adapts the existing
ADR-0104 language helper to its resolver, live cwd, and live `FsSync`. Bare
argv-0 completion uses `names`; path-like argv-0 completion reads the VFS just
like argument path completion.

Add one finite PTY request/result pair, correlated by the existing `opId`
authority. `ProjectTerminal.complete` reaches the owning session Shell; the
Playground passes it to `TerminalPanel`. Owner error, timeout, close, or death
rejects; Playground shows a completion error and degrades to no menu. The
existing UI completion sequence drops replies for superseded edit state.

**Mechanism sweep.** PTY already correlates stdin, resize, session-resize,
close, and dev-config operations through its one operation counter, timeout,
disconnect, and strict frame inspectors. Completion reuses those authorities;
it adds no FIFO, epoch, lock, ledger, or second request owner. The page's
existing completion sequence remains the sole stale-edit guard.

## Alternatives considered

- **Chosen: two-method internal resolver + thin owner adapter.** Smallest
  interface; all command semantics stay local to shell and the cross-realm
  adapter carries only clone-safe completion results.
- **Page-side inventory/VFS reconstruction.** Fewer wire edits, but cwd,
  installs, registered owner commands, and owner-only files can drift. Rejected:
  it recreates the exact sibling authority this decision removes.
- **Export an extensible resolver/descriptor registry.** Flexible for future
  manifests and alternate PATH adapters, but there is one implementation and
  no second adapter. Rejected as speculative public machinery; command metadata
  remains the separate `shell/command-manifest-registry` question.
- **Add POSIX mode bits + shebang/native dispatch first.** More host-like, but
  widens every VFS backend and still cannot run host-native files in Chromium.
  Rejected for this Node-program scenario; the gap stays explicit.

## Consequences

- `vite`, explicit `.bin` paths, direct workspace scripts, `which`, completion,
  and suggestions observe the same live owner state.
- Adds public behavior to `Shell.commandNames`/`hasCommand`, additive
  `Shell.complete` and `ProjectTerminal.complete`, and a sealed PTY frame pair.
- Completion is a read-only finite request. It never mutates shell/VFS state and
  never waits on a running child lifecycle.
- Direct non-Node files fail through the real Node-entry loader; no success stub
  or host fallback is introduced.
- Builds on ADR-0104, ADR-0137, ADR-0146, ADR-0150, and ADR-0155; supersedes none.
