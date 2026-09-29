/**
 * ADR-0446: a lifecycle owner's natural exit is Node's own — `'exit'` once with
 * `exitCode ?? 0` — and never the user-reassignable `process.exit` property
 * (vitest's pool workers replace it with a throwing function). Physical
 * `node -e` launch: rifty runs the Workbench node-entry eval lifecycle in a
 * kernel Worker. Node v24.16.0: `tick`, `exit-event 0`, empty stderr, status 0.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const sequential: readonly NodeCliEvalInvocation[] = [
  {
    label: 'patched-exit',
    nodeArgv: [
      '-e',
      [
        "process.on('exit', (code) => console.log('exit-event', code));",
        "process.exit = () => { throw new Error('patched process.exit called'); };",
        "setTimeout(() => console.log('tick'), 20);",
      ].join(' '),
    ],
  },
  {
    label: 'patched-exit-code',
    nodeArgv: [
      '-e',
      [
        "process.on('exit', (code) => console.log('exit-event', code));",
        'process.exitCode = 4;',
        "process.exit = () => { throw new Error('patched process.exit called'); };",
      ].join(' '),
    ],
  },
];

export default {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: sequential.length,
  nodeCliEval: { sequential },
} satisfies ParityCase;
