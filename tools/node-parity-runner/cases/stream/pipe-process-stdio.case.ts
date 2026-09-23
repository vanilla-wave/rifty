/**
 * `Readable.pipe(process.stdout|stderr)` never ends the process streams (Node's
 * `doEnd` rule, even with `{end: true}`); at source end the pipe releases its
 * listeners instead (`endFn = unpipe`). The exemption is identity with the
 * realm's own process streams: an fd-1 lookalike and a Writable behind a
 * reassigned `globalThis.process` still end. Seeded mode: rifty's
 * `require('node:process')` is its own process (default mode would reach the
 * host's real Node process — traps.md parity-runner-in-process).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  stdin: [],
  expected: [
    'a',
    'stdout still writable; listener delta 0,0,0,0,0,0,0; source data/end listeners 0/0',
    'stderr {end:true} not ended; listener delta 0,0,0,0,0,0,0',
    'fd-1 lookalike Writable finished',
    'Writable behind a reassigned globalThis.process finished',
  ].join('\n'),
  code: `
    const { Readable, Writable } = require('node:stream');
    const process = require('node:process');
    const EVENTS = ['data', 'end', 'error', 'close', 'drain', 'finish', 'unpipe'];
    const counts = (s) => EVENTS.map((e) => s.listenerCount(e));
    const delta = (before, s) => counts(s).map((n, i) => n - before[i]).join(',');
    const sink = () => new Writable({ write(_c, _e, cb) { cb(); } });

    function toStdout(next) {
      const before = counts(process.stdout);
      const src = Readable.from(['a\\n']);
      src.pipe(process.stdout);
      src.once('end', () => setImmediate(() => {
        process.stdout.write('stdout still writable; listener delta ' + delta(before, process.stdout) +
          '; source data/end listeners ' + src.listenerCount('data') + '/' + src.listenerCount('end') + '\\n');
        next();
      }));
    }
    function toStderrEndTrue(next) {
      const before = counts(process.stderr);
      const src = Readable.from(['b\\n']);
      src.pipe(process.stderr, { end: true });
      src.once('end', () => setImmediate(() => {
        process.stderr.write('stderr still writable\\n');
        process.stdout.write('stderr {end:true} not ended; listener delta ' + delta(before, process.stderr) + '\\n');
        next();
      }));
    }
    function lookalike(next) {
      const w = sink();
      w.fd = 1;
      w._isStdio = true;
      w.on('finish', () => { console.log('fd-1 lookalike Writable finished'); next(); });
      Readable.from(['x']).pipe(w);
    }
    function forgedGlobal(next) {
      const w = sink();
      w.on('finish', () => { console.log('Writable behind a reassigned globalThis.process finished'); next(); });
      const real = globalThis.process;
      globalThis.process = { stdout: w, stderr: w };
      Readable.from(['y']).pipe(w);
      globalThis.process = real;
    }
    toStdout(() => toStderrEndTrue(() => lookalike(() => forgedGlobal(() => process.stdin.resume()))));
  `,
};

export default c;
