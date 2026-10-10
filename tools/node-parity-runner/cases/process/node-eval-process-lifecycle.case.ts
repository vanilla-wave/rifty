import type { ParityCase } from '../../src/types.ts';

// runtime-js/process-lifecycle-events-exit-code (goal I3): uncaughtException /
// unhandledRejection handlers receive the error and the process continues; the
// `exit` event fires with the final code; `process.exit()` honours exitCode.
// Physical eval launches exercise the guest process lifecycle (the in-process
// runner's real Node process cannot discriminate).
const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: 4,
  nodeCliEval: {
    sequential: [
      {
        label: 'uncaughtException-handler-continues',
        nodeArgv: [
          '-e',
          "process.on('uncaughtException', (e) => console.log('caught', e.message)); setTimeout(() => { throw new Error('boom'); }, 10); setTimeout(() => console.log('after'), 30);",
        ],
      },
      {
        label: 'unhandledRejection-handler-continues',
        nodeArgv: [
          '-e',
          "process.on('unhandledRejection', (r) => console.log('caughtR', r.message)); Promise.reject(new Error('rej')); setTimeout(() => console.log('after'), 30);",
        ],
      },
      {
        label: 'exit-event-natural',
        nodeArgv: [
          '-e',
          "process.on('exit', (code) => console.log('EXIT', code)); console.log('started');",
        ],
      },
      {
        label: 'exit-honours-exitCode',
        nodeArgv: ['-e', 'process.exitCode = 3; process.exit();'],
      },
    ],
  },
};

export default c;
