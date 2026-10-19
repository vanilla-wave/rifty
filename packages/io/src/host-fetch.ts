/** Browser resource I/O, independent of the guest's Node Fetch globals. */
export const HOST_FETCH: unique symbol = Symbol.for('rifty.host.fetch');

export function fetchHost(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const native = (globalThis as { [HOST_FETCH]?: typeof fetch })[HOST_FETCH] ?? globalThis.fetch;
  return Reflect.apply(native, globalThis, [input, init]) as Promise<Response>;
}
