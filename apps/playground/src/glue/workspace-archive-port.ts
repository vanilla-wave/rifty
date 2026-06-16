/**
 * Owner-served workspace-archive export/import bridge
 * (D-acceptance A1/A2 — owner is the single store owner).
 *
 * Request/response complement to the one-way snapshot push and the sibling
 * read bridge ({@link ./node-modules-port.ts}): the PAGE asks the OWNER to
 * serialize its whole source tree (download) or to apply an uploaded archive
 * (import), so the PAGE keeps NO authoritative store of its own — the owner is
 * the single store owner. The owner runs the realm-agnostic
 * {@link ./workspace-archive.ts} helpers against its realm-local `syncMirror()`,
 * which (unlike the 128 KB-capped snapshot) carries full file content with no
 * truncation, so the downloaded archive is faithful to owner-side writes
 * (shell/CLI-authored files included). page→owner request, owner→page reply,
 * correlated by `requestId`, with a per-request idle timeout.
 *
 * Playground-local for the same reason as the sibling ports: the wire format is
 * a `Vfs`/archive concern; only `@riftydev/net`'s `channelNameFor` addressing
 * primitive is borrowed.
 */

import { channelNameFor } from '@riftydev/net';
import { syncMirror } from '@riftydev/vfs';
import { exportWorkspaceArchive, importWorkspaceArchive } from './workspace-archive.ts';

/** Synthetic channel URL keyed by the owner's snapshot port — a distinct host
 *  so it never cross-talks with the write / snapshot / node_modules bridges. */
export function workspaceArchiveChannelUrl(port: number): string {
  return `ws://vfs-archive.local:${port}/__rfv`;
}

export type WorkspaceArchiveRequestFrame =
  | { readonly type: 'archive-export-req'; readonly requestId: string }
  | {
      readonly type: 'archive-import-req';
      readonly requestId: string;
      readonly archiveJson: string;
    };

export type WorkspaceArchiveReplyFrame =
  | {
      readonly type: 'archive-export-reply';
      readonly requestId: string;
      readonly archiveJson: string;
    }
  | { readonly type: 'archive-import-reply'; readonly requestId: string }
  | { readonly type: 'archive-error'; readonly requestId: string; readonly message: string };

type WorkspaceArchiveFrame = WorkspaceArchiveRequestFrame | WorkspaceArchiveReplyFrame;

let counter = 0;
function nextRequestId(): string {
  // Monotonic + random suffix: avoids collisions across an old+new page briefly
  // sharing the channel on reload (mirrors the node_modules bridge).
  return `wa${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Owner side. Serves export/import against the realm-local `syncMirror()` (the
 * single source of truth). Returns an idempotent teardown. The owner stays
 * alive to answer (ADR-0144 `serve` process).
 */
export function serveWorkspaceArchive(port: number, root: string): () => void {
  const channel = new BroadcastChannel(channelNameFor(workspaceArchiveChannelUrl(port)));

  const replyError = (requestId: string, message: string): void => {
    channel.postMessage({
      type: 'archive-error',
      requestId,
      message,
    } satisfies WorkspaceArchiveReplyFrame);
  };

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as WorkspaceArchiveFrame;
    if (frame.type === 'archive-export-req') {
      try {
        const archiveJson = exportWorkspaceArchive(syncMirror(), root);
        channel.postMessage({
          type: 'archive-export-reply',
          requestId: frame.requestId,
          archiveJson,
        } satisfies WorkspaceArchiveReplyFrame);
      } catch (err) {
        replyError(frame.requestId, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (frame.type === 'archive-import-req') {
      try {
        importWorkspaceArchive(syncMirror(), frame.archiveJson, { root });
        channel.postMessage({
          type: 'archive-import-reply',
          requestId: frame.requestId,
        } satisfies WorkspaceArchiveReplyFrame);
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

interface Waiter {
  resolve(value: string): void;
  reject(err: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

export interface WorkspaceArchiveBridge {
  /** Download: ask the owner to serialize its source tree → archive JSON. */
  export(): Promise<string>;
  /** Upload: send an archive JSON for the owner to apply to its tree. */
  import(archiveJson: string): Promise<void>;
  /** Reject all in-flight requests and close the channel. Idempotent. */
  dispose(): void;
}

/**
 * Page side. Posts request frames and resolves/rejects on the correlated reply,
 * each with a per-request idle timeout that REJECTS (the caller surfaces a
 * toast), never hangs.
 */
export function bridgeWorkspaceArchive(
  port: number,
  opts: { readonly timeoutMs?: number } = {},
): WorkspaceArchiveBridge {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const channel = new BroadcastChannel(channelNameFor(workspaceArchiveChannelUrl(port)));
  const pending = new Map<string, Waiter>();
  let torn = false;

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as WorkspaceArchiveFrame;
    if (frame.type === 'archive-export-req' || frame.type === 'archive-import-req') return; // not ours
    const waiter = pending.get(frame.requestId);
    if (!waiter) return; // unknown/late frame, or another bridge instance's
    pending.delete(frame.requestId);
    clearTimeout(waiter.timer);
    if (frame.type === 'archive-error') {
      waiter.reject(new Error(frame.message));
      return;
    }
    if (frame.type === 'archive-export-reply') {
      waiter.resolve(frame.archiveJson);
      return;
    }
    waiter.resolve(''); // archive-import-reply — no payload
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  const request = (frame: WorkspaceArchiveRequestFrame): Promise<string> => {
    if (torn) return Promise.reject(new Error('workspace archive bridge disposed'));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(frame.requestId);
        reject(new Error(`workspace archive bridge timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      pending.set(frame.requestId, { resolve, reject, timer });
      channel.postMessage(frame);
    });
  };

  return {
    export() {
      return request({ type: 'archive-export-req', requestId: nextRequestId() });
    },
    async import(archiveJson) {
      await request({ type: 'archive-import-req', requestId: nextRequestId(), archiveJson });
    },
    dispose() {
      if (torn) return;
      torn = true;
      for (const [, waiter] of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('workspace archive bridge disposed'));
      }
      pending.clear();
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}
