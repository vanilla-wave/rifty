/**
 * Worker → Page VFS snapshot bridge (ADR-0076).
 *
 * Reverse of {@link ./vfs-write-port.ts}: that mailbox carries editor writes
 * page→worker; this carries the worker's *project tree* worker→page so the
 * {@link ../components/FileExplorer.tsx | FileExplorer} can show the real Vite
 * project (which lives only in the worker realm's `syncMirror()`). One-way and
 * display-only — the page renders read-only and never writes back, so the
 * bi-directional-sync locking hazard from `vfs-write-port.ts` does not apply.
 *
 * `node_modules` and other heavy/derived dirs are excluded — the worker stays
 * source-of-truth for them and the page never reads them. Small text files
 * inline their bytes (editor can open read-only); large/binary send size only.
 *
 * Playground-local, not `@riftydev/net`: same as the write port — the wire
 * format is a `Vfs`-shaped concern and `@riftydev/net` does not depend on
 * `@riftydev/vfs`. Only `channelNameFor` is borrowed.
 */

import { channelNameFor } from '@riftydev/net';
import type { VfsDirent } from '@riftydev/vfs';
import { joinPath } from '@riftydev/vfs';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';

/** Dirs never walked into a snapshot — heavy or derived, not user project source. */
export const SNAPSHOT_EXCLUDE_DIRS: readonly string[] = ['node_modules', '.git', '.vite', 'dist'];

/** Files at/under this many bytes ship their content; larger send size only. */
export const SNAPSHOT_MAX_CONTENT_BYTES = 128 * 1024;

/** One node of the project tree. Dirs carry no content; files may carry bytes. */
export interface VfsSnapshotEntry {
  readonly path: string;
  readonly kind: 'file' | 'dir';
  readonly size: number;
  /** Present for files small enough to inline (see {@link SNAPSHOT_MAX_CONTENT_BYTES}). */
  readonly content?: Uint8Array;
}

/** A full-tree replace frame. The receiver swaps its store wholesale per frame. */
export interface VfsSnapshotFrame {
  readonly type: 'snapshot';
  readonly root: string;
  readonly entries: readonly VfsSnapshotEntry[];
  /** True when an excluded `node_modules` exists under root (so the UI can hint it). */
  readonly nodeModulesPresent: boolean;
}

/**
 * Page→owner readiness handshake frame (ADR-0146). The owner can't know when
 * the page has subscribed (one-way BroadcastChannel, no buffer); historically it
 * blind-republished on a `[300,1200,3000]ms` retry-storm. Instead the page posts
 * this once on subscribe and the owner replies with a fresh snapshot — pull, not
 * spray. Shares the snapshot channel; {@link subscribeVfsSnapshot} ignores it.
 */
export interface VfsSnapshotRequestFrame {
  readonly type: 'snapshot-req';
}

/** The narrow sync-mirror slice {@link collectSnapshot} reads (keeps tests tiny). */
export interface SnapshotSource {
  readdirSync(path: string): readonly VfsDirent[];
  statSync(path: string): { isFile: boolean; isDirectory: boolean; size?: number };
  readFileBytesSync(path: string): Uint8Array;
}

export interface CollectOptions {
  readonly exclude?: readonly string[];
  readonly maxContentBytes?: number;
}

/**
 * Walk `root` into a flat {@link VfsSnapshotFrame}, depth-first, dirs before
 * files (matching the explorer's own sort). Excluded directories are recorded
 * (as a dir entry) but never descended into. Pure — no DOM, no channels.
 */
export function collectSnapshot(
  fs: SnapshotSource,
  root: string,
  options: CollectOptions = {},
): VfsSnapshotFrame {
  const exclude = new Set(options.exclude ?? SNAPSHOT_EXCLUDE_DIRS);
  const maxContent = options.maxContentBytes ?? SNAPSHOT_MAX_CONTENT_BYTES;
  const entries: VfsSnapshotEntry[] = [];
  let nodeModulesPresent = false;

  const walk = (dir: string): void => {
    let children: readonly VfsDirent[];
    try {
      children = fs.readdirSync(dir);
    } catch {
      return; // dir vanished between reads
    }
    const sorted = [...children].sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });
    for (const child of sorted) {
      const path = joinPath(dir, child.name);
      if (child.isDirectory) {
        if (exclude.has(child.name)) {
          if (child.name === 'node_modules') nodeModulesPresent = true;
          continue; // record presence, don't descend
        }
        entries.push({ path, kind: 'dir', size: 0 });
        walk(path);
      } else {
        const entry = fileEntry(fs, path, maxContent);
        if (entry) entries.push(entry);
      }
    }
  };

  walk(root);
  return { type: 'snapshot', root, entries, nodeModulesPresent };
}

function fileEntry(fs: SnapshotSource, path: string, maxContent: number): VfsSnapshotEntry | null {
  let size = 0;
  try {
    size = fs.statSync(path).size ?? 0;
  } catch {
    return null;
  }
  if (size > maxContent) return { path, kind: 'file', size };
  try {
    const content = fs.readFileBytesSync(path);
    return { path, kind: 'file', size: content.byteLength, content };
  } catch {
    return { path, kind: 'file', size };
  }
}

/** Synthetic channel URL keyed by the owner bridge key (mirrors the write port's). */
function snapshotChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('vfs-snapshot', key);
}

/**
 * Worker-side publisher. Posts a full-tree frame, received asynchronously.
 * Per-call open/close keeps it stateless — published on discrete events (seed,
 * install done, each watcher change), not a hot loop.
 */
export function publishVfsSnapshot(key: OwnerBridgeKey, frame: VfsSnapshotFrame): void {
  const channel = new BroadcastChannel(channelNameFor(snapshotChannelUrl(key)));
  channel.postMessage(frame);
  // Microtask close: BroadcastChannel delivery is async, a sync close cancels the send.
  queueMicrotask(() => channel.close());
}

/**
 * Page-side subscriber. Invokes `onFrame` for every snapshot the worker
 * publishes on `port`. Returns a teardown that closes the channel.
 */
export function subscribeVfsSnapshot(
  key: OwnerBridgeKey,
  onFrame: (frame: VfsSnapshotFrame) => void,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(snapshotChannelUrl(key)));
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as VfsSnapshotFrame;
    if (frame && frame.type === 'snapshot') onFrame(frame);
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}

/**
 * Page side. Ask the owner to (re)publish its snapshot now — the readiness
 * handshake (ADR-0146). Posted once when the page subscribes; pairs with the
 * owner's startup publish so the initial sync is deterministic whichever side
 * comes up first, without the old blind-retry timers.
 */
export function requestVfsSnapshot(key: OwnerBridgeKey): void {
  const channel = new BroadcastChannel(channelNameFor(snapshotChannelUrl(key)));
  channel.postMessage({ type: 'snapshot-req' } satisfies VfsSnapshotRequestFrame);
  queueMicrotask(() => channel.close());
}

/**
 * Owner side. Run `publish` on every page `snapshot-req`. The owner's startup
 * publish covers a page that subscribed first; this covers a page that
 * subscribes (or reloads) after the owner is already serving. Returns a
 * teardown that closes the channel.
 */
export function serveSnapshotRequests(key: OwnerBridgeKey, publish: () => void): () => void {
  const channel = new BroadcastChannel(channelNameFor(snapshotChannelUrl(key)));
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as { readonly type?: unknown };
    if (frame && frame.type === 'snapshot-req') publish();
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}
