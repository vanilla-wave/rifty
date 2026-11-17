import type { ParityCase } from '../../src/types.ts';

/**
 * With `off === removeListener`, a subclass overriding just one of the two
 * names only sees the calls made through that name. Node's internals detach
 * through `removeListener` (events.once, pipe/unpipe cleanup, readline close,
 * pipeline), never `off`: a `removeListener` override sees them, an `off`
 * override sees none. Per path, the events reaching each override, filtered to
 * listeners both runtimes attach.
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
      const seen = hits.removeListener.get(label) ?? new Set();
      return [label, common.filter((ev) => seen.has(ev)), [...(hits.off.get(label) ?? [])]];
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
      await new Promise((resolve) => setTimeout(resolve, 0));

      console.log(JSON.stringify([
        report('once', ['ready', 'error']),
        report('pipe.src', ['data', 'end']),
        report('pipe.dest', ['close', 'error']),
        report('readline.input', ['data', 'end']),
        report('pipeline.dest', ['error']),
        report('pipeline.src', []),
      ]));
    })();
  `,
  expected:
    '[["once",["ready","error"],[]],["pipe.src",["data","end"],[]],["pipe.dest",["close","error"],[]],["readline.input",["data","end"],[]],["pipeline.dest",["error"],[]],["pipeline.src",[],[]]]\n',
};

export default c;
