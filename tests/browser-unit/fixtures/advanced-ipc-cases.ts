import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import advancedFault from '../../../tools/node-parity-runner/cases/child_process/public-ipc-advanced-fault.case.ts';
import advancedOptions from '../../../tools/node-parity-runner/cases/child_process/public-ipc-advanced-options.case.ts';
import advancedSameRealm from '../../../tools/node-parity-runner/cases/child_process/public-ipc-advanced-same-realm.case.ts';
import advancedValues from '../../../tools/node-parity-runner/cases/child_process/public-ipc-advanced.case.ts';
import type { ParityCase } from '../../../tools/node-parity-runner/src/types.ts';

/**
 * ADR-0448 programs for a real Chromium child realm. The four parity programs
 * run verbatim (one source for Node, the parity runner and Chromium); the
 * ceiling program covers the browser's own platform objects, which the Node
 * host cannot produce. Each program gets one directory of flat file names and
 * forks relative to its cwd.
 */
export interface AdvancedIpcProgram {
  readonly name: string;
  readonly main: string;
  readonly files: Readonly<Record<string, string>>;
}

function fromParityCase(name: string, parityCase: ParityCase): AdvancedIpcProgram {
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(parityCase.setup?.files ?? {})) {
    files[basename(path)] = content;
  }
  return { name, main: parityCase.code, files };
}

export const parityPrograms: readonly AdvancedIpcProgram[] = [
  fromParityCase('values', advancedValues),
  fromParityCase('fault', advancedFault),
  fromParityCase('options', advancedOptions),
  fromParityCase('same-realm-program', advancedSameRealm),
];

/**
 * Platform objects a Chromium realm can put in a message. Node's v8 serializer
 * writes each as a plain object (the live oracle prints `sent`); a browser
 * clone would deliver a different value or refuse with a DOM error, so rifty
 * refuses by name (ADR-0448 §Explicit gaps).
 */
export const ceilingProgram: AdvancedIpcProgram = {
  name: 'host-objects',
  files: {
    'idle.cjs': "process.on('message', () => {});\n",
  },
  main: `const { fork } = require('node:child_process');
const child = fork('idle.cjs', [], { serialization: 'advanced', stdio: 'ignore' });
child.on('error', () => {});
const values = [
  ['blob', () => new Blob(['x'])],
  ['file', () => new File(['x'], 'f.txt')],
  ['dom-exception', () => new DOMException('m', 'AbortError')],
  ['url', () => new URL('https://example.test/')],
  ['abort-controller', () => new AbortController()],
  ['text-encoder', () => new TextEncoder()],
  ['headers', () => new Headers({ a: '1' })],
  ['message-port', () => new MessageChannel().port1],
];
for (const [label, make] of values) {
  try {
    child.send({ value: make() });
    console.log('CEIL|' + label + '|sent');
  } catch (error) {
    console.log('CEIL|' + label + '|' + error.name + ':' + (error.feature ?? error.message));
  }
}
console.log('CEIL|after|' + child.send({ ok: true }));
child.disconnect();
`,
};

export const ceilingRows: readonly string[] = [
  ...[
    'blob',
    'file',
    'dom-exception',
    'url',
    'abort-controller',
    'text-encoder',
    'headers',
    'message-port',
  ].map(
    (label) => `CEIL|${label}|NotImplementedError:child_process.serialization.advanced.host-object`,
  ),
  'CEIL|after|true',
];

/** Stdout rows: the lines a program printed, CR-free, blank lines dropped. */
export function programRows(output: string, keep: (line: string) => boolean): string[] {
  return output
    .replaceAll('\r', '')
    .split('\n')
    .filter((line) => line !== '' && keep(line));
}

/** Runs one program verbatim in real Node (the Playwright host's `process.execPath`). */
export async function runNodeProgram(program: AdvancedIpcProgram): Promise<{
  readonly version: string;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-advanced-ipc-'));
  try {
    for (const [name, content] of Object.entries(program.files)) {
      await writeFile(join(directory, name), content);
    }
    await writeFile(join(directory, 'main.cjs'), program.main);
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['main.cjs'], {
        cwd: directory,
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
