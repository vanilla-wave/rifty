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
 * Values a Chromium realm can put in a message that rifty refuses by name
 * (ADR-0448 §Explicit gaps): platform objects Node's v8 serializer writes as
 * plain objects (a browser clone would deliver a different value or refuse
 * with a DOM error), a detached buffer or view (Chromium prefixes its refusal
 * text) and an own accessor beside a Buffer. An echo child reports every
 * label that arrived: in rifty only `after`, since a refused send posts nothing.
 */
const hostObject = 'NotImplementedError:child_process.serialization.advanced.host-object';
const ceilingCases: readonly {
  readonly label: string;
  readonly node: string;
  readonly rifty: string;
}[] = [
  { label: 'blob', node: 'sent', rifty: hostObject },
  { label: 'file', node: 'sent', rifty: hostObject },
  { label: 'dom-exception', node: 'sent', rifty: hostObject },
  { label: 'url', node: 'sent', rifty: hostObject },
  { label: 'abort-controller', node: 'sent', rifty: hostObject },
  { label: 'text-encoder', node: 'sent', rifty: hostObject },
  { label: 'headers', node: 'sent', rifty: hostObject },
  { label: 'message-port', node: 'sent', rifty: hostObject },
  {
    label: 'detached-array-buffer',
    node: 'Error:An ArrayBuffer is detached and could not be cloned.',
    rifty: 'NotImplementedError:child_process.serialization.advanced.detached-array-buffer',
  },
  {
    label: 'detached-view',
    node: 'TypeError:Cannot perform Construct on a detached ArrayBuffer',
    rifty: 'NotImplementedError:child_process.serialization.advanced.detached-array-buffer',
  },
  {
    label: 'getter-beside-buffer',
    node: 'sent',
    rifty: 'NotImplementedError:child_process.serialization.advanced.accessor-with-view',
  },
];

export const ceilingProgram: AdvancedIpcProgram = {
  name: 'host-objects',
  files: {
    'echo.cjs': "process.on('message', (message) => process.send(message.label));\n",
  },
  main: `const { fork } = require('node:child_process');
const { Buffer } = require('node:buffer');
const child = fork('echo.cjs', [], { serialization: 'advanced', stdio: 'ignore' });
child.on('error', () => {});
const detached = (make) => {
  const buffer = new ArrayBuffer(4);
  const holder = make(buffer);
  structuredClone(buffer, { transfer: [buffer] });
  return holder;
};
const values = [
  ['blob', () => new Blob(['x'])],
  ['file', () => new File(['x'], 'f.txt')],
  ['dom-exception', () => new DOMException('m', 'AbortError')],
  ['url', () => new URL('https://example.test/')],
  ['abort-controller', () => new AbortController()],
  ['text-encoder', () => new TextEncoder()],
  ['headers', () => new Headers({ a: '1' })],
  ['message-port', () => new MessageChannel().port1],
  ['detached-array-buffer', () => detached((buffer) => buffer)],
  ['detached-view', () => detached((buffer) => new Uint8Array(buffer))],
  ['getter-beside-buffer', () => ({ get count() { return 1; }, data: Buffer.from('x') })],
];
const received = [];
child.on('message', (label) => {
  received.push(label);
  if (label !== 'after') return;
  console.log('CEIL|received|' + JSON.stringify(received));
  child.disconnect();
});
for (const [label, make] of values) {
  try {
    child.send({ label, value: make() });
    console.log('CEIL|' + label + '|sent');
  } catch (error) {
    console.log('CEIL|' + label + '|' + error.name + ':' + (error.feature ?? error.message));
  }
}
console.log('CEIL|after|' + child.send({ label: 'after' }));
`,
};

/** Live Node's rows for the ceiling program: what it sends arrives, in order. */
export const ceilingNodeRows: readonly string[] = [
  ...ceilingCases.map(({ label, node }) => `CEIL|${label}|${node}`),
  'CEIL|after|true',
  `CEIL|received|${JSON.stringify([
    ...ceilingCases.filter(({ node }) => node === 'sent').map(({ label }) => label),
    'after',
  ])}`,
];

/** rifty's rows in Chromium: each refused by name, nothing posted. */
export const ceilingRows: readonly string[] = [
  ...ceilingCases.map(({ label, rifty }) => `CEIL|${label}|${rifty}`),
  'CEIL|after|true',
  'CEIL|received|["after"]',
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
        // Playwright's FORCE_COLOR would color a piped child's console numbers;
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
