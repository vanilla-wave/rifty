export const NODE_STDIN_FORWARDER = Symbol.for('rifty.runtime-js.stdin-forwarder.v1');
type Listener = (...args: unknown[]) => void;
export type StdinForwarder = (data: Listener, end: Listener) => () => void;

/** Private fd subscriptions neither expose guest meta-events nor resume its stream. */
export class NodeStdinForwarding {
  private readonly entries = new Set<{ data: Listener; end: Listener; ended: boolean }>();
  constructor(private readonly flush: () => void) {}
  get active(): boolean {
    return this.entries.size > 0;
  }
  readonly listen: StdinForwarder = (data, end) => {
    const entry = { data, end, ended: false };
    this.entries.add(entry);
    queueMicrotask(this.flush);
    return () => {
      this.entries.delete(entry);
    };
  };
  data(chunk: unknown): void {
    for (const entry of [...this.entries]) entry.data(chunk);
  }
  end(): void {
    for (const entry of [...this.entries]) {
      if (entry.ended) continue;
      entry.ended = true;
      entry.end();
    }
  }
}

export function forwardOwnedProcessStdin(
  source: object,
  data: Listener,
  end: Listener,
): (() => void) | undefined {
  const forward = Reflect.get(source, NODE_STDIN_FORWARDER) as StdinForwarder | undefined;
  return typeof forward === 'function' ? forward.call(source, data, end) : undefined;
}
