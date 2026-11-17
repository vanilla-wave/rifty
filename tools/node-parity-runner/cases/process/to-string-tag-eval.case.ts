/**
 * The `process-tag` measurement on the kernel-child host (a real node-entry
 * Worker; free global = the spec-seeded `NodeProcess`): `node -e` sees
 * `[object process]`, the own non-enumerable tag, and pdfjs-dist's `isNodeJS`.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const SOURCE =
  'const d=Object.getOwnPropertyDescriptor(process,Symbol.toStringTag);' +
  "console.log(String(process),Object.prototype.toString.call(process),process+'');" +
  'console.log(JSON.stringify(d),Object.prototype.propertyIsEnumerable.call(process,Symbol.toStringTag));' +
  "console.log(typeof process==='object'&&process+''==='[object process]'&&!process.versions.nw&&" +
  "!(process.versions.electron&&process.type&&process.type!=='browser'))";

const invocations: readonly NodeCliEvalInvocation[] = [
  { label: 'eval-brand', nodeArgv: ['-e', SOURCE] },
  { label: 'print-binding', nodeArgv: ['-p', "String(require('node:process'))"] },
];

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: invocations.length,
  nodeCliEval: { sequential: invocations },
};

export default c;
