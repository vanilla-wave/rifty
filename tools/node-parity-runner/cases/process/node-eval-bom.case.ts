/**
 * Physical `node -e` launches (rifty: real kernel Worker, node-entry eval)
 * of the no-COI office experiment's BOM probes: fs utf8 read and Buffer
 * decode keep a leading BOM, and BOM bytes at stdout/stderr offset 0 reach
 * the parent verbatim (capture decoders keep the BOM on both sides).
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const cps =
  "const cps = (s) => s.length + ':' + [...s].map((c) => c.codePointAt(0).toString(16)).join(' ');";

const sequential: NodeCliEvalInvocation[] = [
  {
    label: 'stdio-offset-0',
    nodeArgv: [
      '-e',
      "process.stdout.write(Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a])); process.stderr.write('\\ufeffE\\n');",
    ],
  },
  {
    label: 'bom-fs',
    nodeArgv: ['-e', `${cps} console.log(cps(require('fs').readFileSync('bom.txt', 'utf8')));`],
  },
  {
    label: 'bom-buffer',
    nodeArgv: [
      '-e',
      `${cps} console.log(cps(Buffer.from([0xef, 0xbb, 0xbf, 0x41]).toString('utf8')), cps(new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))));`,
    ],
  },
];

export default {
  kind: 'node-cli-eval',
  setup: { files: { 'bom.txt': '\ufeffA' } },
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: sequential.length,
  nodeCliEval: { sequential },
} satisfies ParityCase;
