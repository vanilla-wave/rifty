import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

// ADR-0445: Node process lifecycle programs. Each case runs verbatim in real
// Node (live oracle) and as the same rifty shell line; `L|` rows + status compare.

export interface ProcessLifecycleCase {
  readonly name: string;
  /** Project-relative files, written to the oracle temp dir and to `/scratch`. */
  readonly files: Readonly<Record<string, string>>;
  /** Oracle argv after the Node executable. */
  readonly nodeArgv: readonly string[];
  /** Rifty shell line; defaults to `node <nodeArgv[0]>`. */
  readonly line?: string;
  /** Marker a fatal case prints loudly (Node stderr; rifty terminal output). */
  readonly fatal?: string;
}

const EXIT_ROW = "process.on('exit', (c) => console.log('L|exit', c, process.exitCode));";

function program(
  name: string,
  source: string,
  extra: Partial<ProcessLifecycleCase> = {},
): ProcessLifecycleCase {
  const file = `${name}.${name.endsWith('-esm') ? 'mjs' : 'cjs'}`;
  return { name, files: { [file]: source }, nodeArgv: [file], ...extra };
}

/** Eval sources avoid `"`, `$`, backslash and backtick so one shell line carries them. */
function evalCase(name: string, source: string, fatal?: string): ProcessLifecycleCase {
  return {
    name,
    files: {},
    nodeArgv: ['-e', source],
    line: `node -e "${source}"`,
    ...(fatal === undefined ? {} : { fatal }),
  };
}

export const processLifecycleCases: readonly ProcessLifecycleCase[] = [
  // Handlers receive the error; the process continues (I3).
  program(
    'timer-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
setTimeout(() => { throw new Error('boom'); }, 0);
setTimeout(() => console.log('L|after', typeof process.exitCode), 30);`,
  ),
  program(
    'immediate-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
setImmediate(() => { throw new Error('imm'); });
setTimeout(() => console.log('L|after'), 30);`,
  ),
  program(
    'fs-callback-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
require('node:fs').readFile(__filename, () => { throw new Error('io'); });
setTimeout(() => console.log('L|after'), 50);`,
  ),
  program(
    'nexttick-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
process.nextTick(() => { throw new Error('tick'); });
setTimeout(() => console.log('L|after'), 30);`,
  ),
  program(
    'nonerror-handler',
    `${EXIT_ROW}
const reasonOf = (e) => typeof e === 'object' && e !== null && typeof e.message === 'string'
  ? e.message.replace(/^[^]*The promise rejected with the reason /, '')
  : String(e);
process.on('uncaughtException', (e, o) => {
  const own = typeof e === 'object' && e !== null && Object.prototype.hasOwnProperty.call(e, 'stack');
  console.log('L|caught', typeof e, e instanceof Error, own, e && e.name, e && e.code, reasonOf(e), o);
});
setTimeout(() => { throw 'str'; }, 0);
const reasons = [42, 'str', undefined, null, true, Symbol('s'), 10n, { a: 1 }, [1, 2], new Map(),
  Object.create(null), function f() {}, Object.assign(Object.create(Error.prototype), { message: 'proto' }),
  { stack: 'own' }];
reasons.forEach((r, i) => setTimeout(() => Promise.reject(r), 10 + i * 5));
setTimeout(() => console.log('L|after'), 200);`,
  ),
  program(
    'monitor-order',
    `${EXIT_ROW}
process.on('uncaughtExceptionMonitor', (e, o) => console.log('L|monitor', e.message, o));
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
setTimeout(() => { throw new Error('m'); }, 0);`,
  ),
  program(
    'rejection-handler',
    `${EXIT_ROW}
const rejected = Promise.reject(new Error('rej'));
process.on('unhandledRejection', (r, p) => console.log('L|caughtR', r.message, p === rejected));
setTimeout(() => console.log('L|after'), 30);`,
  ),
  program(
    'rejection-only-handler',
    `${EXIT_ROW}
process.on('unhandledRejection', (r) => console.log('L|caughtR', r.message));
Promise.reject(new Error('lone'));`,
  ),
  program(
    'rejection-fallback',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
Promise.reject(new Error('rej2'));
setTimeout(() => console.log('L|after'), 30);`,
  ),
  program(
    'entry-throw-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
setTimeout(() => console.log('L|after'), 30);
throw new Error('top');`,
  ),
  program(
    'entry-throw-handler-esm',
    `${EXIT_ROW}
process.on('unhandledRejection', (r) => console.log('L|unhandled', r.message));
process.on('uncaughtException', (e, o) => console.log('L|caught', e.message, o));
setTimeout(() => console.log('L|after'), 30);
throw new Error('topesm');`,
  ),

  // exit(), exitCode and the 'exit' event (I3).
  program(
    'natural-exit',
    `${EXIT_ROW}
console.log('L|body', typeof process.exitCode);`,
  ),
  program(
    'natural-exit-code',
    `${EXIT_ROW}
setTimeout(() => { process.exitCode = 4; console.log('L|late'); }, 10);`,
  ),
  program(
    'exitcode-read',
    `const rows = ['L|initial ' + typeof process.exitCode];
process.exitCode = '3';
rows.push('L|string ' + typeof process.exitCode + ' ' + process.exitCode);
process.exitCode = null;
rows.push('L|null ' + (process.exitCode === null ? 'null' : typeof process.exitCode));
process.exitCode = 4;
process.exitCode = undefined;
rows.push('L|reset ' + typeof process.exitCode);
for (const row of rows) console.log(row);`,
  ),
  program('exit-no-arg', `${EXIT_ROW}\nprocess.exitCode = 3;\nprocess.exit();`),
  program(
    'exit-startup-error',
    `${EXIT_ROW}
if (process.exitCode == null) process.exitCode = 1;
process.exit();`,
  ),
  program('exit-undefined-arg', `${EXIT_ROW}\nprocess.exitCode = 3;\nprocess.exit(undefined);`),
  program('exit-arg-override', `${EXIT_ROW}\nprocess.exitCode = 9;\nprocess.exit(5);`),
  program(
    'exit-listener-reassign',
    `process.on('exit', (c) => { console.log('L|exit', c); process.exitCode = 5; });
process.on('exit', (c) => console.log('L|exit-b', c, process.exitCode));`,
  ),
  program(
    'exit-reentrant',
    `let n = 0;
process.on('exit', (c) => { n += 1; console.log('L|exit', c, n); process.exit(2); });
process.on('exit', (c) => console.log('L|exit-b', c));
process.exit(1);`,
  ),
  program(
    'exit-listener-timer',
    `process.on('exit', (c) => {
  console.log('L|exit', c, process.exitCode);
  setTimeout(() => { console.log('L|timer-in-exit'); process.exit(9); }, 0);
});
setTimeout(() => console.log('L|done'), 5);`,
  ),
  program(
    'exit-in-rejection-handler',
    `${EXIT_ROW}
process.on('unhandledRejection', (r) => { process.exitCode = 1; console.log('L|handler', r.message); process.exit(); });
Promise.reject(new Error('vit'));
setTimeout(() => console.log('L|never'), 50);`,
  ),
  program(
    'exit-in-uncaught-handler',
    `${EXIT_ROW}
process.on('uncaughtException', (e) => { console.log('L|caught', e.message); process.exit(4); });
setTimeout(() => { throw new Error('x'); }, 0);
setTimeout(() => console.log('L|never'), 50);`,
  ),

  // No handler: loud stderr, 'exit' 1, status 1 (I3); a throwing handler: 7, no 'exit'.
  program('fatal-timer', `${EXIT_ROW}\nsetTimeout(() => { throw new Error('FATAL-TIMER'); }, 0);`, {
    fatal: 'FATAL-TIMER',
  }),
  program('fatal-rejection', `${EXIT_ROW}\nPromise.reject(new Error('FATAL-REJECTION'));`, {
    fatal: 'FATAL-REJECTION',
  }),
  // The fatal is final at once: a later task's exit(0) never overrides status 1.
  program(
    'fatal-rejection-then-exit',
    `${EXIT_ROW}
Promise.reject(new Error('FATAL-REJECTION-EXIT'));
setTimeout(() => process.exit(0), 1);`,
    { fatal: 'FATAL-REJECTION-EXIT' },
  ),
  program(
    'fatal-nexttick',
    `${EXIT_ROW}
process.nextTick(() => { throw new Error('FATAL-TICK'); });
setTimeout(() => console.log('L|never'), 30);`,
    { fatal: 'FATAL-TICK' },
  ),
  program('fatal-entry', `${EXIT_ROW}\nthrow new Error('FATAL-ENTRY');`, { fatal: 'FATAL-ENTRY' }),
  program(
    'fatal-handler-throws',
    `${EXIT_ROW}
process.on('uncaughtException', () => { throw new Error('FATAL-INNER'); });
setTimeout(() => { throw new Error('outer'); }, 0);`,
    { fatal: 'FATAL-INNER' },
  ),

  // Same rows on every supervised launch vitest uses (I3; scenario 3/4).
  evalCase(
    'eval-handler',
    "process.on('exit',c=>console.log('L|exit',c));process.on('uncaughtException',(e,o)=>console.log('L|caught',e.message,o));setTimeout(()=>{throw new Error('boom')},0);setTimeout(()=>console.log('L|after'),30)",
  ),
  evalCase(
    'eval-rejection-handler',
    "process.on('exit',c=>console.log('L|exit',c));process.on('unhandledRejection',(r,p)=>console.log('L|caughtR',r.message,p instanceof Promise));Promise.reject(new Error('rej'))",
  ),
  evalCase(
    'eval-exit-no-arg',
    "process.on('exit',c=>console.log('L|exit',c,process.exitCode));process.exitCode=3;process.exit()",
  ),
  evalCase(
    'eval-fatal-timer',
    "process.on('exit',c=>console.log('L|exit',c,process.exitCode));setTimeout(()=>{throw new Error('FATAL-EVAL')},0)",
    'FATAL-EVAL',
  ),
  {
    name: 'bin-startup-error',
    files: {
      'node_modules/lifecycle-bin/cli.mjs': `${EXIT_ROW}
setTimeout(() => {
  console.log('L|late');
  if (process.exitCode == null) process.exitCode = 1;
  process.exit();
}, 10);`,
      'node_modules/.bin/lifecycle-bin':
        "#!/usr/bin/env node\nimport('../lifecycle-bin/cli.mjs');\n",
    },
    nodeArgv: ['node_modules/.bin/lifecycle-bin'],
    line: 'lifecycle-bin',
  },
  {
    name: 'fork-child',
    files: {
      'fork-parent.cjs': `const { fork } = require('node:child_process');
const child = fork('fork-child.cjs', [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let out = '';
child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
child.on('close', (code) => {
  for (const row of out.split('\\n').filter(Boolean)) console.log(row);
  console.log('L|child-close', code);
});`,
      'fork-child.cjs': `process.on('exit', (c) => console.log('L|child-exit', c, process.exitCode));
process.on('uncaughtException', (e, o) => console.log('L|child-caught', e.message, o));
setTimeout(() => { throw new Error('child-boom'); }, 0);
setTimeout(() => { console.log('L|child-after'); process.exitCode = 3; }, 20);`,
    },
    nodeArgv: ['fork-parent.cjs'],
  },
  {
    name: 'worker-thread-handler',
    files: {
      'worker-parent.cjs': `const { Worker } = require('node:worker_threads');
const pin = setInterval(() => {}, 1000);
const w = new Worker('./worker-child.cjs');
w.on('message', (m) => console.log('L|msg', m));
w.on('error', (e) => console.log('L|werror', e.message));
w.on('exit', (c) => { console.log('L|wexit', c); clearInterval(pin); });`,
      'worker-child.cjs': `const { parentPort } = require('node:worker_threads');
process.on('uncaughtException', (e, o) => {
  parentPort.postMessage('caught ' + e.message + ' ' + o);
  setTimeout(() => process.exit(3), 20);
});
setTimeout(() => { throw new Error('wboom'); }, 0);`,
    },
    nodeArgv: ['worker-parent.cjs'],
  },
  // A fatal rejection's status 1 stays final on the forked and worker-thread owners.
  {
    name: 'fork-fatal-rejection-then-exit',
    files: {
      'fork-fatal-parent.cjs': `const { fork } = require('node:child_process');
const child = fork('fork-fatal-child.cjs', [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
let out = '';
child.stdout.setEncoding('utf8').on('data', (d) => { out += d; });
child.on('close', (code) => {
  for (const row of out.split('\\n').filter(Boolean)) console.log(row);
  console.log('L|child-close', code);
});`,
      'fork-fatal-child.cjs': `process.on('exit', (c) => console.log('L|child-exit', c, process.exitCode));
Promise.reject(new Error('FORK-FATAL'));
setTimeout(() => process.exit(0), 1);`,
    },
    nodeArgv: ['fork-fatal-parent.cjs'],
  },
  {
    name: 'worker-thread-fatal-rejection-then-exit',
    files: {
      'wt-fatal-parent.cjs': `const { Worker } = require('node:worker_threads');
const pin = setInterval(() => {}, 1000);
const w = new Worker('./wt-fatal-child.cjs');
w.on('error', () => {});
w.on('exit', (c) => { console.log('L|wexit', c); clearInterval(pin); });`,
      'wt-fatal-child.cjs': `Promise.reject(new Error('WT-FATAL'));
setTimeout(() => process.exit(0), 1);`,
    },
    nodeArgv: ['wt-fatal-parent.cjs'],
  },
  {
    name: 'exec-sync-fatal-rejection-then-exit',
    files: {
      'xs-fatal-parent.cjs': `const { execSync } = require('node:child_process');
try { execSync('node xs-fatal-child.cjs', { stdio: 'pipe' }); console.log('L|exec-ok'); }
catch { console.log('L|exec-failed'); }`,
      'xs-fatal-child.cjs': `Promise.reject(new Error('XS-FATAL'));
setTimeout(() => process.exit(0), 1);`,
    },
    nodeArgv: ['xs-fatal-parent.cjs'],
  },
  {
    name: 'exec-sync-child',
    files: {
      'exec-parent.cjs': `const { execSync } = require('node:child_process');
process.stdout.write(execSync('node exec-child.cjs').toString());
console.log('L|parent-done');`,
      'exec-child.cjs': `process.on('exit', (c) => console.log('L|child-exit', c, process.exitCode));
process.on('uncaughtException', (e, o) => console.log('L|child-caught', e.message, o));
setTimeout(() => { throw new Error('exec-boom'); }, 0);
setTimeout(() => console.log('L|child-late'), 20);`,
    },
    nodeArgv: ['exec-parent.cjs'],
  },
];

/** `L|` rows; ANSI stripped (a colour-forcing env styles Node's console numbers). */
export function lifecycleRows(output: string): string[] {
  return stripVTControlCharacters(output)
    .replaceAll('\r', '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('L|'));
}

export async function runLifecycleOracle(testCase: ProcessLifecycleCase): Promise<{
  readonly version: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-process-lifecycle-'));
  try {
    for (const [path, content] of Object.entries(testCase.files)) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), content);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...testCase.nodeArgv], {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Node oracle ${testCase.name} timed out:\n${stdout}\n${stderr}`));
      }, 10_000);
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        stderr += chunk;
      });
      child.once('error', (error) => {
        clearTimeout(deadline);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(deadline);
        resolve({ version: process.version, code, stdout, stderr });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
