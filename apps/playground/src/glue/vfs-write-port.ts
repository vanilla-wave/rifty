/**
 * Page → Worker VFS write bridge (ADR-0043 / D4).
 *
 * One-way mailbox: the editor on the page realm publishes file writes
 * onto a `BroadcastChannel` keyed by the dev-server port; the Real Vite
 * worker subscribes and applies each frame to its realm-local
 * `syncMirror()`. Vite's file watcher in the worker realm picks up the
 * change like any local edit and the HMR bridge (also worker-hosted)
 * broadcasts the update to the iframe.
 *
 * Why one-way:
 *   - Worker is source-of-truth for installed `node_modules`; page never
 *     reads them.
 *   - Editor is source-of-truth for user source files; page never reads
 *     them back from the worker.
 *   - Bi-directional sync needs locking + snapshot semantics. Out of
 *     scope until OPFS-as-sync (M12+).
 *
 * Why playground-local (not in `@riftydev/net`):
 *   - The wire format is a `Vfs`-shaped concern; `@riftydev/net` doesn't
 *     depend on `@riftydev/vfs` and shouldn't. The cross-realm primitive
 *     (`BroadcastChannel` + `channelNameFor`) is borrowed from net, but
 *     applying frames to `syncMirror()` is a playground adapter concern.
 *     Keep local until a second consumer (e.g. generic "spawn a worker
 *     that mirrors files") appears.
 */

import { channelNameFor } from '@riftydev/net';
import { dirname, joinPath, normalizePath, syncMirror } from '@riftydev/vfs';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';

/**
 * Synthetic URL keyed into `channelNameFor` for the VFS write channel.
 * Mirrors {@link previewPortChannelUrl} so the addressing pattern is
 * recognisable across the two playground bridges.
 */
function vfsWritePortChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('vfs-write', key);
}

/**
 * Wire frames exchanged on the VFS write channel. Mkdir is a separate
 * frame so a caller can pre-create a directory (the Real Vite adapter's
 * seeding step does this for the initial project tree); a write also
 * `mkdir -p`s its parent implicitly on the receiving side unless
 * `recursive:false` asks for file-manager-style loud missing-parent errors.
 */
export interface VfsWriteServerOptions {
  onWrite?(paths: readonly string[]): void;
}

export type VfsWriteSingleFrame =
  | {
      readonly type: 'write';
      readonly path: string;
      readonly data: Uint8Array;
      readonly recursive?: boolean;
    }
  | {
      readonly type: 'mkdir';
      readonly path: string;
      readonly recursive: boolean;
    }
  | {
      // Explorer delete/rename → worker (ADR-0076). Same one-way page→worker
      // direction as write/mkdir; the worker republishes the snapshot so the
      // removed path drops out of the page's read-only view.
      readonly type: 'rm';
      readonly path: string;
      readonly recursive: boolean;
      readonly force: boolean;
    }
  | {
      readonly type: 'rename';
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly type: 'copy';
      readonly from: string;
      readonly to: string;
    };

export type VfsWriteFrame =
  | VfsWriteSingleFrame
  | {
      readonly type: 'batch';
      readonly frames: readonly VfsWriteSingleFrame[];
    };

export interface VfsWriteIpcMessage {
  readonly type: 'rifty:vfs-write';
  readonly opId?: string;
  readonly frame: VfsWriteFrame;
}

export type VfsWriteAckMessage =
  | { readonly type: 'rifty:vfs-write-ack'; readonly opId: string; readonly ok: true }
  | {
      readonly type: 'rifty:vfs-write-ack';
      readonly opId: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

export function isVfsWriteAckMessage(message: unknown): message is VfsWriteAckMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as {
    readonly type?: unknown;
    readonly opId?: unknown;
    readonly ok?: unknown;
  };
  return (
    candidate.type === 'rifty:vfs-write-ack' &&
    typeof candidate.opId === 'string' &&
    typeof candidate.ok === 'boolean'
  );
}

export interface GuardedVfsWriteOptions {
  readonly key: OwnerBridgeKey;
  readonly frame: VfsWriteFrame;
  readonly exited: boolean;
  readonly sendIpc: (message: VfsWriteIpcMessage) => boolean;
  readonly fallback?: (key: OwnerBridgeKey, frame: VfsWriteFrame) => void;
}

type CopyPlanEntry =
  | { readonly kind: 'dir'; readonly path: string }
  | { readonly kind: 'file'; readonly path: string; readonly data: Uint8Array };

function frameTarget(frame: VfsWriteFrame): string {
  if (frame.type === 'batch') return frame.frames.map(frameTarget).join(',');
  if (frame.type === 'write' || frame.type === 'mkdir' || frame.type === 'rm') return frame.path;
  return `${frame.from} -> ${frame.to}`;
}

function frameChangedPaths(frame: VfsWriteSingleFrame): readonly string[] {
  if (frame.type === 'write' || frame.type === 'mkdir' || frame.type === 'rm') return [frame.path];
  return [frame.to];
}

function isSelfOrSubtree(from: string, to: string): boolean {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  return src === dst || dst.startsWith(`${src}/`);
}

function planCopyTree(from: string, to: string): CopyPlanEntry[] {
  const fs = syncMirror();
  if (isSelfOrSubtree(from, to)) {
    throw new Error(`EINVAL: cannot copy "${from}" into itself at "${to}"`);
  }
  if (fs.existsSync(to)) throw new Error(`"${to}" already exists`);
  const st = fs.statSync(from);
  if (st.isDirectory) {
    const plan: CopyPlanEntry[] = [{ kind: 'dir', path: to }];
    for (const child of fs.readdirSync(from)) {
      plan.push(...planCopyTree(joinPath(from, child.name), joinPath(to, child.name)));
    }
    return plan;
  }
  const data = fs.readFileBytesSync(from);
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return [{ kind: 'file', path: to, data: copy }];
}

function applyCopyPlan(plan: readonly CopyPlanEntry[]): void {
  const fs = syncMirror();
  for (const entry of plan) {
    if (entry.kind === 'dir') {
      fs.mkdirSync(entry.path, { recursive: true });
    } else {
      fs.mkdirSync(dirname(entry.path), { recursive: true });
      fs.writeFileSync(entry.path, entry.data);
    }
  }
}

export function applyVfsWriteFrame(frame: VfsWriteFrame, opts: VfsWriteServerOptions = {}): void {
  if (frame.type === 'batch') {
    const changed: string[] = [];
    try {
      for (const child of frame.frames) {
        applyVfsWriteFrame(child);
        changed.push(...frameChangedPaths(child));
      }
    } catch (err) {
      if (changed.length > 0) opts.onWrite?.(changed);
      throw err;
    }
    opts.onWrite?.(changed);
    return;
  }
  if (frame.type === 'write') {
    const fs = syncMirror();
    const parent = dirname(frame.path);
    if (frame.recursive ?? true) {
      fs.mkdirSync(parent, { recursive: true });
    } else {
      const st = fs.statSync(parent);
      if (!st.isDirectory) throw new Error(`ENOTDIR: not a directory "${parent}"`);
    }
    // BroadcastChannel hands us a structured-cloned `Uint8Array`; copy
    // into a fresh ArrayBuffer so downstream consumers don't share the
    // backing memory with the structured-clone allocator. IPC sends also
    // benefit from the same defensive copy.
    const copy = new Uint8Array(frame.data.byteLength);
    copy.set(frame.data);
    fs.writeFileSync(frame.path, copy);
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
  if (frame.type === 'mkdir') {
    syncMirror().mkdirSync(frame.path, { recursive: frame.recursive });
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
  if (frame.type === 'rm') {
    syncMirror().rmSync(frame.path, { recursive: frame.recursive, force: frame.force });
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
  if (frame.type === 'rename') {
    if (frame.from === frame.to) return;
    const plan = planCopyTree(frame.from, frame.to);
    applyCopyPlan(plan);
    syncMirror().rmSync(frame.from, { recursive: true, force: true });
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
  if (frame.type === 'copy') {
    const plan = planCopyTree(frame.from, frame.to);
    applyCopyPlan(plan);
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
}

export function sendGuardedVfsWrite(opts: GuardedVfsWriteOptions): void {
  if (opts.exited) {
    throw new Error(
      `${opts.frame.type}(${frameTarget(
        opts.frame,
      )}): workspace owner has exited — write not applied. Reload to respawn the owner.`,
    );
  }
  if (!opts.sendIpc({ type: 'rifty:vfs-write', frame: opts.frame })) {
    (opts.fallback ?? sendVfsWrite)(opts.key, opts.frame);
  }
}

/**
 * Page-side sender. Posts a single frame onto the channel; the worker
 * receives it asynchronously. Per-frame channel re-creation avoids
 * page-side listener state — the editor calls this on a Monaco edit, not
 * in a hot loop, so per-call cost is negligible.
 *
 * Returns synchronously. If the worker is not yet listening (boot race)
 * the frame is silently dropped — same semantic as the M10 same-realm
 * path when the dev server wasn't up.
 */
export function sendVfsWrite(key: OwnerBridgeKey, frame: VfsWriteFrame): void {
  const channelName = channelNameFor(vfsWritePortChannelUrl(key));
  const channel = new BroadcastChannel(channelName);
  channel.postMessage(frame);
  // Microtask close so the message has time to enqueue. BroadcastChannel
  // delivery is async; closing synchronously would cancel the send.
  queueMicrotask(() => channel.close());
}

/**
 * Worker-side receiver. Applies each frame to the worker's
 * `syncMirror()`. Returns a teardown function.
 *
 * Each `write` frame `mkdir -p`s the parent first — matches the
 * {@link SyncMirrorVfs.writeFile} semantic so "file appears at path X"
 * doesn't depend on whether the dir existed.
 */
export function serveVfsWrites(key: OwnerBridgeKey, opts: VfsWriteServerOptions = {}): () => void {
  const channelName = channelNameFor(vfsWritePortChannelUrl(key));
  const channel = new BroadcastChannel(channelName);

  const onMessage = (event: MessageEvent): void => {
    applyVfsWriteFrame(event.data as VfsWriteFrame, opts);
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
