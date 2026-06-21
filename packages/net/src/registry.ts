/**
 * Port registry shared by `@riftydev/net` and the Service Worker.
 *
 * In a real browser playground, the SW intercepts `/preview/<port>/...` and
 * forwards via a `MessageChannel` to the listening Worker. In tests (and
 * inside a single Worker), we keep an in-process table here so user code
 * can simulate the round-trip without involving a Worker.
 *
 * The `/preview/<port>/...` URL scheme and the synthetic `preview.local`
 * host are the addressing primitives shared between this registry and the
 * SW. They live in `@riftydev/io/preview-protocol` (`PREVIEW_PREFIX_RE`,
 * `PREVIEW_LOCAL_HOST`, `synthesizePreviewUrl`, `parsePreviewPath`) — see
 * ADR-0036 for the rationale. Adapters that need to parse a preview URL or
 * synthesise the upstream form import from there, not from this file.
 */

export type PortHandler = (request: Request) => Promise<Response> | Response;

const handlers: Map<number, PortHandler> = new Map();
const events = new EventTarget();

export function registerPort(port: number, handler: PortHandler): void {
  handlers.set(port, handler);
  events.dispatchEvent(new CustomEvent('register', { detail: port }));
}

export function unregisterPort(port: number): void {
  handlers.delete(port);
  events.dispatchEvent(new CustomEvent('unregister', { detail: port }));
}

export function getHandler(port: number): PortHandler | null {
  return handlers.get(port) ?? null;
}

/** Is a server already listening on `port` in THIS realm? (occupancy check) */
export function isPortBound(port: number): boolean {
  return handlers.has(port);
}

/**
 * libuv-shaped `EADDRINUSE` for a double `listen()` on an already-bound port —
 * mirrors the `connect ECONNREFUSED` precedent (`http/server.ts`). errno is the
 * NEGATIVE libuv code (`-os.constants.errno.EADDRINUSE` = -98); hardcoded because
 * `@riftydev/net` is below runtime-js and cannot import `node:os`. Real Node
 * emits this as an asynchronous `'error'` event (NOT a sync throw), so callers
 * surface it via `emit('error', …)` and return the server.
 *
 * DELIBERATE divergence: rifty is loopback-only (host is ignored, see `request.ts`),
 * so this always reports `address: '127.0.0.1'`; real Node's default-host EADDRINUSE
 * reports `'::'`/`'0.0.0.0'`. An unhandled `'error'` exits the worker 1; its MESSAGE
 * now reaches the child stderr via the kernel worker-error forward (spawn-worker
 * `onUncaughtError` → `handle.stderr()`), so the terminal sees the EADDRINUSE text.
 */
export function addrInUseError(address: string, port: number): Error {
  return Object.assign(new Error(`listen EADDRINUSE: address already in use ${address}:${port}`), {
    code: 'EADDRINUSE',
    errno: -98,
    syscall: 'listen',
    address,
    port,
  });
}

export function listPorts(): number[] {
  return [...handlers.keys()].sort((a, b) => a - b);
}

// IANA dynamic/private port range — what a real OS draws ephemeral ports from.
const EPHEMERAL_MIN = 49152;
const EPHEMERAL_MAX = 65535;

/**
 * Allocate a free virtual ephemeral port for `listen(0)` (Node's "any free
 * port"). The registry is realm-local with no OS sockets, so this scans the
 * ephemeral range for the first port not currently registered: deterministic
 * from a clean registry, collision-free against live ports. Allocation does NOT
 * reserve — the caller (`server.listen`) registers the returned port
 * synchronously, before any other code can run, so two `listen(0)` calls get
 * distinct ports.
 */
export function allocateEphemeralPort(): number {
  for (let port = EPHEMERAL_MIN; port <= EPHEMERAL_MAX; port++) {
    if (!handlers.has(port)) return port;
  }
  throw new Error('listen EADDRINUSE: no free virtual ephemeral port available');
}

export async function dispatchToPort(port: number, request: Request): Promise<Response> {
  const handler = handlers.get(port);
  if (!handler) {
    return new Response(JSON.stringify({ error: 'no_listener', port }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return handler(request);
}

export function onRegistryChange(
  handler: (port: number, action: 'register' | 'unregister') => void,
): () => void {
  const onReg = (e: Event) => handler((e as CustomEvent<number>).detail, 'register');
  const onUnreg = (e: Event) => handler((e as CustomEvent<number>).detail, 'unregister');
  events.addEventListener('register', onReg);
  events.addEventListener('unregister', onUnreg);
  return () => {
    events.removeEventListener('register', onReg);
    events.removeEventListener('unregister', onUnreg);
  };
}
