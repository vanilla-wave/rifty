import type { ParityCase } from '../../src/types.ts';

/**
 * With `off === removeListener`, a subclass overriding just one of the two
 * names only sees the calls made through that name. Node's internals detach
 * through `removeListener` (events.once, pipe/unpipe cleanup, readline close,
 * pipeline, end-of-stream cleanup behind toWeb and the async iterator): a
 * `removeListener` override sees them, an `off` override does not. Per path,
 * the events reaching each override, filtered to listeners both runtimes
 * attach (Node's iterator alone detaches its `'readable'` through `off`).
 */
const c: ParityCase = {
  code: `
    const EventEmitter = require('node:events');
    const { Readable, Writable, PassThrough, pipeline } = require('node:stream');
    const readline = require('node:readline');

    const hits = { removeListener: new Map(), off: new Map() };
    const note = (kind, label, ev) => {
      const set = hits[kind].get(label) ?? new Set();
      set.add(String(ev));
      hits[kind].set(label, set);
    };
    const tracked = (Base, label) => class extends Base {
      removeListener(ev, fn) { note('removeListener', label, ev); return super.removeListener(ev, fn); }
      off(ev, fn) { note('off', label, ev); return super.off(ev, fn); }
    };
    const report = (label, common) => {
      const via = (kind) => common.filter((ev) => hits[kind].get(label)?.has(ev) === true);
      return [label, via('removeListener'), via('off')];
    };

    (async () => {
      const E = tracked(EventEmitter, 'once');
      const e = new E();
      const ready = EventEmitter.once(e, 'ready');
      e.emit('ready', 1);
      await ready;

      const r = new (tracked(Readable, 'pipe.src'))({ read() {} });
      const w = new (tracked(Writable, 'pipe.dest'))({ write(_c, _e, cb) { cb(); } });
      r.pipe(w);
      r.unpipe(w);

      const input = new (tracked(PassThrough, 'readline.input'))();
      readline.createInterface({ input, terminal: false }).close();

      const src = new (tracked(Readable, 'pipeline.src'))({ read() { this.push('x'); this.push(null); } });
      const dest = new (tracked(Writable, 'pipeline.dest'))({ write(_c, _e, cb) { cb(); } });
      await new Promise((resolve) => pipeline(src, dest, () => resolve()));

      const web = new (tracked(Readable, 'toWeb'))({ read() { this.push('a'); this.push(null); } });
      const reader = Readable.toWeb(web).getReader();
      while (!(await reader.read()).done);

      const slow = new (tracked(Writable, 'writable.toWeb'))({
        highWaterMark: 1,
        write(_c, _e, cb) { setImmediate(cb); },
      });
      const writer = Writable.toWeb(slow).getWriter();
      await writer.write('ab');
      await writer.write('cd');
      await writer.close();

      const kept = new (tracked(Readable, 'iterator'))({ read() { this.push('a'); } });
      for await (const _ of kept.iterator({ destroyOnReturn: false })) break;

      console.log(JSON.stringify([
        report('once', ['ready', 'error']),
        report('pipe.src', ['data', 'end']),
        report('pipe.dest', ['close', 'error']),
        report('readline.input', ['data', 'end']),
        report('pipeline.dest', ['error']),
        report('pipeline.src', ['data', 'end']),
        report('toWeb', ['end', 'error', 'close']),
        report('writable.toWeb', ['finish', 'error', 'close']),
        report('iterator', ['end', 'error']),
      ]));
    })();
  `,
  expected:
    '[["once",["ready","error"],[]],["pipe.src",["data","end"],[]],["pipe.dest",["close","error"],[]],["readline.input",["data","end"],[]],["pipeline.dest",["error"],[]],["pipeline.src",["data","end"],[]],["toWeb",["end","error","close"],[]],["writable.toWeb",["finish","error","close"],[]],["iterator",["end","error"],[]]]\n',
};

export default c;
