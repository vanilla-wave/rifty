/**
 * `fork(..., { serialization: 'advanced' })` (ADR-0448): Node's v8-serializer
 * value table both ways, Buffer brand, view copies, refused-value errors and
 * the child's IPC hold. vitest 4.1.11's forks pool sends the
 * `vitest:*` frame shapes (evidence §vitest traffic).
 */
import type { ParityCase } from '../../src/types.ts';
import { DESCRIBE_SOURCE, ECHO_CHILD_SOURCE } from './advanced-ipc-program.ts';

const c: ParityCase = {
  kind: 'child-worker',
  expectedPhysicalWorkers: 1,
  cwd: '/project',
  setup: {
    files: {
      'project/echo.cjs': ECHO_CHILD_SOURCE,
    },
  },
  code: `
    const { fork } = require('node:child_process');
    const { Buffer } = require('node:buffer');
    const cwd = require('node:process').cwd();
    ${DESCRIBE_SOURCE}
    const rows = [];
    const row = (label, value) => rows.push(label + ' ' + JSON.stringify(value));
    const attempt = (run) => {
      try {
        return { returned: run() };
      } catch (error) {
        return errorShape(error);
      }
    };

    class Point { constructor() { this.x = 1; } get y() { return 2; } }
    class Mine extends Error { constructor(message) { super(message); this.name = 'Mine'; this.extra = 7; } }
    class Bytes extends Uint8Array {}

    function table() {
      const shared = { s: 1 };
      const circular = { a: 1 };
      circular.self = circular;
      const sparse = [1, , 3];
      const arrayExtra = [1, 2];
      arrayExtra.foo = 'bar';
      const nullProto = Object.create(null);
      nullProto.a = 1;
      const nonEnumerable = { visible: 1 };
      Object.defineProperty(nonEnumerable, 'hidden', { value: 2, enumerable: false });
      const ownProp = new Uint8Array([1, 2, 3]);
      ownProp.extra = 'x';
      const ownCtor = new Uint8Array([5]);
      Object.defineProperty(ownCtor, 'constructor', { value: Buffer });
      const backing = new ArrayBuffer(8);
      new Uint8Array(backing).set([1, 2, 3, 4, 5, 6, 7, 8]);
      const viewBacking = new ArrayBuffer(4);
      new Uint8Array(viewBacking).set([1, 2, 3, 4]);
      const once = new Uint8Array([4, 5, 6]);
      const sab = new SharedArrayBuffer(4);
      new Uint8Array(sab).set([1, 2, 3, 4]);
      const namedTypeError = new Error('m');
      namedTypeError.name = 'TypeError';
      const regexp = /a/g;
      regexp.lastIndex = 3;
      const fileTask = {
        id: '-1749414643',
        name: 'src/sum.test.ts',
        type: 'suite',
        mode: 'run',
        tasks: [],
        meta: Object.create(null),
        shuffle: undefined,
      };
      fileTask.file = fileTask;
      fileTask.tasks.push({
        id: '-1749414643_0',
        name: 'passes',
        suite: undefined,
        each: undefined,
        type: 'test',
        file: fileTask,
        timeout: 5000,
        retry: undefined,
        meta: Object.create(null),
        annotations: [],
      });
      return [
        ['string', 'hello'],
        ['number', 42],
        ['boolean', true],
        ['null', null],
        ['date', new Date(0)],
        ['invalid-date', new Date(NaN)],
        ['map', new Map([[1, 'a'], ['k', { n: 1 }]])],
        ['set', new Set([1, 'two', { three: 3 }])],
        ['regexp', regexp],
        ['nested-bigint', { b: 1n }],
        ['negative-zero', { z: -0 }],
        ['nan-infinity', [NaN, Infinity, -Infinity]],
        ['undefined-in-array', [undefined]],
        ['undefined-property', { u: undefined }],
        ['sparse-array', sparse],
        ['array-extra-property', arrayExtra],
        ['circular', circular],
        ['shared-reference', { a: shared, b: shared }],
        ['class-instance', new Point()],
        ['null-prototype', nullProto],
        ['non-enumerable', nonEnumerable],
        ['symbol-key', { a: 1, [Symbol('k')]: 2 }],
        ['boxed', [new Boolean(false), new Number(3), new String('s'), Object(2n)]],
        ['error', new Error('boom')],
        ['type-error', new TypeError('tt')],
        ['range-error', new RangeError('r')],
        ['error-subclass', new Mine('mine')],
        ['error-custom-name', Object.assign(new Error('n'), { name: 'Custom' })],
        ['error-own-name-type-error', namedTypeError],
        ['aggregate-error', new AggregateError([new Error('x')], 'agg')],
        ['error-cause', new Error('outer', { cause: new TypeError('inner') })],
        ['uint8array', new Uint8Array([1, 2, 3])],
        ['uint8array-own-property', ownProp],
        ['uint8array-subclass', new Bytes([1, 2])],
        ['float64array', new Float64Array([1.5, -2])],
        ['float16array', new Float16Array([1.5])],
        ['bigint64array', new BigInt64Array([1n, -1n])],
        ['dataview', new DataView(new ArrayBuffer(2))],
        ['arraybuffer', backing.slice(0)],
        ['subarray', new Uint8Array(16).fill(9).subarray(4, 6)],
        ['two-views-one-buffer', { a: new Uint8Array(backing, 0, 6), b: new Uint8Array(backing, 2, 6) }],
        ['view-and-its-buffer', { buffer: viewBacking, view: new Uint8Array(viewBacking, 0, 2) }],
        ['same-view-twice', { x: once, y: once }],
        ['map-with-view-key', new Map([[new Uint8Array([1]), 'v']])],
        ['buffer', Buffer.from('abc')],
        ['buffer-alloc', Buffer.alloc(3, 1)],
        ['nested-buffer', { b: Buffer.from([1, 2]) }],
        ['own-constructor-buffer', ownCtor],
        ['shared-array-buffer-view', new Uint8Array(sab)],
        ['vitest:start', {
          type: 'start',
          poolId: 1,
          workerId: 0,
          __vitest_worker_request__: true,
          options: { reportMemory: false },
          context: { environment: { name: 'node', options: null }, config: { mode: 'test', maxWorkers: undefined, setupFiles: [], defines: {} } },
        }],
        ['vitest:fetch-request', {
          m: 'fetch',
          a: ['/src/sum.ts', '/project/src/sum.test.ts', 'ssr', { cached: false, startOffset: undefined }, undefined],
          t: 'q',
          i: 'aPH8akppJ9-emVNoCVaab',
        }],
        ['vitest:reply', { t: 's', i: 'sR5A-QOT0zXmxWAI7nJfw', r: undefined }],
        ['vitest:collected', { m: 'onCollected', a: [[fileTask]], t: 'q', i: 'WN4686iK_l184MbUoa42k' }],
        ['vitest:finished', { type: 'testfileFinished', __vitest_worker_response__: true, error: undefined, usedMemory: undefined }],
      ];
    }

    function refusals() {
      function* generator() {}
      return [
        ['undefined', undefined],
        ['top-function', () => {}],
        ['top-symbol', Symbol('m')],
        ['top-bigint', 1n],
        ['nested-function', { fn() {} }],
        ['nested-arrow', { f: () => 1 }],
        ['nested-symbol', { s: Symbol('x') }],
        ['proxy', { p: new Proxy({}, {}) }],
        ['top-proxy', new Proxy({}, {})],
        ['promise', { p: Promise.resolve(1) }],
        ['weakmap', { w: new WeakMap() }],
        ['weakref', { w: new WeakRef({}) }],
        ['generator', { g: generator() }],
        ['intl', { i: new Intl.NumberFormat('en') }],
        ['shared-array-buffer', { s: new SharedArrayBuffer(4) }],
      ];
    }

    void (async () => {
      const child = fork('echo.cjs', [], { cwd, serialization: 'advanced', stdio: 'pipe' });
      const waiting = new Map();
      const childValues = [];
      let childValuesDone = () => {};
      child.on('message', (message) => {
        if (String(message.label).startsWith('child:')) {
          childValues.push([message.label, describe(message.value)]);
          return;
        }
        if (message.label === 'child-values-done') {
          childValuesDone();
          return;
        }
        const resolve = waiting.get(message.label);
        if (resolve === undefined) {
          row('unexpected', describe(message));
          return;
        }
        waiting.delete(message.label);
        resolve(message);
      });
      const reply = (label) => new Promise((resolve) => waiting.set(label, resolve));

      for (const [label, value] of table()) {
        const answer = reply(label);
        child.send({ label, value });
        const message = await answer;
        row('round-trip:' + label, {
          child: message.childSaw,
          facts: message.facts,
          back: describe(message.value),
        });
      }

      let getterCalls = 0;
      const getterAnswer = reply('getter');
      child.send({ label: 'getter', value: { get g() { getterCalls += 1; return 'got'; } } });
      row('getter', { child: (await getterAnswer).childSaw, calls: getterCalls });

      for (const [label, value] of refusals()) {
        row('refused:' + label, attempt(() => child.send(value)));
      }
      let before = 0;
      let after = 0;
      const ordered = {};
      Object.defineProperty(ordered, 'a', { enumerable: true, get() { before += 1; return 1; } });
      ordered.f = () => {};
      Object.defineProperty(ordered, 'z', { enumerable: true, get() { after += 1; return 1; } });
      row('refused-getter-order', { error: attempt(() => child.send(ordered)), before, after });
      row('refused-throwing-getter', attempt(() => child.send({ get boom() { throw new TypeError('getter-boom'); } })));
      const usable = reply('after-refusals');
      child.send({ label: 'after-refusals', value: { ok: true } });
      row('after-refusals', (await usable).childSaw);

      const childRefusals = reply('child-refusals');
      child.send({ command: 'child-refusals' });
      row('child-refusals', (await childRefusals).refusals);

      const childDone = new Promise((resolve) => {
        childValuesDone = resolve;
      });
      child.send({ command: 'child-values' });
      await childDone;
      for (const [label, value] of childValues) row(label, value);

      await new Promise((resolve) => setTimeout(resolve, 300));
      row('child-held-by-message-listener', { exitCode: child.exitCode, connected: child.connected });
      const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
      child.disconnect();
      row('exit-after-disconnect', await exited);

      console.log(rows.join('\\n'));
    })().catch((error) => {
      console.log('case-error:' + error.name + ':' + error.message);
    });
  `,
};

export default c;
