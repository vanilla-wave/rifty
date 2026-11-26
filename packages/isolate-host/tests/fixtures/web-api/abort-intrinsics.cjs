// Isolate guest EventTarget/AbortController (ADR-0579) after guest code replaced the intrinsics
// Node's sources reach through `primordials`: each replacement throws, the classes still behave as
// Node's. Run unchanged by `node` and the guest; one line per observation (`id<TAB>outcome`).
'use strict';
const apply = Reflect.apply;
const defineProperty = Reflect.defineProperty;
const getOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const lines = [];
const push = Array.prototype.push;
const out = (id, v) => apply(push, lines, [`${id}\t${v}`]);
const SetIteratorPrototype = Object.getPrototypeOf(new Set().values());
const MapIteratorPrototype = Object.getPrototypeOf(new Map().values());
const ArrayIteratorPrototype = Object.getPrototypeOf([].values());
const TARGETS = [
  [Array.prototype, ['push', 'forEach', 'reduce', 'map', 'join', Symbol.iterator]],
  [ArrayIteratorPrototype, ['next']],
  [Function.prototype, ['call', 'apply', 'bind']],
  [Promise.prototype, ['then', 'catch', 'finally']],
  [Promise, ['resolve', 'reject', 'withResolvers']],
  [Map.prototype, ['get', 'set', 'has', 'delete', 'clear', 'keys', 'values', Symbol.iterator]],
  [MapIteratorPrototype, ['next']],
  [Set.prototype, ['add', 'has', 'delete', 'forEach', 'values', Symbol.iterator]],
  [SetIteratorPrototype, ['next']],
  [WeakMap.prototype, ['get', 'set', 'has', 'delete']],
  [WeakSet.prototype, ['add', 'has', 'delete']],
  [WeakRef.prototype, ['deref']],
  [FinalizationRegistry.prototype, ['register', 'unregister']],
  [Object, ['assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']],
  [Reflect, ['apply']],
];
const saved = [];
/** `skip`: replacements Node's own sources are not proof against (its `then` lookup on a listener's
 * result, `for…of` in `ERR_INVALID_ARG_TYPE`'s message), kept for the rows that reach them. */
function poison(skip = []) {
  for (let i = 0; i < TARGETS.length; i++) {
    const o = TARGETS[i][0];
    const keys = TARGETS[i][1];
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      if (
        skip.indexOf(k) !== -1 &&
        (o === Promise.prototype || o === Array.prototype || o === ArrayIteratorPrototype)
      )
        continue;
      apply(push, saved, [[o, k, getOwnPropertyDescriptor(o, k)]]);
      defineProperty(o, k, {
        configurable: true,
        writable: true,
        value() {
          throw new Error(`poisoned ${String(k)}`);
        },
      });
    }
  }
}
function restore() {
  for (let i = saved.length - 1; i >= 0; i--) defineProperty(saved[i][0], saved[i][1], saved[i][2]);
  saved.length = 0;
}
const thrown = (e) => `throw ${e?.name}${e?.code ? ` [${e.code}]` : ''}: ${e?.message}`;
const pin = (id, fn) => {
  let v;
  try {
    v = String(fn());
  } catch (e) {
    v = thrown(e);
  }
  out(id, v);
};

const log = [];
const note = (s) => apply(push, log, [s]);
poison(['then']);
pin('EventTarget add/dispatch/remove', () => {
  const t = new EventTarget();
  const fn = (e) => note(`fn ${e.type}`);
  t.addEventListener('x', fn);
  t.addEventListener('x', fn, { once: true, passive: true, capture: true });
  t.addEventListener('x', { handleEvent: () => note('obj') });
  t.dispatchEvent(new Event('x'));
  t.removeEventListener('x', fn);
  t.dispatchEvent(new CustomEvent('x', { detail: 1 }));
  return log.length;
});
pin('AbortController abort with listeners', () => {
  const ac = new AbortController();
  ac.signal.addEventListener('abort', () => note('abort listener'));
  ac.signal.onabort = () => note('onabort');
  ac.abort('R');
  return `${ac.signal.aborted} ${ac.signal.reason}`;
});
pin('AbortSignal.any', () => {
  const a = new AbortController();
  const s = AbortSignal.any([a.signal, new AbortController().signal]);
  s.addEventListener('abort', () => note('any listener'));
  a.abort('A');
  return `${s.aborted} ${s.reason} ${AbortSignal.any([s]).reason}`;
});
pin('AbortSignal.abort().reason', () => AbortSignal.abort().reason.name);
pin('listener signal option', () => {
  const t = new EventTarget();
  const ac = new AbortController();
  let n = 0;
  t.addEventListener('x', () => n++, { signal: ac.signal });
  ac.abort();
  t.dispatchEvent(new Event('x'));
  return n;
});
restore();
poison([Symbol.iterator, 'next']);
pin('errors', () => {
  const r = [];
  const fs = [
    () => new AbortSignal(),
    () => new Event(),
    () => new EventTarget().dispatchEvent({}),
  ];
  for (let i = 0; i < fs.length; i++)
    try {
      fs[i]();
    } catch (e) {
      apply(push, r, [e.code]);
    }
  return `${r[0]} ${r[1]} ${r[2]}`;
});
restore();
out('log', log.join(','));
for (const l of lines) process.stdout.write(`${l}\n`);
