// Behaviour of each stream-core binding against Node's own (a Node child with --expose-internals):
// every primordial that is not Node's very object, and every member of every `internalBinding`
// and internal module the bindings supply, called on the same inputs; a binding that is no Node
// binding (rifty's modules) is the differential's. Prints the differing calls as JSON.
// usage: node --expose-internals --import tsx bindings-vs-node.mts
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const load = (p: string) => import(pathToFileURL(join(repo, p)).href);
const { ensureRuntimeJsBuiltinsRegistered } = await load(
  'packages/runtime-js/src/builtins/index.ts',
);
ensureRuntimeJsBuiltinsRegistered();
const { primordials: ours, coreBindings } = await load('packages/io/src/streams/node/bindings.ts');
const { PRIMORDIALS } = await load('packages/io/src/streams/node/generated/node-streams.js');
const require = createRequire(import.meta.url);
const emitWarning = process.emitWarning;
process.emitWarning = () => {};
const node = require('internal/test/binding') as {
  primordials: Record<string, unknown>;
  internalBinding: (id: string) => Record<string, unknown>;
};
process.emitWarning = emitWarning;
type F = (...a: unknown[]) => unknown;

/** A value as text: settled promises awaited, errors by class and message, views by bytes. */
async function show(v: unknown): Promise<string> {
  if (v instanceof Promise)
    return v.then(
      async (x) => `resolved ${await show(x)}`,
      async (e) => `rejected ${await show(e)}`,
    );
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'function') return `function ${v.name}/${v.length}`;
  if (typeof v === 'symbol') return String(v);
  if (ArrayBuffer.isView(v))
    return `${Object.prototype.toString.call(v)} ${Array.from(v as Uint8Array).join()}`;
  if (v instanceof ArrayBuffer) return `ArrayBuffer ${v.byteLength}`;
  if (typeof v === 'object' && v !== null) {
    if (Symbol.iterator in v && typeof (v as { next?: unknown }).next === 'function')
      return `iterator [${[...(v as Iterable<unknown>)].join()}]`;
    try {
      return `${v.constructor?.name ?? 'null-proto'} ${JSON.stringify(v)}`;
    } catch {
      return `${v.constructor?.name} (unserialisable)`;
    }
  }
  return `${typeof v} ${String(v)}`;
}
async function call(f: F, args: unknown[]): Promise<string> {
  try {
    return await show(Reflect.apply(f, undefined, args));
  } catch (e) {
    return `threw ${await show(e)}`;
  }
}
const u8 = () => new Uint8Array([1, 2, 3, 4]).subarray(1, 3);
const fn = function sample(this: unknown, a: unknown) {
  return [this, a];
};
/** Inputs per primordial that is not Node's own object (its receiver first for an uncurried one). */
const CASES: Record<string, unknown[][]> = {
  ArrayPrototypeFilter: [
    [[1, 2, 3], (x: number) => x > 1],
    [{ length: 2, 0: 'a', 1: 'b' }, () => true],
  ],
  ArrayPrototypeIncludes: [
    [[1, Number.NaN], Number.NaN],
    [[1, 2], 2, 2],
    [[1, 2], 1, 1],
  ],
  ArrayPrototypeIndexOf: [
    [[1, 2, 1], 1, 1],
    [[Number.NaN], Number.NaN],
  ],
  ArrayPrototypeJoin: [[[1, null, 'a']], [[1, 2], '-']],
  ArrayPrototypeMap: [[[1, 2], (x: number, i: number) => x + i]],
  ArrayPrototypePop: [[[1, 2]], [[]]],
  ArrayPrototypePush: [[[1], 2, 3]],
  ArrayPrototypeSlice: [
    [[1, 2, 3], 1],
    [[1, 2, 3], -2, -1],
  ],
  ArrayPrototypeSplice: [[[1, 2, 3], 1, 1, 'x']],
  ArrayPrototypeUnshift: [[[2], 0, 1]],
  FunctionPrototypeBind: [[fn, 'self', 'arg']],
  FunctionPrototypeCall: [
    [fn, 'self', 'arg'],
    [Math.max, null, 1, 3],
  ],
  FunctionPrototypeSymbolHasInstance: [
    [Array, []],
    [Array, {}],
  ],
  MapPrototypeGet: [
    [new Map([[1, 'a']]), 1],
    [new Map(), 2],
  ],
  ObjectPrototypeHasOwnProperty: [
    [{ a: 1 }, 'a'],
    [Object.create({ a: 1 }), 'a'],
  ],
  PromisePrototypeThen: [
    [Promise.resolve(1), (x: number) => x + 1],
    [Promise.reject(new Error('r')), null, (e: Error) => `c ${e.message}`],
  ],
  PromiseReject: [[new Error('x')]],
  PromiseResolve: [[1], [Promise.resolve(2)], [{ then: (r: F) => r(3) }]],
  PromiseWithResolvers: [[]],
  RegExpPrototypeExec: [
    [/b(c)/, 'abc'],
    [/x/, 'abc'],
  ],
  StringPrototypeEndsWith: [
    ['abc', 'c'],
    ['abc', 'b', 2],
  ],
  StringPrototypeIncludes: [
    ['abc', 'b'],
    ['abc', 'a', 1],
  ],
  StringPrototypeIndexOf: [['abca', 'a', 1]],
  StringPrototypeSlice: [['abcdef', 1, -1]],
  StringPrototypeStartsWith: [['abc', 'b', 1]],
  StringPrototypeToLowerCase: [['AbÇ']],
  TypedArrayPrototypeGetBuffer: [[u8()], [{}]],
  TypedArrayPrototypeGetByteLength: [[u8()], [new DataView(new ArrayBuffer(2))]],
  TypedArrayPrototypeGetByteOffset: [[u8()], [new Uint8Array(4)]],
  TypedArrayPrototypeIncludes: [
    [u8(), 2],
    [u8(), 1],
  ],
  TypedArrayPrototypeSet: [[new Uint8Array(4), [9, 9], 1]],
};
const out: string[] = [];
/**
 * Declared: Node's C++ `IsPromise`/`IsNativeError` read internal slots no JS check can; the binding
 * is rifty's `util/types` brand test, which a forged `Symbol.toStringTag` or an
 * `Object.create(Error.prototype)` passes. The core reads `isPromise` only in `promisify`'s DEP0174
 * test and `isNativeError` nowhere (its selection of `internal/util`).
 */
const DECLARED = new Set([
  'internalBinding(types).isPromise(object): rifty boolean true / Node boolean false',
  'internalBinding(types).isNativeError(object): rifty boolean true / Node boolean false',
]);
const compare = async (what: string, a: F, b: F, args: unknown[][]) => {
  for (const tuple of args) {
    const [ta, tb] = [structuredCloneSafe(tuple), structuredCloneSafe(tuple)];
    const [x, y] = [await call(a, ta), await call(b, tb)];
    if (x !== y) out.push(`${what}(${tuple.map((t) => typeof t).join()}): rifty ${x} / Node ${y}`);
  }
};
/** A fresh copy of the inputs for each call (a call may mutate its receiver). */
function structuredCloneSafe(tuple: unknown[]): unknown[] {
  return tuple.map((t) =>
    Array.isArray(t)
      ? [...t]
      : t instanceof Uint8Array
        ? new Uint8Array(t.buffer, t.byteOffset, t.length)
        : t,
  );
}
for (const name of PRIMORDIALS as string[]) {
  const a = ours[name];
  const b = node.primordials[name];
  if (a === b) continue;
  if (name in CASES) await compare(name, a as F, b as F, CASES[name] as unknown[][]);
  else if (/^Safe/.test(name))
    continue; // below
  else out.push(`${name}: no inputs listed (not Node's object)`);
}
// Safe collections and iterators: their methods, after a guest patched the originals.
for (const name of ['SafeMap', 'SafeSet']) {
  const run = async (C: new (x?: unknown) => Map<unknown, unknown> & Set<unknown>) => {
    const m = new C(name === 'SafeMap' ? [[1, 'a']] : [1, 2]);
    return show([...m.entries()].map(String).join(';') + ` size=${m.size} has=${m.has(1)}`);
  };
  const [x, y] = [await run(ours[name] as never), await run(node.primordials[name] as never)];
  if (x !== y) out.push(`${name}: rifty ${x} / Node ${y}`);
}
{
  const it = (S: new (a: unknown[]) => Iterable<unknown>) => [...new S([1, 2])].join();
  const [x, y] = [
    it(ours.SafeArrayIterator as never),
    it(node.primordials.SafeArrayIterator as never),
  ];
  if (x !== y) out.push(`SafeArrayIterator: rifty ${x} / Node ${y}`);
}
await compare(
  'SafePromiseAllReturnVoid',
  ours.SafePromiseAllReturnVoid as F,
  node.primordials.SafePromiseAllReturnVoid as F,
  [
    [[]],
    [[Promise.resolve(1), 2]],
    [[Promise.reject(new Error('r'))]],
    [[1, 2], (x: number) => Promise.resolve(x)],
  ],
);
// `finally` also by its callback: called once on fulfilment and on rejection, the value kept.
for (const settle of ['resolve', 'reject'] as const) {
  const run = async (f: F) => {
    const calls: string[] = [];
    const p = settle === 'resolve' ? Promise.resolve(1) : Promise.reject(new Error('r'));
    const r = await show(f(p, () => calls.push('onFinally')));
    return `${r} calls=${calls.join()}`;
  };
  const [x, y] = [
    await run(ours.SafePromisePrototypeFinally as F),
    await run(node.primordials.SafePromisePrototypeFinally as F),
  ];
  if (x !== y) out.push(`SafePromisePrototypeFinally(${settle}): rifty ${x} / Node ${y}`);
}
// internalBinding and the internal modules: each member the bindings supply, against Node's.
const b = coreBindings();
const samples: unknown[] = [
  new Uint8Array(2),
  Buffer.alloc(1),
  new Uint16Array(1),
  new DataView(new ArrayBuffer(1)),
  new ArrayBuffer(1),
  new SharedArrayBuffer(1),
  { [Symbol.toStringTag]: 'Uint8Array' },
  new Blob(['x']),
  new ReadableStream(),
  new WritableStream(),
  {},
  null,
  'str',
];
const PREDICATES: [string, string][] = [
  ['internal/util/types', 'isAnyArrayBuffer'],
  ['internal/util/types', 'isArrayBufferView'],
  ['internal/util/types', 'isUint8Array'],
  ['internal/blob', 'isBlob'],
  ['internal/webstreams/readablestream', 'isReadableStream'],
  ['internal/webstreams/writablestream', 'isWritableStream'],
];
for (const [id, member] of PREDICATES)
  await compare(
    `${id}.${member}`,
    (b.bind(id) as Record<string, F>)[member] as F,
    require(id)[member],
    samples.map((s) => [s]),
  );
await compare(
  'internalBinding(types).isPromise',
  (b.internalBinding('types') as Record<string, F>).isPromise as F,
  node.internalBinding('types').isPromise as F,
  [[Promise.resolve()], [{ then() {} }], [{ [Symbol.toStringTag]: 'Promise' }]],
);
await compare(
  'internalBinding(types).isNativeError',
  (b.internalBinding('types') as Record<string, F>).isNativeError as F,
  node.internalBinding('types').isNativeError as F,
  [[new TypeError('x')], [Object.create(Error.prototype)], [{ [Symbol.toStringTag]: 'Error' }]],
);
for (const [id, member] of [
  ['internal/abort_controller', 'AbortController'],
  ['internal/abort_controller', 'AbortSignal'],
  ['internal/encoding', 'TextEncoder'],
  ['internal/webstreams/readablestream', 'ReadableStream'],
  ['internal/webstreams/writablestream', 'WritableStream'],
  ['internal/webstreams/queuingstrategies', 'ByteLengthQueuingStrategy'],
  ['internal/webstreams/queuingstrategies', 'CountQueuingStrategy'],
  ['internal/process/task_queues', 'queueMicrotask'],
]) {
  // Node's are this realm's globals; rifty's bindings are the host's, captured at load.
  if ((b.bind(id) as Record<string, unknown>)[member] !== require(id)[member])
    out.push(`${id}.${member}: not the host's (Node's) object`);
}
{
  const fb = (b.bind('internal/buffer') as { FastBuffer: new (...a: unknown[]) => Uint8Array })
    .FastBuffer;
  const v = new fb(new ArrayBuffer(4), 1, 2);
  const shape = `${v.length} ${v.byteOffset} ${Object.getPrototypeOf(v) === (b.bind('buffer') as { Buffer: { prototype: object } }).Buffer.prototype}`;
  if (shape !== '2 1 true')
    out.push(`internal/buffer.FastBuffer: ${shape}, Node's is a Buffer.prototype view`);
}
{
  const ours2 = b.bind('internal/util/inspect') as Record<string, F>;
  const theirs = require('internal/util/inspect');
  for (const v of ['x', [1, { a: 2 }], new Map([[1, 2]]), Symbol('s')]) {
    const [x, y] = [ours2.inspect?.(v), theirs.inspect(v)];
    if (x !== y) out.push(`internal/util/inspect.inspect: rifty ${String(x)} / Node ${String(y)}`);
  }
  const [x, y] = [
    ours2.format?.('%s %d %j', 'a', 2, { b: 1 }),
    theirs.format('%s %d %j', 'a', 2, { b: 1 }),
  ];
  if (x !== y) out.push(`internal/util/inspect.format: rifty ${String(x)} / Node ${String(y)}`);
}
{
  const theirs = node.internalBinding('stream_wrap');
  const ours2 = b.internalBinding('stream_wrap') as Record<string, unknown>;
  for (const k of [
    'kReadBytesOrError',
    'kArrayBufferOffset',
    'kBytesWritten',
    'kLastWriteWasAsync',
  ])
    if (ours2[k] !== theirs[k])
      out.push(
        `internalBinding(stream_wrap).${k}: ${String(ours2[k])} / Node ${String(theirs[k])}`,
      );
  if (
    (ours2.streamBaseState as Int32Array).length !== (theirs.streamBaseState as Int32Array).length
  )
    out.push('internalBinding(stream_wrap).streamBaseState length');
}
if ((b.internalBinding('uv') as { UV_EOF: number }).UV_EOF !== node.internalBinding('uv').UV_EOF)
  out.push('internalBinding(uv).UV_EOF');
{
  const z = (b.internalBinding('constants') as { zlib: Record<string, number> }).zlib;
  if (
    JSON.stringify(Object.entries(z).map(([k, v]) => [k, String(v)])) !==
    JSON.stringify(
      Object.entries(node.internalBinding('constants').zlib as Record<string, number>).map(
        ([k, v]) => [k, String(v)],
      ),
    )
  )
    out.push('internalBinding(constants).zlib');
}
if (
  (
    b.bind('internal/v8/startup_snapshot') as { namespace: { isBuildingSnapshot: F } }
  ).namespace.isBuildingSnapshot() !==
  require('internal/v8/startup_snapshot').namespace.isBuildingSnapshot()
)
  out.push('internal/v8/startup_snapshot.namespace.isBuildingSnapshot');
process.stdout.write(JSON.stringify(out.filter((line) => !DECLARED.has(line))));
