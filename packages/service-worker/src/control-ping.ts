import {
  SW_FRAME_VERSION,
  SW_PING,
  SW_PONG,
  SW_ROUTING_VERSION,
  type SwPongFrame,
} from './protocol.ts';

/** One SW-global handler; each transferred reply port identifies one host attempt. */
export function createControlPingHandler(
  warn: (message: string) => void = (message) => console.warn(message),
): (event: ExtendableMessageEvent) => void {
  const mismatchWarned = new Set<string>();
  return (event): void => {
    const data = event.data as {
      type?: unknown;
      frameVersion?: unknown;
      routingVersion?: unknown;
    } | null;
    if (!data || typeof data !== 'object' || data.type !== SW_PING) return;
    const source = event.source as Client | ServiceWorker | MessagePort | null;
    const clientId =
      source && 'id' in source && typeof source.id === 'string' ? source.id : '<unknown>';
    const frameOk = data.frameVersion === SW_FRAME_VERSION;
    const routingOk = data.routingVersion === SW_ROUTING_VERSION;
    if (!frameOk || !routingOk) {
      if (!mismatchWarned.has(clientId)) {
        mismatchWarned.add(clientId);
        const drifted: string[] = [];
        if (!frameOk) drifted.push('frame');
        if (!routingOk) drifted.push('routing');
        warn(
          `[rifty/service-worker] ping protocol version mismatch from ${clientId} (${drifted.join(
            '+',
          )}): got frame=${String(data.frameVersion)} routing=${String(
            data.routingVersion,
          )}, want frame=${SW_FRAME_VERSION} routing=${SW_ROUTING_VERSION}`,
        );
      }
      return;
    }
    const pong: SwPongFrame = {
      type: SW_PONG,
      frameVersion: SW_FRAME_VERSION,
      routingVersion: SW_ROUTING_VERSION,
      from: 'service-worker',
    };
    const replyPort = event.ports[0];
    if (replyPort === undefined) {
      source?.postMessage(pong);
      return;
    }
    try {
      replyPort.postMessage(pong);
    } finally {
      replyPort.close();
    }
  };
}
