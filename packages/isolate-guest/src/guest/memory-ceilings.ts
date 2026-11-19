/**
 * Guest memory isolated-vm does not count against `memoryLimit` (measured,
 * ADR-0563 §7): resizable `ArrayBuffer` / growable `SharedArrayBuffer`
 * (`maxByteLength`) and wasm memory. Each is a named gap instead.
 *
 * The buffer constructors are wrapped before any runtime module or guest code:
 * the originals stay reachable from nowhere (global and `prototype.constructor`
 * replaced; the wrapper never hands a guest value to them), and only a
 * fixed-length buffer — counted by isolated-vm's allocator — can be made.
 */
type Thrower = () => never;

const reflectConstruct = Reflect.construct;
const defineProperty = Object.defineProperty;
const ownKeys = Reflect.ownKeys;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;

function refuseMaxByteLength(
  Original: ArrayBufferConstructor | SharedArrayBufferConstructor,
  gap: Thrower,
): void {
  const name = Original.name;
  const Wrapper = function (this: unknown, length?: unknown, options?: unknown): object {
    if (new.target === undefined) throw new TypeError(`Constructor ${name} requires 'new'`);
    // The spec's order: the length, then the option. Coerced here (unary plus: a
    // BigInt or symbol throws as in ToIndex), so the original only ever sees a
    // primitive — no guest code runs while it is on the stack.
    const n =
      (typeof length === 'object' && length !== null) || typeof length === 'function'
        ? +(length as unknown as number)
        : length;
    if (
      options !== null &&
      (typeof options === 'object' || typeof options === 'function') &&
      (options as { maxByteLength?: unknown }).maxByteLength !== undefined
    )
      gap();
    return reflectConstruct(Original, [n], new.target) as object;
  };
  defineProperty(Wrapper, 'name', { value: name });
  defineProperty(Wrapper, 'length', { value: 1 });
  for (const key of ownKeys(Original)) {
    if (key === 'name' || key === 'length') continue;
    defineProperty(Wrapper, key, getOwnPropertyDescriptor(Original, key) as PropertyDescriptor);
  }
  defineProperty(Original.prototype, 'constructor', {
    value: Wrapper,
    writable: true,
    configurable: true,
    enumerable: false,
  });
  defineProperty(globalThis, name, {
    value: Wrapper,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}

/** At shim load, before any runtime module. */
export function installBufferCeilings(loud: (feature: string) => Thrower): void {
  refuseMaxByteLength(ArrayBuffer, loud('ArrayBuffer.maxByteLength'));
  refuseMaxByteLength(SharedArrayBuffer, loud('SharedArrayBuffer.maxByteLength'));
}

/** Node 24's `WebAssembly` members: each read is the named gap. */
const WEBASSEMBLY_MEMBERS = [
  'compile',
  'validate',
  'instantiate',
  'Module',
  'Instance',
  'Table',
  'Memory',
  'Global',
  'Tag',
  'JSTag',
  'Exception',
  'CompileError',
  'LinkError',
  'RuntimeError',
  'compileStreaming',
  'instantiateStreaming',
];

/**
 * An embedder that removed `WebAssembly` from the realm (isolate-host's workers,
 * ADR-0563) gets the named gap in its place; an engine that has it keeps it.
 */
export function installWebAssemblyCeiling(loud: (feature: string) => Thrower): void {
  if ('WebAssembly' in globalThis) return;
  const namespace = {};
  const gap = loud('WebAssembly');
  for (const member of WEBASSEMBLY_MEMBERS)
    defineProperty(namespace, member, { get: gap, enumerable: false, configurable: true });
  defineProperty(namespace, Symbol.toStringTag, { value: 'WebAssembly', configurable: true });
  defineProperty(globalThis, 'WebAssembly', {
    value: namespace,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
