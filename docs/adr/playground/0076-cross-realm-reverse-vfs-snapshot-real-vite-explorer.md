# ADR 0076: Cross-realm reverse VFS snapshot — explorer reflects the owner project; source files editable through owner ACKs

Status: Accepted (2026-06-04)
Date: 2026-06-04
Corrected: 2026-06-14, 2026-06-29
Relates to: ADR-0075 (VSCode shell + VFS explorer over main-thread `syncMirror()`; its Consequences flagged this gap), ADR-0043 §D4 (Vite-in-Worker — the original realm mirrored here), ADR-0014 (split sync/async VFS, per-realm backends), `vfs-write-port.ts` frame semantics reused by owner ACK writes, D-002 (solid-js isolated to `apps/playground`).

> TL;DR: The playground reads an owner→page full-tree VFS snapshot (`vfs-snapshot-port.ts`) into a throw-on-mutate `SnapshotFs` (no `.git`/`node_modules`). Explorer/editor READ that snapshot, while editor and file-manager mutations WRITE through owner ACK frames (`writeFrameAcked`) — source files are ordinary owner-backed files; owner-only/generated files stay read-only.

## Correction (2026-06-14)

**The original Decision-4 was wrong: it made editor file tabs view-only in real-vite — a read-only sandbox is nonsense.** The edit path existed first as ADR-0043 §D4's write port and later became owner-backed ACK writes; file tabs should have used the real source-of-truth write path instead of being blocked. The view-only call also wrongly invoked the "silent fake" objection, which only applies to copies whose edits never reach the owner. Decision-4 + the relevant Alternative/Consequence are corrected below; the snapshot bridge (Decisions 1–3, 5) is unchanged.

Timeline of the bug this corrects: the read-only editor coupling was latent from `5b1a7c51` (2026-06-06, this ADR's commit — editor `vfs` pointed at the read-only snapshot). It became the user-visible default at `f03ac50a` (2026-06-11, "replace repl with visible terminals"), which made boot auto-start real-vite (previously a writable REPL, where source WAS editable) and widened the read-only window to install/start/stop. Symptom: editing a seeded tab (`src/project-summary.js`) threw `writeFileSync: "…" is read-only — it lives in the Vite worker realm`.

## Correction (2026-06-29)

The "Program-tab safety" clause depended on ADR-0075's permanent program tab, which is no longer active. There is no permanent program tab. The selected starter/project declares initial ordinary file tabs via `openFiles`; the entry file is just another absolute-path-keyed model. Opening it from the snapshot, Explorer, GIT, LS, or the preset initial list focuses/reuses that same model. File-tab writes route through `writeFrameAcked`, so HMR still observes the owner source of truth without a page-local copy.

## Context

ADR-0075's explorer reads the **main-thread** `syncMirror()` — honest for REPL/Dev Mode. But Real Vite runs in a kernel-spawned **Worker** realm (ADR-0043) with its *own* `syncMirror()`: the npm install, seeded project (`index.html`, `package.json`, `src/main.js`), and Vite's output live there, not on the page. So switching to the Real Vite demo left the explorer on the page's `/workspace` and never entered the Vite filesystem. (Reported bug: "switching to the Vite demo, the file manager does not move into Vite's filesystem.")

The original cross-realm channel was `vfs-write-port.ts`: a one-way page→worker mailbox. After ADR-0148/0180, the persistent workspace owner is the source of truth and the same frame semantics are applied through owner ACKs. Mirroring owner files into a writable page store would offer CRUD on copies whose edits never reach the owner — a silent fake (CLAUDE.md hard rule). ACKed owner mutations are neither bi-directional sync nor a silent copy.

The 2026-06-04 library-fit review confirmed no third-party VFS library helps: rifty's signature is sync-over-persistent-OPFS-without-SAB, and the worker-realm visibility problem is rifty-specific — keep custom.

New cross-realm wire protocol across >2 files / >100 lines → **IRREVERSIBLE**, ratified inline (ADR-0063 standing authority). No new npm dependency; no cross-package public API (playground-local glue, like the write port — only `@riftydev/net`'s `channelNameFor` addressing primitive is borrowed; `@riftydev/net` does not depend on `@riftydev/vfs`).

## Decision

A **one-way owner→page VFS snapshot bridge** feeding a **read-only** page-side view rendered by Explorer and editor. Mutations are not applied to that view; editor writes and file-manager operations go through owner ACK frames, then the owner republishes a fresh snapshot.

1. **Wire protocol (`vfs-snapshot-port.ts`).** Keyed by dev-server port via `channelNameFor('ws://vfs-snapshot.local:<port>/__rfv')` (write-port scheme). Worker `publishVfsSnapshot(port, frame)`; page `subscribeVfsSnapshot(port, cb)`. A frame is a **full-tree replace**: `{ type, root, entries: {path, kind, size, content?}[], nodeModulesPresent }`. `collectSnapshot(fs, root)` is a pure DFS (dirs before files, matching explorer sort) that **excludes** `node_modules`, `.git`, `.vite`, `dist` and inlines bytes of files ≤128 KB (large/binary send size only). Unit-tested with a fake fs (no DOM, no channels).

2. **When the worker publishes** (`real-vite-bootstrap.ts`): after `seedProject` (plus retries at 300/1200/3000 ms to beat the page-subscribe race — unbuffered one-way BroadcastChannel), after `install`, after `server.listen()`, and on every Vite `watcher.change`. Page sees the skeleton during the ~20 s install and stays live with edits.

3. **Read-only page view (`snapshot-fs.ts`).** `SnapshotFs` implements the `FsOpsTarget` read slice (`existsSync`/`readFileBytesSync`/`readdirSync`/`statSync`) from the latest frame; `readOnly = true`; every mutation (`writeFileSync`/`mkdirSync`/`rmSync`) **throws a clear pathful error** (no silent stub — worker owns these files). `clear()` empties it on leaving the mode so no stale tree lingers.

4. **Editor read/write split — file tabs are EDITABLE (corrected).** The explorer/editor read the owner-published `SnapshotFs`. The editor writes through `onFileWritten` → `writeWorkspaceFile` → `writeFrameAcked` to the workspace owner; pending editor writes are flushable before GIT/status actions, and over-cap or owner-only files use the full-byte owner read bridge. The read-only gate is now owner/snapshot availability + binary/remote ownership. An editable source-file write reaches the owner store → dev-server/Vite watcher → HMR, so it is not a silent page-local copy. (Originally Decision-4 made file tabs view-only — corrected 2026-06-14; the permanent program-tab dependency was removed 2026-06-29.)

5. **`node_modules` intentionally not listed** (excluded at source); `nodeModulesPresent` records its existence so the UI can hint it (ADR-0080 lazy-reads it). Explorer shows project source; the owner stays source-of-truth for the thousands of installed files the page never snapshots. Owner-only/generated files open read-only; the page never writes them back.

6. **Explorer file management is WRITABLE too (corrected 2026-06-14/2026-06-29).** A sandbox whose tree you cannot touch is pointless, so `FileExplorer` receives read-only snapshot data plus explicit owner mutation callbacks. `OwnerRpcFs` sends create/write/rm/rename/copy frames through `writeFrameAcked`, flushes pending editor writes first, and closes stale editor models for renamed/deleted paths. `node_modules` rows stay read-only — installed packages are owner-generated. The owner applies each frame and republishes the snapshot, so the change appears in the read view.

**Entry-file safety (corrected 2026-06-29):** there is no permanent program tab. The selected starter/project declares initial ordinary file tabs via `openFiles`; the entry file is just another absolute-path-keyed model. Opening it from the snapshot, Explorer, GIT, LS, or the preset initial list focuses/reuses that same model. File-tab writes route through `writeFrameAcked`, so HMR still observes the owner source of truth without a page-local copy.

## Alternatives considered

- **File tabs view-only (the original, wrong Decision-4).** Point the editor at the read-only snapshot and block edits. Rejected (corrected 2026-06-14): a sandbox whose seeded source you cannot edit defeats the purpose; a real owner write path exists, so view-only was an oversight, not a forced scope.
- **Editor writes the worker/owner port directly from the component.** `EditorHost` calls the port itself. Rejected (layering): `EditorHost` stays editor/model-only; `App` owns owner propagation via `onFileWritten`/`writeWorkspaceFile`.
- **Mirror worker files into the page's writable `syncMirror`.** Fewer UI changes, but needs the locking the write port scoped out, and offers CRUD on copies whose edits never reach the worker → silent fake. Rejected (honesty). NB: the corrected path is NOT this — ordinary file tabs edit owner-backed files and `App` awaits owner write ACKs, so edits reach the dev server's source of truth.
- **Seed the same project skeleton into a writable page copy.** Avoids a channel, but is a static guess that drifts from the owner's real state and ignores install/watch output. Rejected.
- **Request/response remote FS (lazy read on expand).** More faithful (could include `node_modules`), but explorer + editor are synchronous and would need an async rework; the push snapshot is sync-friendly and bounded. Deferred (ADR-0080 took the lazy path for `node_modules`).
- **Adopt a browser-VFS library (ZenFS / memfs / lightning-fs).** None solves cross-realm visibility; all conflict with rifty's no-SAB sync-OPFS property / zero-dep bias (2026-06-04 review). Rejected.

## Consequences

- (+) Switching to an owner-backed project switches Explorer **into the owner tree** — reported bug fixed; view stays live with installs and edits.
- (+) Owner-backed seeded source files are **editable** in real-vite; file-tab edits await owner write ACKs (`writeFrameAcked`, Vite watcher → HMR), and initial tabs reopen only after a fresh owner snapshot. Covered by `components/EditorHost.test.ts`, `App.test.ts`, and `tests/e2e/scm-file-manager.spec.ts`.
- (+) Explorer **file management** (new / rename / delete) works through `OwnerRpcFs` + owner ACK frames; each op round-trips through the owner and reappears in the snapshot. Covered by `glue/owner-rpc-fs.test.ts` and `tests/e2e/scm-file-manager.spec.ts`.
- (+) Snapshot refreshes from the owner after edits and file-manager operations, so the read view re-syncs from the source of truth without a page-local authoritative copy.
- (=) `vfs-write-port.ts` remains the frame schema/apply helper; page code waits for owner ACKs instead of fire-and-forget writes.
- (+) Honest read-only for owner-generated files: `node_modules` + generated output open view-only — the page never writes them back.
- (+) No new dependency, no cross-package API change; bridges stay playground-local; solid-js stays in `apps/playground`.
- (−) `node_modules` not browsable inline (shown by absence + presence flag); ADR-0080 lazy-reads it.
- (−) Full-tree replace per frame, not a diff. Cheap because `node_modules` is excluded (project tree is small); revisit only if a huge generated tree appears.
- (−) `EditorHost` must preserve the read/write split: reads can come from snapshots/full-byte owner reads, while writes must go through owner ACKs.
- (−) Snapshots are best-effort over an unbuffered BroadcastChannel; seed retries + explicit snapshot requests cover the subscribe race.
