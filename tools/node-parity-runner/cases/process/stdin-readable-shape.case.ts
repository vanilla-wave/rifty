import type { ParityCase } from '../../src/types.ts';

/**
 * `process.stdin` is a Readable even when nobody consumes it. Supervisors such
 * as nodemon rely on the passive `unpipe(child.stdin)` cleanup path with
 * `--no-stdin`; a Readable-ish EventEmitter fails before the app can start.
 */
const c: ParityCase = {
  expected: 'readable:true\nunpipe:function\ncleanup:true\npause:true\npaused:true',
  code: `
    const process = require('node:process');
    const { Readable, Writable } = require('node:stream');
    const childStdin = new Writable({ write(_chunk, _encoding, cb) { cb(); } });
    console.log('readable:' + (process.stdin instanceof Readable));
    console.log('unpipe:' + typeof process.stdin.unpipe);
    console.log('cleanup:' + (process.stdin.unpipe(childStdin) === process.stdin));
    console.log('pause:' + (process.stdin.pause() === process.stdin));
    const paused = process.stdin.isPaused();
    process.stdin.resume();
    console.log('paused:' + paused);
  `,
};

export default c;
