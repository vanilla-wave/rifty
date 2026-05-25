/**
 * Port registry shared by `@rifty/net` and the Service Worker.
 *
 * In a real browser playground, the SW intercepts `/preview/<port>/...` and
 * forwards via a `MessageChannel` to the listening Worker. In tests (and
 * inside a single Worker), we keep an in-process table here so user code
 * can simulate the round-trip without involving a Worker.
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

export function listPorts(): number[] {
  return [...handlers.keys()].sort((a, b) => a - b);
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
