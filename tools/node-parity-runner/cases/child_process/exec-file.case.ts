import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  cwd: '/project',
  setup: {
    files: {
      'project/show.js': `
        process.stdout.write(JSON.stringify({
          argv: process.argv.slice(2),
          cwd: process.cwd().endsWith('/project'),
          marker: process.env.MARKER,
        }));
        process.stderr.write('warn');
      `,
      'project/fail.js': `
        process.stdout.write('before');
        process.stderr.write('failure');
        process.exit(3);
      `,
      'project/overflow.js': `process.stdout.write('abcdef');`,
      'project/slow.js': `setTimeout(() => process.stdout.write('late'), 1000);`,
    },
  },
  code: `
    import childProcess, { execFile } from 'node:child_process';
    import * as childProcessNamespace from 'node:child_process';
    import { Buffer } from 'node:buffer';
    import nodeProcess from 'node:process';
    import { promisify } from 'node:util';
    const executable = nodeProcess.versions.rifty ? 'node' : nodeProcess.execPath;

    const descriptor = Object.getOwnPropertyDescriptor(
      childProcess,
      'execFile',
    );
    const custom = promisify.custom;
    const customDescriptor = Object.getOwnPropertyDescriptor(execFile, custom);
    console.log('surface',
      execFile.length,
      descriptor?.enumerable,
      descriptor?.configurable,
      descriptor?.writable,
      childProcessNamespace.execFile === execFile,
      childProcessNamespace.default === childProcess,
      custom === Symbol.for('nodejs.util.promisify.custom'),
      promisify(execFile) === execFile[custom],
      customDescriptor?.enumerable,
      customDescriptor?.configurable,
      customDescriptor?.writable,
    );

    const call = (...args) => new Promise((resolve) => {
      execFile(...args, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });

    void (async () => {
      const success = await call(
        executable,
        ['show.js', 'two words', '$literal'],
        { cwd: nodeProcess.cwd(), env: { ...nodeProcess.env, MARKER: 'kept' } },
      );
      console.log('callback',
        success.error,
        success.stdout,
        success.stderr,
      );

      const failed = await call(executable, ['fail.js'], { cwd: nodeProcess.cwd() });
      console.log('error',
        failed.error?.name,
        failed.error?.code,
        failed.error?.killed,
        failed.error?.signal,
        failed.stdout,
        failed.stderr,
      );

      const overflow = await call(
        executable,
        ['overflow.js'],
        { cwd: nodeProcess.cwd(), maxBuffer: 3 },
      );
      console.log('maxBuffer',
        overflow.error?.name,
        overflow.error?.code,
        overflow.stdout,
        overflow.stderr,
      );

      const nullBuffer = await call(
        executable,
        ['overflow.js'],
        { cwd: nodeProcess.cwd(), maxBuffer: null },
      );
      console.log('null-maxBuffer',
        nullBuffer.error?.name,
        nullBuffer.error?.code,
        nullBuffer.stdout,
        nullBuffer.stderr,
      );

      const timedOut = await call(
        executable,
        ['slow.js'],
        { cwd: nodeProcess.cwd(), timeout: 10 },
      );
      console.log('timeout',
        timedOut.error?.name,
        timedOut.error?.code,
        timedOut.error?.killed,
        timedOut.error?.signal,
        timedOut.stdout,
        timedOut.stderr,
      );

      const lowerSignal = await call(
        executable,
        ['slow.js'],
        { cwd: nodeProcess.cwd(), timeout: 10, killSignal: 'sigterm' },
      );
      const numericSignal = await call(
        executable,
        ['slow.js'],
        { cwd: nodeProcess.cwd(), timeout: 10, killSignal: 15 },
      );
      console.log('killSignal-aliases',
        lowerSignal.error?.signal,
        numericSignal.error?.signal,
      );

      const promised = await promisify(execFile)(
        executable,
        ['show.js'],
        { cwd: nodeProcess.cwd(), encoding: 'buffer' },
      );
      console.log('promisify',
        Object.keys(promised).join(','),
        Buffer.isBuffer(promised.stdout),
        promised.stdout.toString(),
        Buffer.isBuffer(promised.stderr),
        promised.stderr.toString(),
      );

      try {
        await promisify(execFile)(executable, ['fail.js'], { cwd: nodeProcess.cwd() });
      } catch (error) {
        console.log('promisify-error',
          error.code,
          error.stdout,
          error.stderr,
          Object.keys(error).includes('stdout'),
          Object.keys(error).includes('stderr'),
        );
      }
    })().catch((error) => {
      console.log('case-error', error?.name, error?.code, error?.message);
    });
  `,
  expected: [
    'surface 4 true true true true true true true false false false',
    'callback null {"argv":["two words","$literal"],"cwd":true,"marker":"kept"} warn',
    'error Error 3 false null before failure',
    'maxBuffer RangeError ERR_CHILD_PROCESS_STDIO_MAXBUFFER abc ',
    'null-maxBuffer RangeError ERR_CHILD_PROCESS_STDIO_MAXBUFFER  ',
    'timeout Error null true SIGTERM  ',
    'killSignal-aliases SIGTERM SIGTERM',
    'promisify stdout,stderr true {"argv":[],"cwd":true} true warn',
    'promisify-error 3 before failure true true',
  ].join('\n'),
};

export default c;
