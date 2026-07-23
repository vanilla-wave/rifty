const NODE_PROCESS_BRAND = Symbol.for('rifty.runtime-js.node-process.v1');

export interface RuntimeOwnedNodeProcessContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  cwd(): string;
}

/** Install one non-forgeable-by-shape realm-global ownership brand. */
export function brandRuntimeOwnedNodeProcess(target: object): void {
  Object.defineProperty(target, NODE_PROCESS_BRAND, {
    value: NODE_PROCESS_BRAND,
    enumerable: false,
    configurable: false,
    writable: false,
  });
}

/** Runtime ownership survives duplicate production bundle classes. */
export function isRuntimeOwnedNodeProcess(value: unknown): value is RuntimeOwnedNodeProcessContext {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, NODE_PROCESS_BRAND);
  return (
    descriptor?.value === NODE_PROCESS_BRAND &&
    descriptor.enumerable === false &&
    descriptor.configurable === false &&
    descriptor.writable === false
  );
}
