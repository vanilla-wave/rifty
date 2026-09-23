/**
 * ADR-0445 rule 1: a `node -e` / `-p` source throw reaches `uncaughtException`
 * like a program entry throw — handled, the loop continues (no `-p` result);
 * unhandled, `'exit'` 1 then the eval diagnostic and status 1.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const OUT = "const out=s=>process.stdout.write(s+'\\n');";
const EXIT_ROW = "process.on('exit',c=>out('exit '+c+' '+process.exitCode));";
const CAUGHT_ROW =
  "process.on('uncaughtException',(e,o)=>out('caught '+String(e&&e.message||e)+' '+o));";

const invocations: readonly NodeCliEvalInvocation[] = [
  {
    label: 'entry-throw-handler',
    nodeArgv: [
      '-e',
      `${OUT}${EXIT_ROW}${CAUGHT_ROW}setTimeout(()=>out('after'),20);throw new Error('ev')`,
    ],
  },
  {
    label: 'print-entry-throw-handler',
    nodeArgv: ['-p', `${OUT}${EXIT_ROW}${CAUGHT_ROW}throw 1`],
  },
  {
    label: 'entry-throw-fatal',
    nodeArgv: ['-e', `${OUT}${EXIT_ROW}throw new Error('FATAL-EVAL-ENTRY')`],
    evalErrorStderr: true,
  },
];

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: invocations.length,
  nodeCliEval: { sequential: invocations },
};

export default c;
