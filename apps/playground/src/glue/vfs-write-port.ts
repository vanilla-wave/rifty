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
import {
  type PersistFailureReport,
  type VfsMutationIntent,
  dirname,
  normalizePath,
  syncMirror,
} from '@riftydev/vfs';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';
import {
  type PackageMutationImpact,
  classifyVfsMutationIntentsPackageImpact,
} from './package-mutation-executor.ts';

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
  /** Optional serialized composition path; it owns applying the frame. */
  applyFrame?(frame: VfsWriteFrame): void | Promise<void>;
}

export type VfsWriteSingleFrame =
  | {
      readonly type: 'write';
      readonly path: string;
      readonly data: Uint8Array;
      readonly recursive?: boolean;
      /** Idempotent seed: skip (no-op, still acked) when the path already exists,
       *  so a boot/reload re-seed never clobbers a persisted/edited file. Matches
       *  the worker-side `seedProject`'s `if !exists`. Overwrite is the default. */
      readonly ifAbsent?: boolean;
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

/**
 * Page → owner durability-barrier request (ADR-0187 Corrected). A
 * `rifty:vfs-write-ack` means "applied to the owner's in-memory mirror" —
 * OPFS write-through drains asynchronously behind it. This acked flush is the
 * deterministic barrier: the owner drains the queue and acks ok only when the
 * durable tier is clean, so "durable" is provable without wall-clock sleeps.
 */
export interface VfsFlushIpcMessage {
  readonly type: 'rifty:vfs-flush';
  readonly opId: string;
}

export type VfsFlushAckMessage =
  | { readonly type: 'rifty:vfs-flush-ack'; readonly opId: string; readonly ok: true }
  | {
      readonly type: 'rifty:vfs-flush-ack';
      readonly opId: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

export function isVfsFlushIpcMessage(message: unknown): message is VfsFlushIpcMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as { readonly type?: unknown; readonly opId?: unknown };
  return candidate.type === 'rifty:vfs-flush' && typeof candidate.opId === 'string';
}

export function isVfsFlushAckMessage(message: unknown): message is VfsFlushAckMessage {
  if (!message || typeof message !== 'object') return false;
  const candidate = message as {
    readonly type?: unknown;
    readonly opId?: unknown;
    readonly ok?: unknown;
  };
  return (
    candidate.type === 'rifty:vfs-flush-ack' &&
    typeof candidate.opId === 'string' &&
    typeof candidate.ok === 'boolean'
  );
}

export interface VfsFlushHandlerOptions {
  readonly opId: string;
  /** Realm-local durability drain (the owner wires `flushSyncMirror`). */
  readonly flush: () => Promise<PersistFailureReport | undefined>;
  readonly send: (message: VfsFlushAckMessage) => void;
}

/**
 * Owner side of the acked flush. Durable-or-throw: acks ok only when the
 * drained ledger is clean (`total === 0` ⇔ disk caught up with the mirror);
 * still-unhealed persist failures nack with a sample so the page's
 * `flushDurable()` rejects loudly instead of resolving a durability lie.
 * The memory backend has no durability tier (`flush` → undefined) — ok.
 */
export async function handleVfsFlushRequest(opts: VfsFlushHandlerOptions): Promise<void> {
  try {
    const report = await opts.flush();
    const total = report?.total ?? 0;
    if (total > 0) {
      const sample = (report?.failures ?? [])
        .slice(0, 3)
        .map((f) => `${f.op} ${f.path}: ${f.message}`)
        .join('; ');
      opts.send({
        type: 'rifty:vfs-flush-ack',
        opId: opts.opId,
        ok: false,
        error: {
          name: 'PersistFailureError',
          message: `OPFS write-through drained with ${total} unhealed persist failure(s): ${sample}`,
        },
      });
      return;
    }
    opts.send({ type: 'rifty:vfs-flush-ack', opId: opts.opId, ok: true });
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    opts.send({
      type: 'rifty:vfs-flush-ack',
      opId: opts.opId,
      ok: false,
      error: { name: error.name, message: error.message },
    });
  }
}

export interface GuardedVfsWriteOptions {
  readonly key: OwnerBridgeKey;
  readonly frame: VfsWriteFrame;
  readonly exited: boolean;
  readonly sendIpc: (message: VfsWriteIpcMessage) => boolean;
  readonly fallback?: (key: OwnerBridgeKey, frame: VfsWriteFrame) => void;
}

export type PreparedVfsWriteFrame =
  | { readonly status: 'noop' }
  | { readonly status: 'ready'; readonly apply: () => void };

function frameTarget(frame: VfsWriteFrame): string {
  if (frame.type === 'batch') return frame.frames.map(frameTarget).join(',');
  if (frame.type === 'write' || frame.type === 'mkdir' || frame.type === 'rm') return frame.path;
  return `${frame.from} -> ${frame.to}`;
}

function frameChangedPaths(frame: VfsWriteSingleFrame): readonly string[] {
  if (frame.type === 'write' || frame.type === 'mkdir' || frame.type === 'rm') return [frame.path];
  if (frame.type === 'rename') return [frame.from, frame.to];
  return [frame.to];
}

export function vfsWriteFrameTouchesPath(frame: VfsWriteFrame, path: string): boolean {
  const target = normalizePath(path);
  if (frame.type === 'batch') {
    return frame.frames.some((child) => vfsWriteFrameTouchesPath(child, target));
  }
  if (frame.type === 'write' || frame.type === 'mkdir') {
    return normalizePath(frame.path) === target;
  }
  const containsTarget = (candidate: string): boolean => {
    const normalized = normalizePath(candidate);
    return normalized === target || target.startsWith(`${normalized}/`);
  };
  if (frame.type === 'rm') return containsTarget(frame.path);
  if (frame.type === 'rename') {
    return containsTarget(frame.from) || containsTarget(frame.to);
  }
  return containsTarget(frame.to);
}

export function classifyVfsWriteFramePackageImpact(
  frame: VfsWriteFrame,
  root: string,
): PackageMutationImpact {
  return classifyVfsMutationIntentsPackageImpact(vfsWriteFrameMutationIntents(frame), root);
}

export function vfsWriteFrameMutationIntents(frame: VfsWriteFrame): readonly VfsMutationIntent[] {
  if (frame.type === 'batch') return frame.frames.flatMap(vfsWriteFrameMutationIntents);
  if (frame.type === 'rename' || frame.type === 'copy') {
    return [{ kind: frame.type, sourcePath: frame.from, targetPath: frame.to }];
  }
  return [{ kind: frame.type, path: frame.path }];
}

function assertPortableVfsWriteFrame(frame: VfsWriteFrame): void {
  const authority = syncMirror() as ReturnType<typeof syncMirror> & {
    readonly assertPortablePaths?: (paths: readonly string[]) => void;
  };
  const paths = vfsWriteFrameMutationIntents(frame).flatMap((intent) =>
    'path' in intent ? [intent.path] : [intent.sourcePath, intent.targetPath],
  );
  authority.assertPortablePaths?.(paths);
}

function isSelfOrSubtree(from: string, to: string): boolean {
  const src = normalizePath(from);
  const dst = normalizePath(to);
  return src === dst || dst.startsWith(`${src}/`);
}

function validateCopyTree(from: string, to: string): void {
  const fs = syncMirror();
  if (isSelfOrSubtree(from, to)) {
    throw new Error(`EINVAL: cannot copy "${from}" into itself at "${to}"`);
  }
  if (fs.existsSync(to)) throw new Error(`"${to}" already exists`);
  fs.statSync(from);
}

function validateVfsWriteFrame(frame: VfsWriteSingleFrame): void {
  const fs = syncMirror();
  if (frame.type === 'write') {
    const parent = dirname(frame.path);
    if (fs.existsSync(parent)) {
      const st = fs.statSync(parent);
      if (!st.isDirectory) throw new Error(`ENOTDIR: not a directory "${parent}"`);
    } else if (frame.recursive === false) {
      fs.statSync(parent);
    }
    return;
  }
  if (frame.type === 'mkdir') {
    if (fs.existsSync(frame.path)) {
      const st = fs.statSync(frame.path);
      if (!frame.recursive || !st.isDirectory) {
        throw new Error(`"${frame.path}" already exists`);
      }
    }
    if (!frame.recursive) {
      const parent = dirname(frame.path);
      const st = fs.statSync(parent);
      if (!st.isDirectory) throw new Error(`ENOTDIR: not a directory "${parent}"`);
    }
    return;
  }
  if (frame.type === 'rm') {
    if (!frame.force) fs.statSync(frame.path);
    return;
  }
  if (frame.type === 'rename') {
    if (frame.from === frame.to) return;
    if (isSelfOrSubtree(frame.from, frame.to)) {
      throw new Error(`EINVAL: cannot rename "${frame.from}" into itself at "${frame.to}"`);
    }
    fs.statSync(frame.from);
    if (fs.existsSync(frame.to)) throw new Error(`"${frame.to}" already exists`);
    const parent = dirname(frame.to);
    const st = fs.statSync(parent);
    if (!st.isDirectory) throw new Error(`ENOTDIR: not a directory "${parent}"`);
    return;
  }
  validateCopyTree(frame.from, frame.to);
}

function assertBatchFramesIndependent(frames: readonly VfsWriteSingleFrame[]): void {
  const touched: string[] = [];
  for (const frame of frames) {
    for (const path of frameChangedPaths(frame).map(normalizePath)) {
      const conflict = touched.find(
        (prev) => path === prev || path.startsWith(`${prev}/`) || prev.startsWith(`${path}/`),
      );
      if (conflict) {
        throw new Error(`EINVAL: batch path conflict "${path}" overlaps "${conflict}"`);
      }
      touched.push(path);
    }
  }
}

function vfsWriteFrameIsNoop(frame: VfsWriteFrame): boolean {
  const fs = syncMirror();
  if (frame.type === 'batch') return frame.frames.every(vfsWriteFrameIsNoop);
  if (frame.type === 'write') return frame.ifAbsent === true && fs.existsSync(frame.path);
  if (frame.type === 'mkdir') {
    return frame.recursive && fs.statSyncOrNull(frame.path)?.isDirectory === true;
  }
  if (frame.type === 'rm') return frame.force && !fs.existsSync(frame.path);
  if (frame.type === 'rename') return normalizePath(frame.from) === normalizePath(frame.to);
  return false;
}

/** Validate/no-op classify at the FIFO head, before any package stamp transition. */
export function prepareVfsWriteFrame(
  frame: VfsWriteFrame,
  opts: VfsWriteServerOptions = {},
): PreparedVfsWriteFrame {
  assertPortableVfsWriteFrame(frame);
  if (frame.type === 'batch') {
    assertBatchFramesIndependent(frame.frames);
    for (const child of frame.frames) validateVfsWriteFrame(child);
  } else {
    validateVfsWriteFrame(frame);
  }
  if (vfsWriteFrameIsNoop(frame)) return { status: 'noop' };
  return { status: 'ready', apply: () => applyVfsWriteFrame(frame, opts) };
}

export function applyVfsWriteFrame(frame: VfsWriteFrame, opts: VfsWriteServerOptions = {}): void {
  assertPortableVfsWriteFrame(frame);
  if (frame.type === 'batch') {
    assertBatchFramesIndependent(frame.frames);
    for (const child of frame.frames) validateVfsWriteFrame(child);
    const changed: string[] = [];
    for (const child of frame.frames) {
      applyVfsWriteFrame(child);
      changed.push(...frameChangedPaths(child));
    }
    opts.onWrite?.(changed);
    return;
  }
  if (frame.type === 'write') {
    const fs = syncMirror();
    // Idempotent seed: an existing file is left untouched (still a successful
    // no-op → the IPC caller's ack fires). A boot/reload re-seed must never
    // clobber a persisted edit; overwrite semantics are the default (unset).
    if (frame.ifAbsent && fs.existsSync(frame.path)) return;
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
    if (syncMirror().existsSync(frame.to)) throw new Error(`"${frame.to}" already exists`);
    syncMirror().renameSync(frame.from, frame.to);
    opts.onWrite?.(frameChangedPaths(frame));
    return;
  }
  if (frame.type === 'copy') {
    validateCopyTree(frame.from, frame.to);
    const fs = syncMirror();
    if (fs.statSync(frame.from).isFile) {
      fs.mkdirSync(dirname(frame.to), { recursive: true });
    }
    fs.cpSync(frame.from, frame.to, { recursive: true });
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
    const frame = event.data as VfsWriteFrame;
    void (async (): Promise<void> => {
      if (opts.applyFrame) await opts.applyFrame(frame);
      else applyVfsWriteFrame(frame, opts);
    })().catch((error: unknown) => {
      console.error('[vfs-write] owner frame failed', error);
    });
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
