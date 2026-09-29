/**
 * Shared program pieces for the `serialization: 'advanced'` fork cases
 * (ADR-0448). One source runs in real Node, in the parity runner's rifty and,
 * through `tests/browser-unit/advanced-ipc.spec.ts`, in rifty under Chromium.
 * Setup-file keys carry no directory: each runner roots them at the parent's cwd.
 */

/** `describe(value)`: layout-free JSON view of one received value. */
export const DESCRIBE_SOURCE = `
function describe(value, seen = new Map(), path = '$') {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const type = typeof value;
  if (type === 'number') return Object.is(value, -0) ? 'number:-0' : 'number:' + String(value);
  if (type === 'bigint') return 'bigint:' + String(value);
  if (type === 'string') return 'string:' + value;
  if (type === 'boolean') return 'boolean:' + String(value);
  if (type !== 'object') return type;
  if (seen.has(value)) return 'ref:' + seen.get(value);
  seen.set(value, path);
  const proto = Object.getPrototypeOf(value);
  const ctor = proto === null ? 'null-prototype' : String(proto.constructor && proto.constructor.name);
  const tag = Object.prototype.toString.call(value).slice(8, -1);
  if (ArrayBuffer.isView(value)) {
    const { Buffer } = require('node:buffer');
    return {
      view: ctor,
      isBuffer: Buffer.isBuffer(value),
      constructorIsBuffer: value.constructor === Buffer,
      bytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      shared: value.buffer instanceof SharedArrayBuffer,
    };
  }
  if (value instanceof SharedArrayBuffer) return { sharedArrayBuffer: value.byteLength };
  if (value instanceof ArrayBuffer) return { arrayBuffer: Array.from(new Uint8Array(value)) };
  if (value instanceof Date) return { date: Number.isNaN(value.getTime()) ? 'invalid' : value.toISOString() };
  if (value instanceof RegExp) return { regexp: String(value), lastIndex: value.lastIndex };
  if (value instanceof Map) {
    return { map: Array.from(value).map(([k, v], i) => [describe(k, seen, path + '.key' + i), describe(v, seen, path + '.value' + i)]) };
  }
  if (value instanceof Set) return { set: Array.from(value).map((v, i) => describe(v, seen, path + '.member' + i)) };
  if (value instanceof Error) {
    return {
      error: ctor,
      name: value.name,
      message: value.message,
      stack: typeof value.stack,
      own: Object.getOwnPropertyNames(value).sort(),
      cause: Object.prototype.hasOwnProperty.call(value, 'cause') ? describe(value.cause, seen, path + '.cause') : 'absent',
    };
  }
  if (tag === 'Boolean' || tag === 'Number' || tag === 'String' || tag === 'BigInt') {
    return { boxed: tag, value: String(value.valueOf()) };
  }
  if (Array.isArray(value)) {
    const out = { array: [], length: value.length, holes: [] };
    for (let i = 0; i < value.length; i++) {
      if (Object.prototype.hasOwnProperty.call(value, i)) out.array.push(describe(value[i], seen, path + '[' + i + ']'));
      else out.holes.push(i);
    }
    const extra = Object.keys(value).filter((key) => String(Number(key)) !== key);
    if (extra.length > 0) out.extra = extra.map((key) => [key, describe(value[key], seen, path + '.' + key)]);
    return out;
  }
  const out = { object: ctor, tag, entries: Object.keys(value).map((key) => [key, describe(value[key], seen, path + '.' + key)]) };
  const symbols = Object.getOwnPropertySymbols(value).length;
  if (symbols > 0) out.symbols = symbols;
  const hidden = Object.getOwnPropertyNames(value).filter((key) => !Object.prototype.propertyIsEnumerable.call(value, key));
  if (hidden.length > 0) out.nonEnumerable = hidden;
  return out;
}
function errorShape(error) {
  return {
    class: error && error.constructor ? error.constructor.name : typeof error,
    name: error && error.name,
    code: (error && error.code) ?? null,
    message: error && error.message,
  };
}
`;

/**
 * Echo child: replies to `{ label, value }` with what it saw and the value
 * itself. Only a 'message' listener keeps it alive (Node's IPC hold).
 */
export const ECHO_CHILD_SOURCE = `
const process = require('node:process');
const { Buffer } = require('node:buffer');
${DESCRIBE_SOURCE}
function facts(label, value) {
  if (label === 'two-views-one-buffer') {
    value.a[2] = 99;
    return { bAfterWriteToA: Array.from(value.b) };
  }
  if (label === 'view-and-its-buffer') {
    value.view[0] = 77;
    return { bufferAfterWriteToView: Array.from(new Uint8Array(value.buffer)) };
  }
  if (label === 'same-view-twice') return { identical: value.x === value.y };
  return null;
}
function childRefusals() {
  const out = [];
  const cases = [
    ['undefined', undefined],
    ['top-function', () => {}],
    ['top-symbol', Symbol('child')],
    ['top-bigint', 1n],
    ['nested-function', { fn() {} }],
    ['nested-symbol', { s: Symbol('x') }],
    ['proxy', { p: new Proxy({}, {}) }],
    ['promise', { p: Promise.resolve(1) }],
    ['weakmap', { w: new WeakMap() }],
    ['shared-array-buffer', { s: new SharedArrayBuffer(4) }],
  ];
  for (const [label, value] of cases) {
    try {
      out.push([label, 'sent:' + String(process.send(value))]);
    } catch (error) {
      out.push([label, errorShape(error)]);
    }
  }
  return out;
}
function childValues() {
  const sab = new SharedArrayBuffer(3);
  new Uint8Array(sab).set([7, 8, 9]);
  const backing = new ArrayBuffer(6);
  new Uint8Array(backing).set([1, 2, 3, 4, 5, 6]);
  const task = { id: 't', meta: Object.create(null), suite: undefined };
  task.file = task;
  return [
    ['buffer', Buffer.from('child')],
    ['nested-buffer', { data: Buffer.from([1, 2]), n: undefined }],
    ['uint8array', new Uint8Array([3, 4])],
    ['map-set-date', { m: new Map([['k', new Set([1])]]), d: new Date(86400000) }],
    ['error-cause', new RangeError('child-outer', { cause: new Error('child-inner') })],
    ['shared-view', new Uint8Array(sab)],
    ['two-views', { a: new Uint8Array(backing, 0, 4), b: new Uint8Array(backing, 2, 4) }],
    ['circular-task', task],
  ];
}
process.on('message', (message) => {
  if (message && message.command === 'child-refusals') {
    const refusals = childRefusals();
    process.send({ label: 'child-refusals', refusals });
    return;
  }
  if (message && message.command === 'child-values') {
    for (const [label, value] of childValues()) process.send({ label: 'child:' + label, value });
    process.send({ label: 'child-values-done' });
    return;
  }
  process.send({
    label: message.label,
    childSaw: describe(message.value),
    facts: facts(message.label, message.value),
    value: message.value,
  });
});
`;
