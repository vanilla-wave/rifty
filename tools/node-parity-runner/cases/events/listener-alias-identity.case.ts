import type { ParityCase } from '../../src/types.ts';

/**
 * Node's events.js assigns `on = addListener` and `off = removeListener`: one
 * function object per pair, on EventEmitter.prototype and everything inheriting
 * it. readable-stream (v2-v4) relies on that: `Readable.prototype.on` calls
 * `Stream.prototype.on.call(this, …)` and then `addListener = on`. A base `on`
 * that forwards through `this.addListener` re-enters the override forever.
 */
const c: ParityCase = {
  code: `
    const EventEmitter = require('node:events');
    const { Stream, Readable, Writable, Duplex, Transform, PassThrough } = require('node:stream');
    const p = EventEmitter.prototype;
    const pairs = (o) => [o.on === o.addListener, o.off === o.removeListener];
    console.log(JSON.stringify({
      ee: pairs(p),
      names: [p.on.name, p.off.name],
      lengths: [p.on.length, p.off.length],
      classes: [Stream, Readable, Writable, Duplex, Transform, PassThrough].map((C) => [C.name, ...pairs(C.prototype)]),
      instances: [
        new EventEmitter(),
        new Readable({ read() {} }),
        new Writable({ write(_c, _e, cb) { cb(); } }),
        new PassThrough(),
      ].map(pairs),
    }));

    const run = (label, body) => {
      const seen = [];
      try {
        body(seen);
        console.log(label, JSON.stringify(seen));
      } catch (e) {
        console.log(label, 'threw', e.name, e.message);
      }
    };

    // readable-stream's shape: override one name, alias the other to it, reach
    // the base through the parent prototype.
    run('override-on', (seen) => {
      function Legacy() { Stream.call(this); }
      Object.setPrototypeOf(Legacy.prototype, Stream.prototype);
      Legacy.prototype.on = function (ev, fn) {
        const res = Stream.prototype.on.call(this, ev, fn);
        seen.push('on:' + ev);
        return res;
      };
      Legacy.prototype.addListener = Legacy.prototype.on;
      Legacy.prototype.removeListener = function (ev, fn) {
        const res = Stream.prototype.removeListener.call(this, ev, fn);
        seen.push('removeListener:' + ev);
        return res;
      };
      Legacy.prototype.off = Legacy.prototype.removeListener;
      const s = new Legacy();
      const h = (v) => seen.push('data:' + v);
      s.on('data', h);
      s.addListener('data', h);
      s.once('end', () => seen.push('end'));
      s.emit('data', 1);
      s.off('data', h);
      s.removeListener('data', h);
      s.emit('data', 2);
      s.emit('end');
      seen.push('count:' + s.listenerCount('data') + ',' + s.listenerCount('end'));
    });

    // The mirror image: the override reaches the base through the other names.
    run('override-addListener', (seen) => {
      class Tracked extends EventEmitter {}
      Tracked.prototype.addListener = function (ev, fn) {
        seen.push('add:' + ev);
        return EventEmitter.prototype.on.call(this, ev, fn);
      };
      Tracked.prototype.on = Tracked.prototype.addListener;
      Tracked.prototype.removeListener = function (ev, fn) {
        seen.push('remove:' + ev);
        return EventEmitter.prototype.off.call(this, ev, fn);
      };
      Tracked.prototype.off = Tracked.prototype.removeListener;
      const t = new Tracked();
      const g = () => seen.push('fired');
      t.on('x', g);
      t.prependListener('x', g);
      t.emit('x');
      t.off('x', g);
      t.removeListener('x', g);
      t.emit('x');
      seen.push('count:' + t.listenerCount('x'));
    });

    // \`once\`/\`prependOnceListener\` register through \`this.on\`/\`this.prependListener\`
    // but return the emitter itself.
    run('once-return', (seen) => {
      class Quiet extends EventEmitter {
        on(ev, fn) { super.on(ev, fn); }
        prependListener(ev, fn) { super.prependListener(ev, fn); }
      }
      const q = new Quiet();
      seen.push(q.once('z', () => {}) === q, q.prependOnceListener('z', () => {}) === q);
    });
  `,
  expected:
    '{"ee":[true,true],"names":["addListener","removeListener"],"lengths":[2,2],"classes":[["Stream",true,true],["Readable",true,true],["Writable",true,true],["Duplex",true,true],["Transform",true,true],["PassThrough",true,true]],"instances":[[true,true],[true,true],[true,true],[true,true]]}\n' +
    'override-on ["on:data","on:data","on:end","data:1","data:1","removeListener:data","removeListener:data","removeListener:end","end","count:0,0"]\n' +
    'override-addListener ["add:x","fired","fired","remove:x","remove:x","count:0"]\n' +
    'once-return [true,true]\n',
};

export default c;
