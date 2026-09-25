import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import forkVitestShape from '../../../tools/node-parity-runner/cases/child_process/vitest-pool-shape.case.ts';
import { STARTUP_FILES } from '../../../tools/node-parity-runner/cases/process/startup-options-program.ts';
import threadVitestShape from '../../../tools/node-parity-runner/cases/worker_threads/vitest-pool-shape.case.ts';

/**
 * ADR-0449 programs for a real Chromium child realm, each also run verbatim in
 * live Node: worker output auto-piped to the terminal, startup options that a
 * nested Worker or fork inherits (beyond the parity runner's one physical
 * level), fork from a `node -e` parent, and vitest 4.1.11's two pool shapes
 * (the parity sources verbatim). Keys are relative to the program directory;
 * `command` is the terminal line (default `node main.cjs`), `nodeArgv` its
 * native-Node argv.
 */
export interface StartupProgram {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly command?: string;
  readonly nodeArgv?: readonly string[];
}

const EXEC_ARGV = "['--require', './pre.cjs', '-C', 'custom']";
const EVAL_FORK =
  "const { fork } = require('node:child_process'); fork('./fprint.cjs', ['default'])" +
  ".on('exit', () => fork('./fprint.cjs', ['explicit'], { execArgv: process.execArgv }))";

export const startupPrograms: readonly StartupProgram[] = [
  {
    name: 'worker-default-stdout',
    files: {
      'w-log.cjs':
        "require('node:worker_threads');\n" +
        "console.log('SX|from-worker console.log');\n" +
        "process.stdout.write('SX|from-worker stdout.write\\n');\n" +
        "console.error('worker stderr (not a row)');\n",
      'main.cjs':
        "const { Worker } = require('node:worker_threads');\n" +
        "const worker = new Worker(require('node:path').resolve('w-log.cjs'));\n" +
        "worker.on('exit', (code) => console.log('SX|exit ' + code));\n",
    },
  },
  {
    name: 'nested-worker-inherit',
    files: {
      ...STARTUP_FILES,
      // The outer worker mutates its public execArgv; the inner one still
      // inherits the outer's startup options (Node's trusted snapshot).
      'wnest.cjs':
        "const { Worker, parentPort } = require('node:worker_threads');\n" +
        "process.execArgv.push('--conditions=other');\n" +
        "const inner = new Worker(require('node:path').resolve(__dirname, 'probe.cjs'));\n" +
        "inner.on('message', (facts) => parentPort.postMessage(facts));\n",
      'main.cjs': `const { Worker } = require('node:worker_threads');
const worker = new Worker(require('node:path').resolve('wnest.cjs'), { execArgv: ${EXEC_ARGV} });
worker.on('message', (facts) => console.log('SX|inner ' + JSON.stringify(facts)));
worker.on('exit', (code) => console.log('SX|outer exit ' + code));
`,
    },
  },
  {
    name: 'nested-fork-inherit',
    files: {
      ...STARTUP_FILES,
      'fnest.cjs':
        "const { fork } = require('node:child_process');\n" +
        "const inner = fork(require('node:path').resolve(__dirname, 'probe.cjs'));\n" +
        "inner.on('message', (facts) => process.send(facts));\n",
      'main.cjs': `const { fork } = require('node:child_process');
const child = fork(require('node:path').resolve('fnest.cjs'), [], { execArgv: ${EXEC_ARGV} });
child.on('message', (facts) => console.log('SX|inner ' + JSON.stringify(facts)));
child.on('exit', (code) => console.log('SX|outer exit ' + code));
`,
    },
  },
  {
    // Node's fork drops the parent's eval pair whenever the effective execArgv
    // is `process.execArgv` itself: omitted, or passed explicitly (the second
    // child starts after the first exits, so the rows are ordered).
    name: 'eval-parent-fork',
    files: {
      'fprint.cjs':
        "console.log('SX|eval ' + process.argv[2] + ' child ' + JSON.stringify(process.execArgv));\n",
    },
    command: `node -e "${EVAL_FORK}"`,
    nodeArgv: ['-e', EVAL_FORK],
  },
  { name: 'vitest-threads-shape', files: { ...STARTUP_FILES, 'main.cjs': threadVitestShape.code } },
  { name: 'vitest-forks-shape', files: { ...STARTUP_FILES, 'main.cjs': forkVitestShape.code } },
];

/** `SX|` rows of the vitest-shape programs are their `pool …`/`… exit` lines. */
export function startupRows(output: string): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => /^(SX\||pool |thread |fork )/.test(line));
}

/** Runs one program verbatim in real Node (the Playwright host's `process.execPath`). */
export async function runStartupProgramInNode(program: StartupProgram): Promise<{
  readonly version: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-startup-options-'));
  try {
    for (const [name, content] of Object.entries(program.files)) {
      await mkdir(dirname(join(directory, name)), { recursive: true });
      await writeFile(join(directory, name), content);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [...(program.nodeArgv ?? ['main.cjs'])], {
        cwd: directory,
        // Playwright's FORCE_COLOR would color a piped child's console output;
        // the rifty terminal (and a user's) has none.
        env: Object.fromEntries(
          Object.entries(process.env).filter(([name]) => name !== 'FORCE_COLOR'),
        ),
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Node oracle timed out:\n${stdout}\n${stderr}`));
      }, 30_000);
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
