import type { ParityCase } from '../../src/types.ts';

// runtime-js/readable-pipe-never-ends-process-stdio: Node's pipe() never calls
// dest.end() when dest is process.stdout/stderr. vitest pipes pool-child
// stdout into process.stdout; rifty's pipe called dest.end() →
// "TypeError: dest.end is not a function" (evidence §I4/I2 programmatic run).
// Physical eval launches exercise the guest process stdio (the in-process
// runner would see the REAL Node stdout and pass trivially).
const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: 1,
  nodeCliEval: {
    sequential: [
      {
        label: 'pipe-into-process-stdout',
        nodeArgv: [
          '-e',
          "const { Readable } = require('node:stream'); const r = Readable.from(['a\\n']); r.pipe(process.stdout); r.on('end', () => console.log('after-pipe'));",
        ],
      },
    ],
  },
};

export default c;