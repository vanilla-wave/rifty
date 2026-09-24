/**
 * ADR-0445 rule 5: `node -p` with an explicit `exit()` — Node prints the `-p`
 * result after the user `'exit'` listeners (a timer's `exit(3)`); an `exit()`
 * during the source prints nothing. Status is the `exit()` code.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const EXIT_ROW = "process.on('exit',c=>process.stdout.write('EXIT '+c+'\\n'));";

const invocations: readonly NodeCliEvalInvocation[] = [
  { label: 'timer-exit', nodeArgv: ['-p', `${EXIT_ROW}setTimeout(()=>process.exit(3),5);42`] },
  { label: 'sync-exit', nodeArgv: ['-p', `${EXIT_ROW}process.exit(4);42`] },
];

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: invocations.length,
  nodeCliEval: { sequential: invocations },
};

export default c;
