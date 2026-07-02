import type { ParityCase } from '../../src/types.ts';

/**
 * `stream.isReadable` / `isWritable` / `isErrored` / `isDisturbed` truth tables
 * vs real Node across: fresh, mid-stream, ended, destroyed, errored, and
 * non-stream inputs. The non-stream rows pin the EXACT Node return shape
 * (`isReadable`/`isWritable` → `null`; `isErrored`/`isDisturbed` → `false`) —
 * never a throw.
 */
const c: ParityCase = {
  code: `
    const s = require('node:stream');
    const { Readable, Writable } = s;
    const p = (label, v) => console.log(label + ':' + JSON.stringify(v));

    // Non-stream inputs — must not throw; Node's exact shape.
    for (const [name, x] of [['obj', {}], ['null', null], ['num', 42], ['str', 'x']]) {
      p('nonstream-' + name + '-isReadable', s.isReadable(x));
      p('nonstream-' + name + '-isWritable', s.isWritable(x));
      p('nonstream-' + name + '-isErrored', s.isErrored(x));
      p('nonstream-' + name + '-isDisturbed', s.isDisturbed(x));
    }

    (async () => {
      // Fresh readable.
      const fresh = new Readable({ read() {} });
      p('fresh-isReadable', s.isReadable(fresh));
      p('fresh-isDisturbed', s.isDisturbed(fresh));
      p('fresh-isErrored', s.isErrored(fresh));

      // Disturbed by an actual read.
      const read1 = new Readable({ read() {} });
      read1.push('x');
      read1.read();
      p('read-isDisturbed', s.isDisturbed(read1));

      // Fully consumed (ended) readable.
      const ended = Readable.from(['a'], { objectMode: true });
      for await (const _ of ended) { /* drain */ }
      p('ended-isReadable', s.isReadable(ended));
      p('ended-isDisturbed', s.isDisturbed(ended));

      // Destroyed readable (disturbed even without a read).
      const destroyed = new Readable({ read() {} });
      destroyed.destroy();
      await new Promise((r) => setTimeout(r, 5));
      p('destroyed-isReadable', s.isReadable(destroyed));
      p('destroyed-isDisturbed', s.isDisturbed(destroyed));

      // Errored readable.
      const errored = new Readable({ read() {} });
      errored.on('error', () => {});
      errored.destroy(new Error('boom'));
      await new Promise((r) => setTimeout(r, 5));
      p('errored-isErrored', s.isErrored(errored));
      p('errored-isReadable', s.isReadable(errored));

      // Writable: fresh / ended / destroyed.
      const w = new Writable({ write(_c, _e, cb) { cb(); } });
      p('w-fresh-isWritable', s.isWritable(w));
      w.end();
      await new Promise((r) => setTimeout(r, 5));
      p('w-ended-isWritable', s.isWritable(w));
      const w2 = new Writable({ write(_c, _e, cb) { cb(); } });
      w2.destroy();
      await new Promise((r) => setTimeout(r, 5));
      p('w2-destroyed-isWritable', s.isWritable(w2));
      p('w-isErrored-fresh', s.isErrored(w));
    })();
  `,
};

export default c;
