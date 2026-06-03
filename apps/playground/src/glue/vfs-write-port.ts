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
 *   - The npm-install + Vite read pipeline lives in the worker. The
 *     worker is the source-of-truth for installed `node_modules`; the
 *     page never reads them.
 *   - The editor is the source-of-truth for user source files. The page
 *     never reads them back from the worker either — the in-memory
 *     editor state is the model.
 *   - Bi-directional sync needs locking + snapshot semantics. Out of
 *     scope until OPFS-as-sync (M12+).
 *
 * Why playground-local (not in `@riftydev/net`):
 *   - The wire format is a `Vfs`-shaped concern; `@riftydev/net` doesn't
 *     depend on `@riftydev/vfs` and shouldn't. The cross-realm helper
 *     primitive (`BroadcastChannel` + `channelNameFor`) is borrowed from
 *     net, but the application of the frames to `syncMirror()` is a
 *     playground adapter concern. Keep it local until a second consumer
 *     (e.g. a generic "spawn a worker that mirrors files") appears.
 */

import { channelNameFor } from '@riftydev/net';
import { dirname, syncMirror } from '@riftydev/vfs';

/**
 * Synthetic URL used as the keyed input to `channelNameFor` for the VFS
 * write channel. Mirrors {@link previewPortChannelUrl} so the addressing
 * pattern is recognisable across the two playground bridges.
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

/**
 * Page-side sender. Posts a single frame onto the channel; the worker
 * receives it asynchronously. Per-frame channel re-creation keeps the
 * helper trivially safe (no listener state to manage on the page side)
 * — the editor calls this in response to a Monaco edit, not in a hot
 * loop, so the per-call cost is negligible.
 *
 * Returns synchronously; callers don't need to await. If the worker is
 * not yet listening (race during boot), the frame is silently dropped —
 * the same semantic the M10 same-realm path had when the dev server
 * wasn't yet up.
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
 * Worker-side receiver. Subscribes to the channel and applies each
 * frame to the worker's `syncMirror()`. Returns a teardown function.
 *
 * Each `write` frame `mkdir -p`s the parent directory before writing —
 * matches the {@link SyncMirrorVfs.writeFile} semantic so the editor's
 * mental model ("file appears at path X") doesn't depend on whether the
 * dir existed.
 */
export function serveVfsWrites(port: number): () => void {
  const channelName = channelNameFor(vfsWritePortChannelUrl(port));
  const channel = new BroadcastChannel(channelName);

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as VfsWriteFrame;
    if (frame.type === 'write') {
      const fs = syncMirror();
      const parent = dirname(frame.path);
      fs.mkdirSync(parent, { recursive: true });
      // BroadcastChannel hands us a structured-cloned `Uint8Array`; copy
      // into a fresh ArrayBuffer so downstream consumers don't share the
      // backing memory with the structured-clone allocator.
      const copy = new Uint8Array(frame.data.byteLength);
      copy.set(frame.data);
      fs.writeFileSync(frame.path, copy);
      return;
    }
    if (frame.type === 'mkdir') {
      syncMirror().mkdirSync(frame.path, { recursive: frame.recursive });
      return;
    }
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
