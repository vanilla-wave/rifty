/**
 * The other half of Node's `endFn = doEnd ? onend : unpipe`: a pipe that does
 * not end its destination (`{end: false}`) unpipes it at source end — both
 * ends' pipe listeners are released and the destination stays open and
 * writable. Same branch the process-stdio exemption takes.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  expected: [
    'dest listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0',
    'dest ended false',
    'dest still writable: one,two',
  ].join('\n'),
  code: `
    const { Readable, Writable } = require('node:stream');
    const EVENTS = ['data', 'end', 'error', 'close', 'drain', 'finish', 'unpipe'];
    const counts = (s) => EVENTS.map((e) => s.listenerCount(e));
    const delta = (before, s) => counts(s).map((n, i) => n - before[i]).join(',');
    const seen = [];
    const w = new Writable({ write(c, _e, cb) { seen.push(String(c)); cb(); } });
    const before = counts(w);
    const src = Readable.from(['one']);
    src.pipe(w, { end: false });
    src.once('end', () => setImmediate(() => {
      console.log('dest listener delta ' + delta(before, w) +
        '; source data/end listeners ' + src.listenerCount('data') + '/' + src.listenerCount('end'));
      console.log('dest ended ' + w.writableEnded);
      w.write('two', () => { console.log('dest still writable: ' + seen.join(',')); });
    }));
  `,
};

export default c;
