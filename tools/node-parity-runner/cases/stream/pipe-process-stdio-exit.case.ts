/**
 * Physical-process carrier for the `Readable.pipe(process.stdout|stderr)`
 * exemption: a real `node -e` launch (rifty: kernel Worker with the installed
 * realm process, the path vitest's pool pipes run on) pipes a finished Readable
 * into the process stream, writes to it afterwards and exits 0 — stdout,
 * stderr and exit status compared.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

function pipeThenWrite(stream: 'stdout' | 'stderr'): NodeCliEvalInvocation {
  return {
    label: `pipe-${stream}`,
    nodeArgv: [
      '-e',
      [
        "const { Readable } = require('node:stream');",
        `const src = Readable.from(['piped to ${stream}\\n']);`,
        `src.pipe(process.${stream});`,
        `src.once('end', () => setImmediate(() => process.${stream}.write('${stream} still writable\\n')));`,
      ].join(' '),
    ],
  };
}

const sequential = [pipeThenWrite('stdout'), pipeThenWrite('stderr')];

export default {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: sequential.length,
  nodeCliEval: { sequential },
} satisfies ParityCase;
