// Intrinsics a guest replaces after the stream core loaded do not reach the core: Node's
// modules read `primordials` captured at bootstrap. Each row replaces a set of intrinsics with
// throwing (or foreign) ones, runs core work, restores them, and prints the result; a row whose
// replacement reaches Node's own live reads (`push`, `call`, …; `pop`/`shift` in its task queue)
// throws or ends the process in Node too. `--list`: the row names; `--only=<name>`: that row alone
// (the differential runs each row in its own process, so one row's crash hides no other).
const fs = require('node:fs');
const path = require('node:path');
const stream = require('node:stream');
const { pipeline } = require('node:stream/promises');

const file = path.join(__dirname, 'p1.txt');
fs.writeFileSync(file, 'hello intrinsics'); // the run's one written file
const e2s = (e) =>
  e ? `${e.code ? `${e.code}:` : ''}${String(e.message).split('\n')[0]}` : String(e);
const boom = (name) => () => {
  throw new Error(`replaced ${name} called`);
};
const { defineProperty, getOwnPropertyDescriptor } = Object;
const P = Promise;
/** Replaces `names` of `target` for `fn`'s run, then restores them (no replaced intrinsic used). */
async function replaced(target, names, make, fn) {
  const saved = [];
  for (let i = 0; i < names.length; i++) saved[i] = getOwnPropertyDescriptor(target, names[i]);
  for (let i = 0; i < names.length; i++)
    defineProperty(target, names[i], { value: make(names[i]), configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    for (let i = 0; i < names.length; i++) defineProperty(target, names[i], saved[i]);
  }
}
/** Core work: async generator stage, Transform, Writable, finished, operators, fs.ReadStream. */
async function work() {
  let out = '';
  await pipeline(
    stream.Readable.from(['a', 'b', 'c']),
    async function* (src) {
      for await (const c of src) yield String(c).toUpperCase();
    },
    new stream.Transform({
      transform(c, _e, cb) {
        cb(null, `${c}.`);
      },
    }),
    new stream.Writable({
      write(c, _e, cb) {
        out += String(c);
        cb();
      },
    }),
  );
  const mapped = await stream.Readable.from([1, 2, 3])
    .map((x) => x * 2)
    .reduce((a, x) => a + x, 0);
  let read = '';
  const rs = fs.createReadStream(file, { encoding: 'utf8', highWaterMark: 4 });
  for await (const c of rs) read += c;
  const fin = await new P((resolve) => {
    const r = new stream.PassThrough();
    stream.finished(r, (err) => resolve(err ? e2s(err) : 'ok'));
    r.end('x');
    r.resume();
  });
  return `${out} ${mapped} ${read} finished:${fin}`;
}
// Not `pop`: Node's own async-hooks context stack reads it live and the process dies outside the
// core (`popAsyncContext`), before any stream code.
const ARRAY = [
  'push',
  'shift',
  'unshift',
  'splice',
  'slice',
  'indexOf',
  'includes',
  'map',
  'filter',
  'join',
  'forEach',
  'concat',
];
const rows = [
  ['nothing replaced', () => work()],
  ...ARRAY.map((m) => [
    `Array.prototype.${m} throws`,
    () => replaced(Array.prototype, [m], boom, work),
  ]),
  [
    'Array.prototype[Symbol.iterator] throws',
    () => replaced(Array.prototype, [Symbol.iterator], () => boom('@@iterator'), work),
  ],
  ['Promise.prototype.then throws', () => replaced(Promise.prototype, ['then'], boom, work)],
  ['Promise.prototype.finally throws', () => replaced(Promise.prototype, ['finally'], boom, work)],
  // Not `apply`: Node's own uncaught-error path reads it live, so no exit handler runs after it.
  ...['call', 'bind'].map((m) => [
    `Function.prototype.${m} throws`,
    () => replaced(Function.prototype, [m], boom, work),
  ]),
  [
    'globalThis.Symbol is another function',
    () =>
      replaced(
        globalThis,
        ['Symbol'],
        () =>
          Object.assign(boom('Symbol'), {
            asyncIterator: 'x',
            iterator: 'y',
            for: boom('Symbol.for'),
          }),
        work,
      ),
  ],
  [
    'globalThis.Promise is another class',
    () =>
      replaced(
        globalThis,
        ['Promise'],
        () =>
          class FakePromise {
            constructor() {
              throw new Error('replaced Promise constructed');
            }
          },
        work,
      ),
  ],
  [
    'Object statics throw',
    () =>
      replaced(
        Object,
        ['defineProperty', 'keys', 'getPrototypeOf', 'setPrototypeOf', 'create'],
        boom,
        work,
      ),
  ],
  [
    'Reflect.apply and Reflect.construct throw',
    () => replaced(Reflect, ['apply', 'construct'], boom, work),
  ],
];
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
if (process.argv.includes('--list')) for (const [name] of rows) console.log(name);
else
  (async () => {
    for (const [name, fn] of rows) {
      if (only !== undefined && name !== only) continue;
      let v;
      try {
        v = await fn();
      } catch (e) {
        v = `threw ${e2s(e)}`;
      }
      console.log(`${name} => ${v}`);
    }
  })();
