# ADR 0076: Cross-realm reverse VFS snapshot — explorer reflects the real-vite worker project; source files editable through the write port

Status: Accepted (2026-06-04)
Date: 2026-06-04
Corrected: 2026-06-14
Relates to: ADR-0075 (VSCode shell + VFS explorer over main-thread `syncMirror()`; its Consequences flagged this gap), ADR-0043 §D4 (Vite-in-Worker — the realm we mirror; its page→worker write port is the edit channel), ADR-0014 (split sync/async VFS, per-realm backends), the page→worker write port `vfs-write-port.ts` (this snapshot is its mirror image), D-002 (solid-js isolated to `apps/playground`).

> TL;DR: Real-vite explorer reads a one-way worker→page full-tree VFS snapshot (`vfs-snapshot-port.ts`) into a throw-on-mutate read-only `SnapshotFs` (no `node_modules`). The editor READS that snapshot but WRITES through the always-writable page mirror, propagating edits to the worker over the write port — page-owned source files are editable; worker-only files stay read-only.

## Correction (2026-06-14)

**The original Decision-4 was wrong: it made editor file tabs view-only in real-vite — a read-only sandbox is nonsense.** The escape was always available: ADR-0043 §D4's one-way page→worker write port (cited here as this snapshot's mirror image) already existed and already powered the program/`main.js` tab — file tabs could have ridden it from the start. The view-only call also wrongly invoked the "silent fake" objection, which only applies to *page-resident copies whose edits never reach the worker*; edits routed through the write port DO reach the worker. Decision-4 + the relevant Alternative/Consequence are corrected below; the snapshot bridge (Decisions 1–3, 5) is unchanged.

Timeline of the bug this corrects: the read-only editor coupling was latent from `5b1a7c51` (2026-06-06, this ADR's commit — editor `vfs` pointed at the read-only snapshot). It became the user-visible default at `f03ac50a` (2026-06-11, "replace repl with visible terminals"), which made boot auto-start real-vite (previously a writable REPL, where source WAS editable) and widened the read-only window to install/start/stop. Symptom: editing a seeded tab (`src/project-summary.js`) threw `writeFileSync: "…" is read-only — it lives in the Vite worker realm`.

## Context

ADR-0075's explorer reads the **main-thread** `syncMirror()` — honest for REPL/Dev Mode. But Real Vite runs in a kernel-spawned **Worker** realm (ADR-0043) with its *own* `syncMirror()`: the npm install, seeded project (`index.html`, `package.json`, `src/main.js`), and Vite's output live there, not on the page. So switching to the Real Vite demo left the explorer on the page's `/workspace` and never entered the Vite filesystem. (Reported bug: "switching to the Vite demo, the file manager does not move into Vite's filesystem.")

The only existing cross-realm channel is `vfs-write-port.ts`: a one-way page→worker mailbox (editor edits reach the worker so Vite's watcher sees them). Its docstring scopes out *bi-directional* sync ("needs locking + snapshot semantics … out of scope until OPFS-as-sync"). Mirroring worker files into the page's writable `syncMirror` would need that locking and would offer CRUD on page-resident copies whose edits never reach the worker — a silent fake (CLAUDE.md hard rule). But editing page-OWNED source and pushing it over the write port is neither bi-directional sync nor a silent fake — the edit reaches the worker.

The 2026-06-04 library-fit review confirmed no third-party VFS library helps: rifty's signature is sync-over-persistent-OPFS-without-SAB, and the worker-realm visibility problem is rifty-specific — keep custom.

New cross-realm wire protocol across >2 files / >100 lines → **IRREVERSIBLE**, ratified inline (ADR-0063 standing authority). No new npm dependency; no cross-package public API (playground-local glue, like the write port — only `@riftydev/net`'s `channelNameFor` addressing primitive is borrowed; `@riftydev/net` does not depend on `@riftydev/vfs`).

## Decision

A **one-way, display-only worker→page VFS snapshot bridge** (mirror of the write port) feeding a **read-only** page-side view the explorer renders in real-vite mode; the editor reads that view but writes through the page mirror, propagating page-owned edits to the worker over the write port.

1. **Wire protocol (`vfs-snapshot-port.ts`).** Keyed by dev-server port via `channelNameFor('ws://vfs-snapshot.local:<port>/__rfv')` (write-port scheme). Worker `publishVfsSnapshot(port, frame)`; page `subscribeVfsSnapshot(port, cb)`. A frame is a **full-tree replace**: `{ type, root, entries: {path, kind, size, content?}[], nodeModulesPresent }`. `collectSnapshot(fs, root)` is a pure DFS (dirs before files, matching explorer sort) that **excludes** `node_modules`, `.git`, `.vite`, `dist` and inlines bytes of files ≤128 KB (large/binary send size only). Unit-tested with a fake fs (no DOM, no channels).

2. **When the worker publishes** (`real-vite-bootstrap.ts`): after `seedProject` (plus retries at 300/1200/3000 ms to beat the page-subscribe race — unbuffered one-way BroadcastChannel), after `install`, after `server.listen()`, and on every Vite `watcher.change`. Page sees the skeleton during the ~20 s install and stays live with edits.

3. **Read-only page view (`snapshot-fs.ts`).** `SnapshotFs` implements the `FsOpsTarget` read slice (`existsSync`/`readFileBytesSync`/`readdirSync`/`statSync`) from the latest frame; `readOnly = true`; every mutation (`writeFileSync`/`mkdirSync`/`rmSync`) **throws a clear pathful error** (no silent stub — worker owns these files). `clear()` empties it on leaving the mode so no stale tree lingers.

4. **Editor read/write split — file tabs are EDITABLE (corrected).** The explorer store is `devServerRunning() ? snapshotFs : syncMirror()`; the explorer captures `vfs` once (ADR-0075 memo-leak guard) so the mode flip **remounts** it via a `<Show>`/fallback, and `FileExplorer` gains a `readOnly` prop hiding new-file/folder/rename/delete + showing a `read-only` badge. The **editor** is different: it READS from that same `activeVfs()` view but WRITES through a separate `writeVfs` = the always-writable page `syncMirror()` (`EditorHost` `writeVfs` prop; `App.tsx` passes `writeVfs={vfs}`). `glue/editor-write-router.ts`: `isEditorPathWritable(writeVfs, path)` (= page mirror owns the file), `writeEditorFile(writeVfs, path, text)` (mkdir -p parent, then write). `flushWrite` writes via `writeEditorFile(props.writeVfs, …)`; the read-only gate is `if (!isEditorPathWritable(props.writeVfs, path)) readOnlyPaths.add(path)` — computed against the page mirror, not the flipped read view, so it no longer depends on open-time order. A page-owned file's write lands in the page mirror; the existing `onFileWritten={syncWorkspaceFileToWorker}` then propagates it to the worker via `handle.updateFile` → the ADR-0043 §D4 write port → Vite watcher → HMR — the same channel the program tab uses, so it is not a silent fake. `FsOpsTarget` carries an optional `readOnly` flag (the snapshot sets it); binary files stay view-only as before. (Originally Decision-4 made file tabs view-only — corrected 2026-06-14.)

5. **`node_modules` intentionally not listed** (excluded at source); `nodeModulesPresent` records its existence so the UI can hint it (ADR-0080 lazy-reads it). Explorer shows project source; the worker stays source-of-truth for the thousands of installed files the page never reads. **Worker-only files** (present in the snapshot, absent from the page mirror: `node_modules`, worker-generated output) are not page-owned → `isEditorPathWritable` is false → the editor opens them read-only. The page never writes worker-owned files back.

**Program-tab safety (m10):** the permanent program tab binds to `machine.source`/`setSource`, **not** `props.vfs`, and routes page→worker via the write port. Clicking `src/main.js` in the mirror focuses the live program tab (ADR-0075 dual-writer guard), not a copy. File tabs now route their writes over the same write port (Decision-4), so the m10 HMR flow is unchanged and file editing joins it.

## Alternatives considered

- **File tabs view-only (the original, wrong Decision-4).** Point the editor at the read-only snapshot and block edits. Rejected (corrected 2026-06-14): a sandbox whose seeded source you cannot edit defeats the purpose; the write port already existed to carry the edit, so view-only was an oversight, not a forced scope.
- **Editor writes the worker port directly.** `EditorHost` calls the write port itself. Rejected (layering): `EditorHost` stays VFS-only; `App` owns worker propagation via `onFileWritten`/`syncWorkspaceFileToWorker`.
- **Mirror worker files into the page's writable `syncMirror`.** Fewer UI changes, but needs the locking the write port scoped out, and offers CRUD on copies whose edits never reach the worker → silent fake. Rejected (honesty). NB: the chosen Decision-4 is NOT this — it edits page-OWNED source and pushes over the write port, so edits do reach the worker.
- **Seed the same project skeleton into the page mirror on real-vite enter.** Avoids a channel, but is a static guess that drifts from the worker's real state and ignores install/watch output. Rejected.
- **Request/response remote FS (lazy read on expand).** More faithful (could include `node_modules`), but explorer + editor are synchronous and would need an async rework; the push snapshot is sync-friendly and bounded. Deferred (ADR-0080 took the lazy path for `node_modules`).
- **Adopt a browser-VFS library (ZenFS / memfs / lightning-fs).** None solves cross-realm visibility; all conflict with rifty's no-SAB sync-OPFS property / zero-dep bias (2026-06-04 review). Rejected.

## Consequences

- (+) Switching to Real Vite switches the explorer **into the Vite project** — reported bug fixed; view stays live with installs and edits.
- (+) Page-owned seeded source files are **editable** in real-vite; edits reach the worker via the ADR-0043 §D4 write port (Vite watcher → HMR); the read-only gate no longer depends on open-time order. Covered by `glue/editor-write-router.test.ts`.
- (+) Snapshot refreshes from the worker after an edit (watcher.change publish), so the read view re-syncs from the source of truth — no page↔worker echo loop (write one-way page→worker; refresh one-way worker→page).
- (+) Honest read-only for worker-OWNED files: `node_modules` + worker-generated output throw on mutate, open view-only, badge says why — no fake writes.
- (+) No new dependency, no cross-package API change; bridge is symmetric with the write port; solid-js stays in `apps/playground`.
- (−) `node_modules` not browsable inline (shown by absence + presence flag); ADR-0080 lazy-reads it.
- (−) Full-tree replace per frame, not a diff. Cheap because `node_modules` is excluded (project tree is small); revisit only if a huge generated tree appears.
- (−) Two VFS handles flow into `EditorHost` (read + write) where there was one; the editable-iff-page-owns rule must hold or a worker-only edit would silently no-op against the worker. Covered by the `isEditorPathWritable` gate + write-port propagation test.
- (−) Snapshots are best-effort over an unbuffered BroadcastChannel; seed retries + the explorer's existing poll cover the subscribe race. Dev Mode (main-thread) is unaffected — it already shares the page mirror.
