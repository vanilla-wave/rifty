# ADR 0076: Cross-realm reverse VFS snapshot — the file explorer reflects the real-vite worker project

Status: Accepted (2026-06-04)
Date: 2026-06-04
Relates to: ADR-0075 (VSCode shell + VFS file explorer over the main-thread `syncMirror()` — its Consequences flag the split-VFS gap this closes for real-vite), ADR-0043 (Vite-in-Worker — the real-vite realm whose VFS we mirror), ADR-0014 (split sync/async VFS, per-realm backends), the playground-local one-way page→worker write port (`vfs-write-port.ts`, this is its mirror image), D-002 (solid-js isolated to `apps/playground`).

## Context

ADR-0075 gave the playground a VFS file explorer over the **main-thread** `syncMirror()`. That is honest for REPL and Dev Mode (both write the main-thread mirror), but **Real Vite runs in a kernel-spawned Worker realm** (ADR-0043) with its *own* `syncMirror()`. The npm install, the seeded project (`index.html`, `package.json`, `src/main.js`), and everything Vite writes live in that worker realm; the page never had them. So switching to the Real Vite demo left the explorer showing the page's `/workspace` (a `README` + the program mirror) — it **did not switch into the Vite filesystem**. ADR-0075's Consequences called this out explicitly as future work; this is that work, for the real-vite case. (Reported as a bug: "при переключении на vite demo файловый менеджер не переходит в файловую систему vite".)

The only existing cross-realm VFS channel is `vfs-write-port.ts`: a **one-way page→worker** mailbox (editor edits land in the worker mirror so Vite's watcher sees them). Its docstring deliberately scopes out bi-directional sync ("needs locking + snapshot semantics … out of scope until OPFS-as-sync"). A naïve "mirror worker files back into the page's writable `syncMirror`" would (a) require that locking, and (b) offer the explorer full CRUD on page-resident copies whose edits never reach the worker — a silent fake (CLAUDE.md hard rule).

The 2026-06-04 library-fit review (workflow) confirmed no third-party VFS library helps here: rifty's signature is sync-over-persistent-OPFS-without-SAB, and the worker-realm visibility problem is rifty-specific — keep-custom.

This adds a new cross-realm wire protocol across >2 files / >100 lines → **IRREVERSIBLE** by the reversibility checklist, ratified inline (ADR-0063 standing authority). It introduces **no new npm dependency** and **no cross-package public API** (the bridge is playground-local glue, same as the write port — `@riftydev/net` does not depend on `@riftydev/vfs`; only its `channelNameFor` addressing primitive is borrowed).

## Decision

A **one-way, display-only worker→page VFS snapshot bridge** — the mirror image of the write port — feeding a **read-only** page-side view that the explorer renders in real-vite mode.

1. **Wire protocol (`vfs-snapshot-port.ts`).** Keyed by dev-server port via `channelNameFor('ws://vfs-snapshot.local:<port>/__rfv')` (same scheme as the write port). The worker `publishVfsSnapshot(port, frame)`; the page `subscribeVfsSnapshot(port, cb)`. A frame is a **full-tree replace**: `{ type, root, entries: {path, kind, size, content?}[], nodeModulesPresent }`. `collectSnapshot(fs, root)` is a pure DFS (dirs before files, matching the explorer sort) that **excludes** heavy/derived dirs (`node_modules`, `.git`, `.vite`, `dist`) and inlines the bytes of files ≤128 KB (large/binary send size only). It is unit-tested with a fake fs (no DOM, no channels).

2. **When the worker publishes.** In `real-vite-bootstrap.ts`: right after `seedProject` (plus retries at 300/1200/3000 ms to beat the page-subscribe race — one-way BroadcastChannel has no buffer), after `install` completes, after `server.listen()`, and on every Vite `watcher.change`. So the page sees the skeleton during the ~20 s install and stays live with edits.

3. **Read-only page view (`snapshot-fs.ts`).** `SnapshotFs` implements the `FsOpsTarget` read slice (`existsSync`/`readFileBytesSync`/`readdirSync`/`statSync`) from the latest frame; `readOnly = true`; every mutation (`writeFileSync`/`mkdirSync`/`rmSync`) **throws a clear pathful error** (no silent stub — the worker owns these files). `clear()` empties it when leaving the mode so a stale tree never lingers.

4. **Wiring (`App.tsx`).** A `createEffect` subscribes while `mode === 'real-vite'` (cleans up / clears otherwise). The explorer's backing store and the editor's `vfs` become `mode === 'real-vite' ? snapshotFs : syncMirror()`. The explorer **captures `vfs` once** (ADR-0075's memo-leak guard), so the mode flip **remounts** it via a plain `<Show>`/fallback. The `FileExplorer` gains a `readOnly` prop that hides the new-file/folder/rename/delete controls and shows a `read-only` badge. `FsOpsTarget` gains an optional `readOnly` flag; `EditorHost.openFile` opens files from a read-only source view-only (same `readOnlyPaths` path as binary files).

5. **`node_modules` is intentionally not listed** (excluded at the source); `nodeModulesPresent` records that it exists so the UI can hint it later. The explorer shows project source, not the thousands of installed files — the worker stays source-of-truth for `node_modules`, which the page never reads.

**Program-tab safety (m10):** the permanent program tab is bound to `machine.source`/`setSource`, **not** to `props.vfs`, and edits route page→worker via the existing write port. Swapping the explorer/editor `vfs` does not touch that path, so the m10 HMR textarea flow is byte-for-byte unchanged. Clicking `src/main.js` in the mirror focuses the live program tab (ADR-0075's dual-writer guard), not a read-only copy.

Verified live against a real Vite worker install: the explorer shows `src/ · index.html · package.json · package-lock.json` (node_modules excluded), updates live (package-lock appears post-install via watch), the `read-only` badge shows with CRUD hidden, opening `index.html` shows the real worker bytes and ignores edits, and leaving real-vite restores the writable page explorer.

## Alternatives considered

- **Mirror worker files into the page's writable `syncMirror`.** Fewer UI changes, but needs the locking the write port scoped out, and offers CRUD on copies whose edits never reach the worker → silent fake. Rejected (honesty).
- **Seed the same project skeleton into the page mirror on real-vite enter.** Avoids a channel, but it's a static guess that drifts from the worker's real state and doesn't reflect install/watch output. Rejected.
- **A request/response remote FS (lazy read on expand).** More faithful (could include `node_modules`), but the explorer + editor are synchronous and would need an async rework; the push snapshot is sync-friendly and bounded. Deferred; could supersede this if browsing `node_modules` becomes a real need.
- **Adopt a browser-VFS library (ZenFS / memfs / lightning-fs).** None solves cross-realm visibility, and all conflict with rifty's no-SAB sync-OPFS property / zero-dep bias (2026-06-04 review). Rejected.

## Consequences

- (+) Switching to Real Vite now switches the explorer **into the Vite project** — the reported bug is fixed, and the view stays live with installs and edits.
- (+) Honest read-only: mutations throw, edits are blocked at the editor, a badge says why — no fake writes.
- (+) No new dependency, no cross-package API change; the bridge is symmetric with the existing write port; solid-js stays in `apps/playground`.
- (−) `node_modules` is not browsable in the explorer (shown by absence + a presence flag). Acceptable for v1; a lazy remote-read FS is the path if it's wanted.
- (−) Full-tree replace per frame (not a diff). Cheap because `node_modules` is excluded (the project tree is small); revisit only if a huge generated tree appears.
- (−) Snapshots are best-effort over an unbuffered BroadcastChannel; the seed retries + the explorer's existing poll cover the subscribe race. Dev Mode (main-thread) is unaffected — it already shares the page mirror.
```
