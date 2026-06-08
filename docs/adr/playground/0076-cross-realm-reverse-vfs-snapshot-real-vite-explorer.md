# ADR 0076: Cross-realm reverse VFS snapshot — the file explorer reflects the real-vite worker project

Status: Accepted (2026-06-04)
Date: 2026-06-04
Relates to: ADR-0075 (VSCode shell + VFS explorer over main-thread `syncMirror()`; its Consequences flagged this gap), ADR-0043 (Vite-in-Worker — the realm we mirror), ADR-0014 (split sync/async VFS, per-realm backends), the page→worker write port `vfs-write-port.ts` (this is its mirror image), D-002 (solid-js isolated to `apps/playground`).

> TL;DR: Real-vite explorer reads a one-way worker→page full-tree VFS snapshot (`vfs-snapshot-port.ts`) into a throw-on-mutate read-only `SnapshotFs`, no `node_modules`

## Context

ADR-0075's explorer reads the **main-thread** `syncMirror()` — honest for REPL/Dev Mode. But Real Vite runs in a kernel-spawned **Worker** realm (ADR-0043) with its *own* `syncMirror()`: the npm install, seeded project (`index.html`, `package.json`, `src/main.js`), and Vite's output live there, not on the page. So switching to the Real Vite demo left the explorer on the page's `/workspace` and never entered the Vite filesystem. (Reported bug: "switching to the Vite demo, the file manager does not move into Vite's filesystem.")

The only existing cross-realm channel is `vfs-write-port.ts`: a one-way page→worker mailbox (editor edits reach the worker so Vite's watcher sees them). Its docstring scopes out bi-directional sync ("needs locking + snapshot semantics … out of scope until OPFS-as-sync"). Mirroring worker files into the page's writable `syncMirror` would need that locking and would offer CRUD on page-resident copies whose edits never reach the worker — a silent fake (CLAUDE.md hard rule).

The 2026-06-04 library-fit review confirmed no third-party VFS library helps: rifty's signature is sync-over-persistent-OPFS-without-SAB, and the worker-realm visibility problem is rifty-specific — keep custom.

New cross-realm wire protocol across >2 files / >100 lines → **IRREVERSIBLE**, ratified inline (ADR-0063 standing authority). No new npm dependency; no cross-package public API (playground-local glue, like the write port — only `@riftydev/net`'s `channelNameFor` addressing primitive is borrowed; `@riftydev/net` does not depend on `@riftydev/vfs`).

## Decision

A **one-way, display-only worker→page VFS snapshot bridge** (mirror of the write port) feeding a **read-only** page-side view the explorer renders in real-vite mode.

1. **Wire protocol (`vfs-snapshot-port.ts`).** Keyed by dev-server port via `channelNameFor('ws://vfs-snapshot.local:<port>/__rfv')` (write-port scheme). Worker `publishVfsSnapshot(port, frame)`; page `subscribeVfsSnapshot(port, cb)`. A frame is a **full-tree replace**: `{ type, root, entries: {path, kind, size, content?}[], nodeModulesPresent }`. `collectSnapshot(fs, root)` is a pure DFS (dirs before files, matching explorer sort) that **excludes** `node_modules`, `.git`, `.vite`, `dist` and inlines bytes of files ≤128 KB (large/binary send size only). Unit-tested with a fake fs (no DOM, no channels).

2. **When the worker publishes** (`real-vite-bootstrap.ts`): after `seedProject` (plus retries at 300/1200/3000 ms to beat the page-subscribe race — unbuffered one-way BroadcastChannel), after `install`, after `server.listen()`, and on every Vite `watcher.change`. Page sees the skeleton during the ~20 s install and stays live with edits.

3. **Read-only page view (`snapshot-fs.ts`).** `SnapshotFs` implements the `FsOpsTarget` read slice (`existsSync`/`readFileBytesSync`/`readdirSync`/`statSync`) from the latest frame; `readOnly = true`; every mutation (`writeFileSync`/`mkdirSync`/`rmSync`) **throws a clear pathful error** (no silent stub — worker owns these files). `clear()` empties it on leaving the mode so no stale tree lingers.

4. **Wiring (`App.tsx`).** A `createEffect` subscribes while `mode === 'real-vite'` (cleans up / clears otherwise). Explorer store and editor `vfs` become `mode === 'real-vite' ? snapshotFs : syncMirror()`. The explorer **captures `vfs` once** (ADR-0075 memo-leak guard), so the mode flip **remounts** it via a plain `<Show>`/fallback. `FileExplorer` gains a `readOnly` prop hiding new-file/folder/rename/delete and showing a `read-only` badge. `FsOpsTarget` gains an optional `readOnly` flag; `EditorHost.openFile` opens read-only-source files view-only (same `readOnlyPaths` path as binary files).

5. **`node_modules` intentionally not listed** (excluded at source); `nodeModulesPresent` records its existence so the UI can hint it later. Explorer shows project source; the worker stays source-of-truth for the thousands of installed files the page never reads.

**Program-tab safety (m10):** the permanent program tab binds to `machine.source`/`setSource`, **not** `props.vfs`, and edits route page→worker via the write port. Swapping explorer/editor `vfs` does not touch that path, so the m10 HMR textarea flow is byte-for-byte unchanged. Clicking `src/main.js` in the mirror focuses the live program tab (ADR-0075 dual-writer guard), not a read-only copy.

Verified live against a real Vite worker install: explorer shows `src/ · index.html · package.json · package-lock.json` (node_modules excluded), updates live (package-lock appears post-install via watch), `read-only` badge with CRUD hidden, opening `index.html` shows real worker bytes and ignores edits, and leaving real-vite restores the writable page explorer.

## Alternatives considered

- **Mirror worker files into the page's writable `syncMirror`.** Fewer UI changes, but needs the locking the write port scoped out, and offers CRUD on copies whose edits never reach the worker → silent fake. Rejected (honesty).
- **Seed the same project skeleton into the page mirror on real-vite enter.** Avoids a channel, but is a static guess that drifts from the worker's real state and ignores install/watch output. Rejected.
- **Request/response remote FS (lazy read on expand).** More faithful (could include `node_modules`), but explorer + editor are synchronous and would need an async rework; the push snapshot is sync-friendly and bounded. Deferred — could supersede this if browsing `node_modules` becomes a real need.
- **Adopt a browser-VFS library (ZenFS / memfs / lightning-fs).** None solves cross-realm visibility; all conflict with rifty's no-SAB sync-OPFS property / zero-dep bias (2026-06-04 review). Rejected.

## Consequences

- (+) Switching to Real Vite now switches the explorer **into the Vite project** — reported bug fixed; view stays live with installs and edits.
- (+) Honest read-only: mutations throw, edits blocked at the editor, badge says why — no fake writes.
- (+) No new dependency, no cross-package API change; bridge is symmetric with the write port; solid-js stays in `apps/playground`.
- (−) `node_modules` not browsable (shown by absence + presence flag). Acceptable for v1; lazy remote-read FS is the path if wanted.
- (−) Full-tree replace per frame, not a diff. Cheap because `node_modules` is excluded (project tree is small); revisit only if a huge generated tree appears.
- (−) Snapshots are best-effort over an unbuffered BroadcastChannel; seed retries + the explorer's existing poll cover the subscribe race. Dev Mode (main-thread) is unaffected — it already shares the page mirror.
