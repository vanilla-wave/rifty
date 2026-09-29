/**
 * ADR-0445 / I3: `node -e` / `-p` eval children honour the same `exit()` /
 * `exitCode` / `'exit'` contract as program children, including the print
 * before the natural `'exit'` and an `exit()` scheduled inside `'exit'`.
 */
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

const EXIT_ROW =
  "process.on('exit',c=>process.stdout.write('exit '+c+' '+process.exitCode+'\\n'));";

function evalRow(label: string, source: string, option: '-e' | '-p' = '-e'): NodeCliEvalInvocation {
  return { label, nodeArgv: [option, `${EXIT_ROW}${source}`] };
}

const invocations: readonly NodeCliEvalInvocation[] = [
  evalRow('natural', "process.stdout.write('body '+typeof process.exitCode+'\\n')"),
  evalRow('exit-no-arg', 'process.exitCode=3;process.exit()'),
  evalRow('exit-startup-error', 'if(process.exitCode==null)process.exitCode=1;process.exit()'),
  evalRow('exit-undefined-arg', 'process.exitCode=3;process.exit(undefined)'),
  evalRow('exit-reentrant', "process.on('exit',()=>process.exit(2));process.exit(1)"),
  evalRow(
    'exit-listener-reassign',
    "process.on('exit',()=>{process.exitCode=5});setTimeout(()=>process.stdout.write('late\\n'),5)",
  ),
  evalRow(
    'exit-listener-timer',
    "process.on('exit',()=>setTimeout(()=>{process.stdout.write('timer-in-exit\\n');process.exit(9)},0))",
  ),
  evalRow('print-before-exit', "setTimeout(()=>process.stdout.write('timer\\n'),5);42", '-p'),
  evalRow(
    'nexttick-handler',
    "process.on('uncaughtException',(e,o)=>process.stdout.write('caught '+e.message+' '+o+'\\n'));process.nextTick(()=>{throw new Error('tick')});setTimeout(()=>process.stdout.write('after\\n'),20)",
  ),
];

const c: ParityCase = {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  expectedPhysicalWorkers: invocations.length,
  nodeCliEval: { sequential: invocations },
};

export default c;
