/**
 * Owner → page rifty-git status feed.
 *
 * The page cannot read `.git`; the owner recomputes `makeGit().status()` after
 * existing mutation publish points and pushes compact `{path,code}` entries.
 */

import type { StatusEntry } from '@riftydev/git';
import { channelNameFor } from '@riftydev/net';
import { type GitStatusDeltaEntry, statusEntriesToDelta } from './git-status.ts';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';

export const GIT_STATUS_LABEL = 'rifty-git status';

export interface GitStatusFrame {
  readonly type: 'git-status';
  readonly label: typeof GIT_STATUS_LABEL;
  readonly entries: readonly GitStatusDeltaEntry[];
}

interface GitStatusRequestFrame {
  readonly type: 'git-status-req';
}

type GitStatusChannelFrame = GitStatusFrame | GitStatusRequestFrame;

export interface GitStatusSource {
  status(): Promise<readonly StatusEntry[]>;
}

export interface GitStatusPublisher {
  schedule(): void;
  publishNow(opts?: { readonly force?: boolean }): Promise<void>;
  dispose(): void;
}

export interface GitStatusPublisherOptions {
  readonly debounceMs?: number;
}

export interface GitStatusStore {
  readonly map: ReadonlyMap<string, string>;
  clear(): void;
  dispose(): void;
}

function gitStatusChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('git-status', key);
}

function signature(entries: readonly GitStatusDeltaEntry[]): string {
  return entries.map((entry) => `${entry.path}\0${entry.code}`).join('\0');
}

export function createGitStatusPublisher(
  source: GitStatusSource,
  publish: (frame: GitStatusFrame) => void,
  opts: GitStatusPublisherOptions = {},
): GitStatusPublisher {
  const debounceMs = opts.debounceMs ?? 200;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSignature: string | undefined;
  let disposed = false;

  const clearPending = (): void => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };

  const publishNow = async (publishOpts: { readonly force?: boolean } = {}): Promise<void> => {
    if (disposed) return;
    clearPending();
    const entries = statusEntriesToDelta(await source.status());
    const nextSignature = signature(entries);
    if (!publishOpts.force && nextSignature === lastSignature) return;
    lastSignature = nextSignature;
    publish({ type: 'git-status', label: GIT_STATUS_LABEL, entries });
  };

  return {
    schedule() {
      if (disposed) return;
      clearPending();
      timer = setTimeout(() => {
        timer = undefined;
        void publishNow();
      }, debounceMs);
    },
    publishNow,
    dispose() {
      if (disposed) return;
      disposed = true;
      clearPending();
    },
  };
}

export function serveGitStatusFeed(
  key: OwnerBridgeKey,
  source: GitStatusSource,
  opts: GitStatusPublisherOptions = {},
): GitStatusPublisher {
  const channel = new BroadcastChannel(channelNameFor(gitStatusChannelUrl(key)));
  const publisher = createGitStatusPublisher(
    source,
    (frame) => {
      channel.postMessage(frame);
    },
    opts,
  );

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as GitStatusChannelFrame;
    if (frame && frame.type === 'git-status-req') {
      void publisher.publishNow({ force: true });
    }
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  let torn = false;
  return {
    schedule: () => publisher.schedule(),
    publishNow: (publishOpts) => publisher.publishNow(publishOpts),
    dispose() {
      if (torn) return;
      torn = true;
      publisher.dispose();
      channel.removeEventListener('message', onMessage as unknown as EventListener);
      channel.close();
    },
  };
}

export function requestGitStatus(key: OwnerBridgeKey): void {
  const channel = new BroadcastChannel(channelNameFor(gitStatusChannelUrl(key)));
  channel.postMessage({ type: 'git-status-req' } satisfies GitStatusRequestFrame);
  queueMicrotask(() => channel.close());
}

export function subscribeGitStatus(
  key: OwnerBridgeKey,
  onFrame: (frame: GitStatusFrame) => void,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(gitStatusChannelUrl(key)));
  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as GitStatusChannelFrame;
    if (frame && frame.type === 'git-status') onFrame(frame);
  };
  channel.addEventListener('message', onMessage as unknown as EventListener);
  requestGitStatus(key);

  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}

export function applyGitStatusFrame(cache: Map<string, string>, frame: GitStatusFrame): void {
  cache.clear();
  for (const entry of frame.entries) cache.set(entry.path, entry.code);
}

export function createGitStatusStore(key: OwnerBridgeKey): GitStatusStore {
  const cache = new Map<string, string>();
  const unsubscribe = subscribeGitStatus(key, (frame) => applyGitStatusFrame(cache, frame));
  return {
    map: cache,
    clear() {
      cache.clear();
    },
    dispose() {
      unsubscribe();
    },
  };
}
