/** Browser resource I/O, independent of the guest's Node Fetch globals. */
export const HOST_FETCH: unique symbol = Symbol.for('rifty.host.fetch');
export const NODE_NETWORK_FETCH: unique symbol = Symbol.for('rifty.node.networkFetch');
export type NodeNetworkFetch = (url: string, init: RequestInit) => Promise<Response>;

export function fetchHost(...args: Parameters<typeof fetch>): Promise<Response> {
  const native = (globalThis as { [HOST_FETCH]?: typeof fetch })[HOST_FETCH] ?? globalThis.fetch;
  return Reflect.apply(native, globalThis, args) as Promise<Response>;
}

/** Native-compatible node:http transport; guest Fetch admission does not narrow it. */
export function fetchNodeNetwork(url: string, init: RequestInit): Promise<Response> {
  const transport = (globalThis as { [NODE_NETWORK_FETCH]?: NodeNetworkFetch })[NODE_NETWORK_FETCH];
  return transport === undefined ? globalThis.fetch(url, init) : transport(url, init);
}
