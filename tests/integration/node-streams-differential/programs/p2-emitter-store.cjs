// The core reads Node's EventEmitter store, not only its methods: the stream constructors pre-shape
// `this._events` (readable.js:326, writable.js:394, duplex.js:68) and `Stream.prototype.eventNames`
// walks `this._events` (legacy.js:98); `prependListener`'s fallback writes it (legacy.js:118).
const { Readable, Writable, PassThrough } = require('node:stream');

const r = new Readable({ read() {} });
r.on('data', () => {});
r.on('foo', () => {});
console.log(
  `Readable eventNames, _events keys, _eventsCount => ${JSON.stringify(r.eventNames())} ${Object.keys(r._events ?? {}).join(',')} ${r._eventsCount}`,
);
const w = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});
w.on('finish', () => {});
w.prependListener('error', () => {});
console.log(
  `Writable eventNames, error listeners => ${JSON.stringify(w.eventNames())} ${w.listenerCount('error')}`,
);
const p = new PassThrough();
const d = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});
p.pipe(d);
console.log(
  `pipe destination: error listeners, eventNames => ${d.listenerCount('error')} ${JSON.stringify(d.eventNames())}`,
);
