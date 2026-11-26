// What the core's streams show of EventEmitter: chain, store, errorMonitor, captureRejections,
// pipe's prepended error handler, the legacy Stream's eventNames, listenerCount(ev, fn), statics.
const { Readable, Writable, Stream } = require('node:stream');
const EE = require('node:events');
const out = (k, v) => console.log(`${k} => ${v}`);
const r = new Readable({ read() {} });
out('chain', `${Object.getPrototypeOf(Stream.prototype) === EE.prototype} ${r instanceof EE}`);
out('store', `${r._eventsCount} ${JSON.stringify(r.eventNames())}`);
const log = [];
r.on(EE.errorMonitor, () => log.push('monitor'));
r.on('error', () => log.push('error'));
r.emit('error', new Error('x'));
out('errorMonitor', log.join(','));
const dst = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});
const order = [];
dst.on('error', () => order.push('user'));
r.pipe(dst);
const handlers = dst.rawListeners('error');
out(
  'pipe prepends its error handler',
  `${handlers.length} ${handlers[1] === dst.listeners('error')[1]}`,
);
dst.on('unpipe', () => order.push('unpipe'));
dst.emit('error', new Error('x'));
out('pipe destination error', `${order.join(',')} ${r.listenerCount('data')}`);
try {
  out('legacy Stream eventNames', JSON.stringify(new Stream().eventNames()));
} catch (e) {
  out('legacy Stream eventNames', `threw ${e.message}`);
}
const f = () => {};
const w2 = new Writable({
  write(_c, _e, cb) {
    cb();
  },
});
w2.on('drain', f);
w2.on('drain', () => {});
out('listenerCount(ev, fn)', w2.listenerCount('drain', f));
out('statics on/getEventListeners', `${typeof EE.on} ${typeof EE.getEventListeners}`);
const w = new Writable({
  write(_c, _e, cb) {
    cb();
  },
  captureRejections: true,
});
w.on('error', (e) => out('captureRejections', `error event ${e.message}`));
process.on('unhandledRejection', (e) =>
  out('captureRejections', `unhandledRejection ${e.message}`),
);
w.on('foo', async () => {
  throw new Error('rejection');
});
w.emit('foo');
setTimeout(() => {}, 20);
