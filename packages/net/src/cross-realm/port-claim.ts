/**
 * Cross-realm bind-claim for `listen(port)` (ADR-0186).
 *
 * The port registry is realm-local, so two Worker realms can each bind the same
 * port. At `listen(port)` (explicit port only — ephemeral `listen(0)` is skipped,
 * ADR-0186 D5) a realm broadcasts a `claim` on the per-port preview
 * `BroadcastChannel` (the SAME channel ADR-0043/0048/0180 use) and waits a
 * bounded window:
 *   - an existing OWNER replies `claim-deny` (echoing the claimant's `id`) → the
 *     claimant loses → `EADDRINUSE`;
 *   - a CONCURRENT claimant tie-breaks deterministically by `id` (lower wins);
 *   - no deny within the window → win: register + become the owner, answering
 *     future claims with `claim-deny`.
 * Released on `close()`/realm-exit (the channel dies with the realm — ADR-0186 D4).
 *
 * Relies on the WHATWG `BroadcastChannel` "a channel never receives its own
 * posts" rule: a claimant never self-denies, while sibling realms' channel
 * instances DO receive its claim. No new transport, no `PREVIEW_PORT_FRAME_VERSION`
 * bump (the `claim`/`claim-deny` frames are additive — ADR-0031).
 */

import { channelNameFor } from '../ws/channel.ts';
import {
  PREVIEW_PORT_FRAME_VERSION,
  type PreviewPortFrame,
  previewPortChannelUrl,
} from './preview-port.ts';

/**
 * Bounded window a claimant waits for a deny / competing claim before binding.
 * Must exceed the channel's same-origin delivery latency so both peers observe
 * each other's frames (ADR-0186 D2). Default suits in-browser Worker realms;
 * injectable per claim (tests use a short value).
 */
let defaultClaimWindowMs = 100;

export function setDefaultClaimWindowMs(ms: number): void {
  defaultClaimWindowMs = ms;
}

export function getDefaultClaimWindowMs(): number {
  return defaultClaimWindowMs;
}

let claimCounter = 0;
/**
 * Per-claim unique, lexicographically-orderable id (counter + random tail). The
 * tie-break needs only a TOTAL order both peers agree on, not a time order — a
 * plain string compare of two ids yields the same winner on both sides.
 */
function nextClaimId(): string {
  return `${(++claimCounter).toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Ports this realm OWNS → the channel answering future claims with `claim-deny`. */
const owned = new Map<number, BroadcastChannel>();

function startOwnerAnswerer(port: number, channel: BroadcastChannel): void {
  const onClaim = (event: MessageEvent): void => {
    const frame = event.data as PreviewPortFrame;
    if (frame.type === 'claim' && frame.port === port) {
      channel.postMessage({
        type: 'claim-deny',
        v: PREVIEW_PORT_FRAME_VERSION,
        port,
        id: frame.id,
      } satisfies PreviewPortFrame);
    }
  };
  channel.addEventListener('message', onClaim as EventListener);
  owned.set(port, channel);
}

/**
 * Broadcast a bind-claim for `port` and resolve `true` (won — this realm now
 * owns the port and answers future claims) or `false` (an existing owner denied,
 * or a concurrent claimant with a lower id won → the caller emits `EADDRINUSE`).
 * Call ONLY for an explicit `port !== 0` (ADR-0186 D5).
 */
export function claimPort(
  port: number,
  opts: { readonly windowMs?: number } = {},
): Promise<boolean> {
  const windowMs = opts.windowMs ?? defaultClaimWindowMs;
  const channel = new BroadcastChannel(channelNameFor(previewPortChannelUrl(port)));
  const myId = nextClaimId();

  return new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (won: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      channel.removeEventListener('message', onMessage as EventListener);
      if (won)
        startOwnerAnswerer(port, channel); // keep the channel to answer future claims
      else channel.close();
      resolve(won);
    };

    const onMessage = (event: MessageEvent): void => {
      const frame = event.data as PreviewPortFrame;
      if (frame.type === 'claim-deny' && frame.port === port && frame.id === myId) {
        finish(false); // an existing owner refused this claim
      } else if (frame.type === 'claim' && frame.port === port && frame.id !== myId) {
        // Concurrent claimant — the lower id wins; if theirs is lower, lose.
        if (frame.id < myId) finish(false);
      }
    };

    channel.addEventListener('message', onMessage as EventListener);
    const timer = setTimeout(() => finish(true), windowMs);
    channel.postMessage({
      type: 'claim',
      v: PREVIEW_PORT_FRAME_VERSION,
      port,
      id: myId,
    } satisfies PreviewPortFrame);
  });
}

/**
 * Release a port this realm owned (on `close()`): stop answering claims so a
 * later `listen(port)` from any realm wins. A realm that exits drops the channel
 * implicitly (ADR-0186 D4); this is the explicit in-realm path. No-op for a port
 * this realm never owned (e.g. a server that lost its claim).
 */
export function releasePort(port: number): void {
  const channel = owned.get(port);
  if (!channel) return;
  owned.delete(port);
  channel.close();
}

/** Test-only: drop every owned-port answerer so module state doesn't leak between tests. */
export function __resetPortClaims(): void {
  for (const channel of owned.values()) channel.close();
  owned.clear();
}
