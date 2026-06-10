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
import { dirname, syncMirror } from '@riftydev/vfs';

/**
 * Synthetic URL keyed into `channelNameFor` for the VFS write channel.
 * Mirrors {@link previewPortChannelUrl} so the addressing pattern is
 * recognisable across the two playground bridges.
 */
function vfsWritePortChannelUrl(port: number): string {
  return `ws://vfs-write.local:${port}/__rfv`;
}

/**
 * Wire frames exchanged on the VFS write channel. Mkdir is a separate
 * frame so a caller can pre-create a directory (the Real Vite adapter's
 * seeding step does this for the initial project tree); a write also
 * `mkdir -p`s its parent implicitly on the receiving side.
 */
export interface VfsWriteServerOptions {
  onWrite?(path: string): void;
}

export type VfsWriteFrame =
  | {
      readonly type: 'write';
      readonly path: string;
      readonly data: Uint8Array;
    }
  | {
      readonly type: 'mkdir';
      readonly path: string;
      readonly recursive: boolean;
    };

export function applyVfsWriteFrame(frame: VfsWriteFrame, opts: VfsWriteServerOptions = {}): void {
  if (frame.type === 'write') {
    const fs = syncMirror();
    const parent = dirname(frame.path);
    fs.mkdirSync(parent, { recursive: true });
    // BroadcastChannel hands us a structured-cloned `Uint8Array`; copy
    // into a fresh ArrayBuffer so downstream consumers don't share the
    // backing memory with the structured-clone allocator. IPC sends also
    // benefit from the same defensive copy.
    const copy = new Uint8Array(frame.data.byteLength);
    copy.set(frame.data);
    fs.writeFileSync(frame.path, copy);
    opts.onWrite?.(frame.path);
    return;
  }
  if (frame.type === 'mkdir') {
    syncMirror().mkdirSync(frame.path, { recursive: frame.recursive });
    opts.onWrite?.(frame.path);
    return;
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
export function sendVfsWrite(port: number, frame: VfsWriteFrame): void {
  const channelName = channelNameFor(vfsWritePortChannelUrl(port));
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
export function serveVfsWrites(port: number, opts: VfsWriteServerOptions = {}): () => void {
  const channelName = channelNameFor(vfsWritePortChannelUrl(port));
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
