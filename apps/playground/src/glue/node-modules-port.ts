/**
 * Lazy `node_modules` remote-read bridge (ADR-0080).
 *
 * The two-way, request/response complement to the one-way snapshot push
 * ({@link ./vfs-snapshot-port.ts}). The snapshot deliberately EXCLUDES
 * `node_modules` (a full-tree clone of thousands of files per frame), so the
 * explorer cannot browse installed packages. This bridge fills that gap by
 * pulling ONE directory level (or one file) on demand, only what the user
 * expands — page→worker request, worker→page reply, correlated by `requestId`,
 * with a per-request idle timeout (the exact machinery of `@riftydev/net`'s
 * cross-realm preview port, minus streaming — a listing or a ≤128 KB file fits
 * one structured clone).
 *
 * Scope: the worker serves any path at/under the workspace `root` (ADR-0148, the
 * co-resident dev server inside the owner, widened this from node_modules-only —
 * the owner is now the single source of truth, so the editor opens owner-only
 * project files over this same port).
 * `normalizePath` collapses `..`, so an escape lands outside `root` and is
 * refused. Over-cap files reply `content: null` (the page surfaces "too large"),
 * never a silent empty read. Any worker-side throw (ENOENT, scope violation,
 * vanished file) replies `nm-error`, which REJECTS the page promise (the
 * explorer renders an error row) rather than hanging.
 *
 * Playground-local for the same reason as the write/snapshot ports: the wire
 * format is a `Vfs`-shaped concern and `@riftydev/net` does not depend on
 * `@riftydev/vfs`; only the `channelNameFor` addressing primitive is borrowed.
 */

import { channelNameFor } from '@riftydev/net';
import { joinPath, normalizePath, syncMirror } from '@riftydev/vfs';
import {
  NODE_MODULES_MAX_CONTENT_BYTES,
  type NodeModulesBridge,
  type NodeModulesDirEntry,
} from './node-modules-model.ts';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';

/** Files at/under this many bytes ship their content; larger reply size only.
 *  Matches {@link ./vfs-snapshot-port.ts}'s `SNAPSHOT_MAX_CONTENT_BYTES`. */
export { NODE_MODULES_MAX_CONTENT_BYTES } from './node-modules-model.ts';

/** Synthetic channel URL keyed by dev-server port — a distinct synthetic host
 *  so it never cross-talks with the write / snapshot / preview-port bridges. */
export function nodeModulesChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('vfs-nodemods', key);
}

export type { NodeModulesBridge, NodeModulesDirEntry } from './node-modules-model.ts';

export type NodeModulesRequestFrame =
  | { readonly type: 'nm-readdir-req'; readonly requestId: string; readonly path: string }
  | { readonly type: 'nm-readfile-req'; readonly requestId: string; readonly path: string };

export type NodeModulesReplyFrame =
  | {
      readonly type: 'nm-readdir-reply';
      readonly requestId: string;
      readonly entries: readonly NodeModulesDirEntry[];
    }
  | {
      readonly type: 'nm-readfile-reply';
      readonly requestId: string;
      readonly size: number;
      readonly content: Uint8Array | null;
    }
  | { readonly type: 'nm-error'; readonly requestId: string; readonly message: string };

type NodeModulesFrame = NodeModulesRequestFrame | NodeModulesReplyFrame;

let counter = 0;
function nextRequestId(): string {
  // Monotonic + random suffix: avoids collisions across concurrent reads and
  // across an old+new page briefly sharing the channel on reload (mirrors the preview port).
  return `nm${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * True when `normalizedPath` lies at/under the workspace `root`. Widened from a
 * node_modules-only segment guard to a general workspace read-port (ADR-0148,
 * single-source-owner): the editor opens owner-only project files on demand,
 * not just packages.
 * `normalizePath` collapses `..`, so an escape (`…/../etc`) lands outside `root`
 * and is refused — the root boundary is the real anti-escape guard.
 */
export function isReadablePath(normalizedPath: string, root: string): boolean {
  const nr = normalizePath(root);
  return normalizedPath === nr || normalizedPath.startsWith(`${nr}/`);
}

function direntsDirsFirst(
  entries: readonly { readonly name: string; readonly isDirectory: boolean }[],
): readonly { readonly name: string; readonly isDirectory: boolean }[] {
  return [...entries].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

/**
 * Worker side. Serves `node_modules` reads against the realm-local
 * `syncMirror()` (which holds the installed tree — the exclusion is only in
 * `collectSnapshot`, never in the mirror). Returns an idempotent teardown.
 *
 * The worker must stay alive to answer reads — the owner is spawned as an
 * ADR-0144 `serve` process (the kernel keeps the realm alive until the handle
 * is killed), which retired the old ADR-0077 keep-alive promise.
 */
export function serveNodeModulesReads(key: OwnerBridgeKey, root: string): () => void {
  const channel = new BroadcastChannel(channelNameFor(nodeModulesChannelUrl(key)));

  const replyError = (requestId: string, message: string): void => {
    channel.postMessage({ type: 'nm-error', requestId, message } satisfies NodeModulesReplyFrame);
  };

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as NodeModulesFrame;
    if (frame.type === 'nm-readdir-req') {
      const np = normalizePath(frame.path);
      if (!isReadablePath(np, root)) {
        replyError(frame.requestId, `refused: ${frame.path} is outside the workspace root`);
        return;
      }
      try {
        const fs = syncMirror();
        const entries: NodeModulesDirEntry[] = direntsDirsFirst(fs.readdirSync(np)).map((child) => {
          let size = 0;
          if (!child.isDirectory) {
            try {
              size = fs.statSync(joinPath(np, child.name)).size ?? 0;
            } catch {
              size = 0;
            }
          }
          return { name: child.name, kind: child.isDirectory ? 'dir' : 'file', size };
        });
        channel.postMessage({
          type: 'nm-readdir-reply',
          requestId: frame.requestId,
          entries,
        } satisfies NodeModulesReplyFrame);
      } catch (err) {
        replyError(frame.requestId, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (frame.type === 'nm-readfile-req') {
      const np = normalizePath(frame.path);
      if (!isReadablePath(np, root)) {
        replyError(frame.requestId, `refused: ${frame.path} is outside the workspace root`);
        return;
      }
      try {
        const fs = syncMirror();
        const size = fs.statSync(np).size ?? 0;
        if (size > NODE_MODULES_MAX_CONTENT_BYTES) {
          channel.postMessage({
            type: 'nm-readfile-reply',
            requestId: frame.requestId,
            size,
            content: null,
          } satisfies NodeModulesReplyFrame);
          return;
        }
        const bytes = fs.readFileBytesSync(np);
        const copy = new Uint8Array(bytes.byteLength);
        copy.set(bytes);
        channel.postMessage({
          type: 'nm-readfile-reply',
          requestId: frame.requestId,
          size: copy.byteLength,
          content: copy,
        } satisfies NodeModulesReplyFrame);
      } catch (err) {
        replyError(frame.requestId, err instanceof Error ? err.message : String(err));
      }
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

/** The resolved value of a read — a directory listing or a file payload. */
type NodeModulesReplyValue =
  | readonly NodeModulesDirEntry[]
  | { readonly size: number; readonly content: Uint8Array | null };

interface Waiter {
  resolve(value: NodeModulesReplyValue): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Page side. Posts request frames and resolves/rejects on the correlated reply.
 * Each call arms a per-request idle timeout that REJECTS (async callers handle
 * rejection — the explorer shows an error row, the cache evicts so a retry
 * re-issues), unlike the preview port which resolves a 502 Response.
 */
export function bridgeNodeModulesReads(
  key: OwnerBridgeKey,
  opts: { readonly timeoutMs?: number } = {},
): NodeModulesBridge {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const channel = new BroadcastChannel(channelNameFor(nodeModulesChannelUrl(key)));
  const pending = new Map<string, Waiter>();
  let torn = false;

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as NodeModulesFrame;
    if (frame.type === 'nm-readdir-req' || frame.type === 'nm-readfile-req') return; // not ours
    const waiter = pending.get(frame.requestId);
    if (!waiter) return; // unknown/late frame, or another bridge instance's
    pending.delete(frame.requestId);
    clearTimeout(waiter.timer);
    if (frame.type === 'nm-error') {
      waiter.reject(new Error(frame.message));
      return;
    }
    if (frame.type === 'nm-readdir-reply') {
      waiter.resolve(frame.entries);
      return;
    }
    // nm-readfile-reply — copy bytes into a fresh ArrayBuffer so the consumer
    // doesn't share backing memory with the structured-clone allocator.
    const content = frame.content
      ? (() => {
          const copy = new Uint8Array(frame.content.byteLength);
          copy.set(frame.content);
          return copy;
        })()
      : null;
    waiter.resolve({ size: frame.size, content });
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  const request = (frame: NodeModulesRequestFrame): Promise<NodeModulesReplyValue> => {
    if (torn) return Promise.reject(new Error('node_modules bridge disposed'));
    return new Promise<NodeModulesReplyValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(frame.requestId);
        reject(new Error(`node_modules bridge timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(frame.requestId, { resolve, reject, timer });
      channel.postMessage(frame);
    });
  };

  return {
    readdir(path) {
      return request({ type: 'nm-readdir-req', requestId: nextRequestId(), path }) as Promise<
        readonly NodeModulesDirEntry[]
      >;
    },
    readFile(path) {
      return request({ type: 'nm-readfile-req', requestId: nextRequestId(), path }) as Promise<{
        readonly size: number;
        readonly content: Uint8Array | null;
      }>;
    },
    dispose() {
      if (torn) return;
      torn = true;
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('node_modules bridge disposed'));
      }
      pending.clear();
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}
