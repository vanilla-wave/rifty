const CHANNEL_PREFIX = 'rifty:ws:';

/**
 * Derive the `BroadcastChannel` name used by the cross-realm WebSocket bridge
 * for a given WS url. Query/fragment are intentionally ignored so cache-buster
 * params do not split a single socket endpoint into multiple channels.
 */
export function channelNameFor(url: string): string {
  const u = new URL(url);
  return `${CHANNEL_PREFIX}${u.host}${u.pathname}`;
}

/**
 * Channel used by the default WebSocket surface for cross-realm connection
 * discovery. The concrete request URL still travels in the `open` frame; the
 * server validates host/path before accepting.
 */
export function portChannelNameFor(url: string): string {
  const u = new URL(url);
  const port = u.port || (u.protocol === 'wss:' ? '443' : '80');
  return channelNameFor(`ws://websocket-port.local:${port}/__rifty_ws`);
}
