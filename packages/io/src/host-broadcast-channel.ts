/**
 * The realm's native `BroadcastChannel` for rifty's own channels. The guest
 * global holds the event loop until `close()` (ADR-0529); its wrapper parks the
 * native constructor under this symbol, so infrastructure channels never hold
 * a guest loop.
 */
export const HOST_BROADCAST_CHANNEL: unique symbol = Symbol.for('rifty.host.BroadcastChannel');

export function openHostBroadcastChannel(name: string): BroadcastChannel {
  const Host =
    (globalThis as { [HOST_BROADCAST_CHANNEL]?: typeof BroadcastChannel })[
      HOST_BROADCAST_CHANNEL
    ] ?? globalThis.BroadcastChannel;
  return new Host(name);
}
