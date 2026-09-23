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

const missingEndSource = `
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const sink = new EventEmitter();
  sink.fd = 1;
  sink.write = () => true;
  const source = new Readable({ read() {} });
  source.pipe(sink);
  try {
    source.emit('end');
    process.stdout.write('missing-end-no-throw\\n');
  } catch (error) {
    process.stdout.write(error.name + ': ' + error.message + '\\n');
  }
`;

const forgedGlobalSource = (stream: 'stdout' | 'stderr') => `
  const { Readable } = require('node:stream');
  const { EventEmitter } = require('node:events');
  const real = require('node:process');
  const foreign = new EventEmitter();
  foreign.write = () => true;
  const original = globalThis.process;
  globalThis.process = { ${stream}: foreign };
  const source = new Readable({ read() {} });
  source.pipe(foreign);
  let outcome;
  try {
    source.emit('end');
    outcome = 'no-throw';
  } catch (error) {
    outcome = error.name + ': ' + error.message;
  }
  globalThis.process = original;
  real.stdout.write('forged-${stream}=' + outcome + '\\n');
`;

const genuineUnderForgedGlobalSource = (stream: 'stdout' | 'stderr') => `
  const { Readable } = require('node:stream');
  const real = require('node:process');
  const output = real.${stream};
  const original = globalThis.process;
  globalThis.process = { ${stream}: { write: () => true } };
  Readable.from(['first|']).pipe(output, { end: true });
  setTimeout(() => {
    globalThis.process = original;
    output.write('second\\n');
  }, 5);
`;

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  expectedPhysicalWorkers: 8,
  nodeCliEval: {
    sequential: [
      { label: 'pipe-stdout', nodeArgv: ['-e', stdoutSource] },
      { label: 'pipe-stderr', nodeArgv: ['-e', stderrSource] },
      { label: 'pipe-fd-lookalike', nodeArgv: ['-e', ordinarySource] },
      { label: 'pipe-missing-end-lookalike', nodeArgv: ['-e', missingEndSource] },
      { label: 'pipe-forged-global-stdout', nodeArgv: ['-e', forgedGlobalSource('stdout')] },
      { label: 'pipe-forged-global-stderr', nodeArgv: ['-e', forgedGlobalSource('stderr')] },
      {
        label: 'pipe-real-stdout-under-forged-global',
        nodeArgv: ['-e', genuineUnderForgedGlobalSource('stdout')],
      },
      {
        label: 'pipe-real-stderr-under-forged-global',
        nodeArgv: ['-e', genuineUnderForgedGlobalSource('stderr')],
      },
    ],
  },
};

export default c;
