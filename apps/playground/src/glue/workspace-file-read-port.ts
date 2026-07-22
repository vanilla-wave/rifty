/**
 * Owner-served full-byte workspace file read bridge.
 *
 * The owner snapshot intentionally caps inlined content at 128 KiB. This bridge
 * is the single-file escape hatch for user-triggered egress (Download): page
 * asks the owner for one working-tree file and receives the exact bytes, with no
 * cap and no placeholder `null`.
 */

import { channelNameFor } from '@riftydev/net';
import { normalizePath, syncMirror } from '@riftydev/vfs';
import { isReadablePath } from './node-modules-port.ts';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';

export function workspaceFileReadChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('vfs-file-read', key);
}

export type WorkspaceFileReadRequestFrame = {
  readonly type: 'file-read-req';
  readonly requestId: string;
  readonly path: string;
};

export type WorkspaceFileReadReplyFrame =
  | {
      readonly type: 'file-read-reply';
      readonly requestId: string;
      readonly bytes: Uint8Array;
    }
  | { readonly type: 'file-read-error'; readonly requestId: string; readonly message: string };

type WorkspaceFileReadFrame = WorkspaceFileReadRequestFrame | WorkspaceFileReadReplyFrame;

// TODO(backlog: playground/page-owner-correlation-substrate) — same correlated
// request/reply scaffold as git-owner-port + three older bridges; ADR-0305 substrate.
let counter = 0;
function nextRequestId(): string {
  return `fr${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

export function serveWorkspaceFileReads(key: OwnerBridgeKey, root: string): () => void {
  const channel = new BroadcastChannel(channelNameFor(workspaceFileReadChannelUrl(key)));

  const replyError = (requestId: string, message: string): void => {
    channel.postMessage({ type: 'file-read-error', requestId, message });
  };

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as WorkspaceFileReadFrame;
    if (frame.type !== 'file-read-req') return;
    const path = normalizePath(frame.path);
    if (!isReadablePath(path, root)) {
      replyError(frame.requestId, `refused: ${frame.path} is outside the workspace root`);
      return;
    }
    try {
      const bytes = syncMirror().readFileBytesSync(path);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      channel.postMessage({
        type: 'file-read-reply',
        requestId: frame.requestId,
        bytes: copy,
      } satisfies WorkspaceFileReadReplyFrame);
    } catch (err) {
      replyError(frame.requestId, err instanceof Error ? err.message : String(err));
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

interface Waiter {
  resolve(value: Uint8Array): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkspaceFileReadBridge {
  readFileBytes(path: string): Promise<Uint8Array>;
  dispose(): void;
}

export function bridgeWorkspaceFileReads(
  key: OwnerBridgeKey,
  opts: { readonly timeoutMs?: number } = {},
): WorkspaceFileReadBridge {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const channel = new BroadcastChannel(channelNameFor(workspaceFileReadChannelUrl(key)));
  const pending = new Map<string, Waiter>();
  let torn = false;

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as WorkspaceFileReadFrame;
    if (frame.type === 'file-read-req') return;
    const waiter = pending.get(frame.requestId);
    if (!waiter) return;
    pending.delete(frame.requestId);
    clearTimeout(waiter.timer);
    if (frame.type === 'file-read-error') {
      waiter.reject(new Error(frame.message));
      return;
    }
    waiter.resolve(frame.bytes);
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  return {
    readFileBytes(path) {
      if (torn) return Promise.reject(new Error('workspace file read bridge disposed'));
      return new Promise<Uint8Array>((resolve, reject) => {
        const requestId = nextRequestId();
        const timer = setTimeout(() => {
          pending.delete(requestId);
          reject(new Error(`workspace file read bridge timeout after ${timeoutMs}ms`));
        }, timeoutMs);
        pending.set(requestId, { resolve, reject, timer });
        channel.postMessage({ type: 'file-read-req', requestId, path });
      });
    },
    dispose() {
      if (torn) return;
      torn = true;
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('workspace file read bridge disposed'));
      }
      pending.clear();
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}
