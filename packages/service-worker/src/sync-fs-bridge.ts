/** ADR-0539: stateless SW routing, one reply port per owner request. */
const OPEN = 'rifty-sync-fs-open/v1';
const REQUEST = 'rifty-sync-fs-request/v1';
const PATH = '__rifty_sync_fs/';
const TIMEOUT_MS = 30_000;

export interface SyncFsBridge {
  readonly endpoint: string;
  dispose(): void;
}

export async function connectSyncFsBridge(
  onRequest: (bytes: Uint8Array, reply: MessagePort, caller: string) => void,
  container: ServiceWorkerContainer = navigator.serviceWorker,
): Promise<SyncFsBridge> {
  const controller =
    container.controller ??
    (await new Promise<ServiceWorker>((resolve, reject) => {
      const changed = (): void => {
        if (container.controller === null) return;
        clearTimeout(timer);
        container.removeEventListener('controllerchange', changed);
        resolve(container.controller);
      };
      const timer = setTimeout(() => {
        container.removeEventListener('controllerchange', changed);
        reject(new Error('no controlling rifty Service Worker'));
      }, 3000);
      container.addEventListener('controllerchange', changed);
      changed();
    }));
  const token = crypto.randomUUID();
  const channel = new MessageChannel();
  const endpoint = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error('rifty Service Worker child-process handshake timed out'));
    }, 3000);
    channel.port1.onmessage = (event: MessageEvent<{ endpoint?: unknown }>) => {
      clearTimeout(timer);
      channel.port1.close();
      if (typeof event.data?.endpoint !== 'string')
        reject(new Error('invalid child-process handshake'));
      else resolve(event.data.endpoint);
    };
    controller.postMessage({ type: OPEN, token }, [channel.port2]);
  });
  const listener = (event: MessageEvent): void => {
    if (
      event.source !== container.controller ||
      event.data?.type !== REQUEST ||
      event.data.token !== token
    )
      return;
    const reply = event.ports[0];
    if (reply === undefined) return;
    if (!(event.data.bytes instanceof Uint8Array)) {
      reply.postMessage({ error: 'invalid child filesystem request' });
      reply.close();
      return;
    }
    try {
      onRequest(event.data.bytes, reply, String(event.data.caller ?? ''));
    } catch (error) {
      reply.postMessage({ error: String(error) });
      reply.close();
    }
  };
  container.addEventListener('message', listener);
  return { endpoint, dispose: () => container.removeEventListener('message', listener) };
}

export function installSyncFsInterceptor(scope: ServiceWorkerGlobalScope): void {
  const prefix = new URL(PATH, scope.registration.scope).pathname;
  scope.addEventListener('message', (event: ExtendableMessageEvent) => {
    if (event.data?.type !== OPEN || typeof event.data.token !== 'string') return;
    const source = event.source;
    const reply = event.ports[0];
    if (reply === undefined || source === null || !('id' in source)) return;
    reply.postMessage({
      endpoint: new URL(`${PATH}${source.id}/${event.data.token}`, scope.registration.scope).href,
    });
    reply.close();
  });
  scope.addEventListener('fetch', (event: FetchEvent) => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith(prefix)) return;
    event.respondWith(
      (async () => {
        const [clientId, token, extra] = url.pathname.slice(prefix.length).split('/');
        if (!clientId || !token || extra !== undefined || event.request.method !== 'POST')
          return new Response('invalid child filesystem route', { status: 400 });
        const client = await scope.clients.get(clientId);
        if (!client || client.type !== 'window')
          return new Response('child filesystem owner is unavailable', { status: 503 });
        const bytes = new Uint8Array(await event.request.arrayBuffer());
        const channel = new MessageChannel();
        return await new Promise<Response>((resolve) => {
          const settle = (response: Response): void => {
            clearTimeout(timer);
            channel.port1.close();
            resolve(response);
          };
          const timer = setTimeout(
            () =>
              settle(
                new Response('child filesystem owner did not reply; mutation outcome unknown', {
                  status: 504,
                }),
              ),
            TIMEOUT_MS,
          );
          channel.port1.onmessage = (reply: MessageEvent) => {
            settle(
              reply.data instanceof Uint8Array
                ? new Response(reply.data as Uint8Array<ArrayBuffer>, {
                    headers: { 'Content-Type': 'application/octet-stream' },
                  })
                : new Response(String(reply.data?.error ?? 'invalid owner reply'), { status: 502 }),
            );
          };
          client.postMessage(
            { type: REQUEST, token, bytes, caller: url.searchParams.get('caller') ?? '' },
            [channel.port2],
          );
        });
      })(),
    );
  });
}
