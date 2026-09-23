import type { ParityCase } from '../../src/types.ts';

const stdoutSource = `
  const { Readable } = require('node:stream');
  const output = require('node:process').stdout;
  Readable.from(['first|']).pipe(output, { end: true });
  setTimeout(() => output.write('second\\n'), 5);
`;

const stderrSource = `
  const { Readable } = require('node:stream');
  const output = require('node:process').stderr;
  Readable.from(['first|']).pipe(output, { end: true });
  setTimeout(() => output.write('second\\n'), 5);
`;

const ordinarySource = `
  const { Readable, Writable } = require('node:stream');
  const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  sink.fd = 1;
  sink.on('finish', () => process.stdout.write('lookalike-finished ' + sink.writableEnded + '\\n'));
  Readable.from(['x']).pipe(sink);
`;

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  expectedPhysicalWorkers: 3,
  nodeCliEval: {
    sequential: [
      { label: 'pipe-stdout', nodeArgv: ['-e', stdoutSource] },
      { label: 'pipe-stderr', nodeArgv: ['-e', stderrSource] },
      { label: 'pipe-fd-lookalike', nodeArgv: ['-e', ordinarySource] },
    ],
  },
};

export default c;
