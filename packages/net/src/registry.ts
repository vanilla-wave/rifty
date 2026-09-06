/**
 * Port registry shared by `@riftydev/net` and the Service Worker.
 *
 * In a real browser playground, the SW intercepts `/preview/<port>/...` and
 * forwards via a `MessageChannel` to the listening Worker. In tests (and
 * inside a single Worker), we keep an in-process table here so user code
 * can simulate the round-trip without involving a Worker.
 *
 * The `/preview/<port>/...` URL scheme, legacy explicit-HMR `preview.local`
 * host constant, and SW upstream `localhost:<port>` synthesis live in
 * `@riftydev/io/preview-protocol` (`PREVIEW_PREFIX_RE`, `PREVIEW_LOCAL_HOST`,
 * `synthesizePreviewUrl`, `parsePreviewPath`) — see ADR-0036 for the
 * rationale. Adapters that need to parse a preview URL or synthesise the
 * upstream form import from there, not from this file.
 */

export type PortHandler = (request: Request) => Promise<Response> | Response;
export type PortRegistrationOwner = symbol;

interface PortRegistration {
  readonly handler: PortHandler;
  readonly owner?: PortRegistrationOwner;
}

const registrations = new Map<number, PortRegistration>();
const boundOwners = new WeakMap<object, PortRegistrationOwner>();
const events = new EventTarget();

/** Bind/read an owner on a server instance without widening its Node-shaped API. */
export function bindPortRegistrationOwner(target: object, owner: PortRegistrationOwner): void {
  boundOwners.set(target, owner);
}

export function portRegistrationOwner(target: object): PortRegistrationOwner | undefined {
  return boundOwners.get(target);
}

export function registerPort(
  port: number,
  handler: PortHandler,
  owner?: PortRegistrationOwner,
): void {
  registrations.set(port, owner === undefined ? { handler } : { handler, owner });
  events.dispatchEvent(new CustomEvent('register', { detail: { port, owner } }));
}

export function unregisterPort(port: number): void {
  const owner = registrations.get(port)?.owner;
  registrations.delete(port);
  events.dispatchEvent(new CustomEvent('unregister', { detail: { port, owner } }));
}

export function getHandler(port: number): PortHandler | null {
  return registrations.get(port)?.handler ?? null;
}

/** Is a server already listening on `port` in THIS realm? (occupancy check) */
export function isPortBound(port: number): boolean {
  return registrations.has(port);
}

/** True only when the exact loader-generation owner registered this port. */
export function isPortRegisteredBy(port: number, owner: PortRegistrationOwner): boolean {
  return registrations.get(port)?.owner === owner;
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
  return [...registrations.keys()].sort((a, b) => a - b);
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
    if (!registrations.has(port)) return port;
  }
  throw new Error('listen EADDRINUSE: no free virtual ephemeral port available');
}

export async function dispatchToPort(port: number, request: Request): Promise<Response> {
  const handler = registrations.get(port)?.handler;
  if (!handler) {
    return new Response(JSON.stringify({ error: 'no_listener', port }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return handler(request);
}

export function onRegistryChange(
  handler: (
    port: number,
    action: 'register' | 'unregister',
    owner: PortRegistrationOwner | undefined,
  ) => void,
): () => void {
  const onReg = (event: Event) => {
    const { port, owner } = (
      event as CustomEvent<{ readonly port: number; readonly owner?: PortRegistrationOwner }>
    ).detail;
    handler(port, 'register', owner);
  };
  const onUnreg = (event: Event) => {
    const { port, owner } = (
      event as CustomEvent<{ readonly port: number; readonly owner?: PortRegistrationOwner }>
    ).detail;
    handler(port, 'unregister', owner);
  };
  events.addEventListener('register', onReg);
  events.addEventListener('unregister', onUnreg);
  return () => {
    events.removeEventListener('register', onReg);
    events.removeEventListener('unregister', onUnreg);
  };
}
