/**
 * Who calls `end()` on the process streams: `Readable.pipe` never does (Node's
 * `doEnd` exemption); `pipeline(src, process.stdout|stderr)` still does (Node's
 * pipeline pipes with `{end: false}` and ends the last stage itself). A
 * non-ending `end` spy is installed as an own property on both runtimes, so the
 * count is observed without ending either stream. Seeded mode — see
 * pipe-process-stdio.case.ts.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  stdin: [],
  expected: [
    'stdout-pipe',
    'Readable.pipe(process.stdout) end calls: 0',
    'Readable.pipe(process.stderr) end calls: 0',
    'stdout-pipeline',
    'pipeline(src, process.stdout) end calls: 1',
    'pipeline(src, process.stderr) end calls: 1',
  ].join('\n'),
  code: `
    const { Readable, pipeline } = require('node:stream');
    const process = require('node:process');
    const calls = { stdout: 0, stderr: 0 };
    for (const name of ['stdout', 'stderr']) {
      process[name].end = function () { calls[name] += 1; return this; };
    }
    function viaPipe(name, next) {
      const src = Readable.from([name + '-pipe\\n']);
      src.pipe(process[name]);
      src.once('end', () => setImmediate(() => {
        console.log('Readable.pipe(process.' + name + ') end calls: ' + calls[name]);
        next();
      }));
    }
    function viaPipeline(name, next) {
      const before = calls[name];
      const src = Readable.from([name + '-pipeline\\n']);
      pipeline(src, process[name], () => {});
      src.once('end', () => setImmediate(() => {
        console.log('pipeline(src, process.' + name + ') end calls: ' + (calls[name] - before));
        next();
      }));
    }
    viaPipe('stdout', () => viaPipe('stderr', () =>
      viaPipeline('stdout', () => viaPipeline('stderr', () => process.stdin.resume()))));
  `,
};

export default c;
