import type { ParityCase } from '../../src/types.ts';

// runtime-js/absent-builtin-members-loud-throws: vitest pool-worker init does
// `process.memoryUsage.bind(process)`. Physical eval launches exercise the
// spec-seeded guest process (the in-process runner would see the REAL Node
// process and pass trivially).
const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: 1,
  nodeCliEval: {
    sequential: [
      {
        label: 'memory-usage-member-bind',
        nodeArgv: [
          '-e',
          'const bound = process.memoryUsage.bind(process); console.log(typeof process.memoryUsage, typeof bound);',
        ],
      },
    ],
  },
};

export default c;
