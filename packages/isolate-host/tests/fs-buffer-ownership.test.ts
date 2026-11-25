/**
 * The guest's file bytes never share memory with its buffers, in the isolate
 * as in Node: the parity cases' programs (the in-process run is the parity
 * runner's). ReadStream row: ceiling here (`isolate-host.ReadableStream`).
 * Oracle: live `node -e`.
 */
import { expect, it } from 'vitest';
import moment from '../../../tools/node-parity-runner/cases/fs/async-write-buffer-moment.case.ts';
import viewKinds from '../../../tools/node-parity-runner/cases/fs/write-array-buffer-view-kinds.case.ts';
import ownership from '../../../tools/node-parity-runner/cases/fs/write-read-buffer-ownership.case.ts';
import shared from '../../../tools/node-parity-runner/cases/fs/write-shared-array-buffer-ownership.case.ts';
import { createSandbox, runCode } from '../src/index.ts';
import { nodeEval } from './support.ts';

const clean = (stdout: string) => ({ stdout, stderr: '', exitCode: 0 });

const programs = [
  ['buffers', ownership.code],
  ['view kinds', viewKinds.code],
  ['async writes', moment.code],
] as const;

for (const [name, code] of [...programs, ['SharedArrayBuffer', shared.code]] as const) {
  it(`runCode: file bytes are not the program's ${name}`, async () => {
    const oracle = nodeEval(code);
    expect(oracle.code).toBe(0);
    const result = await runCode(code, { allowSharedArrayBuffer: true, timeoutMs: 30_000 });
    expect({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }).toEqual(
      clean(oracle.stdout),
    );
  });
}

for (const [name, code] of programs) {
  it(`sandbox exec: file bytes are not the program's ${name}`, async () => {
    const oracle = nodeEval(code);
    const sandbox = await createSandbox();
    try {
      await sandbox.writeFile('/workspace/main.js', code);
      const result = await sandbox.exec('/workspace/main.js', { timeoutMs: 30_000 });
      expect({ stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode }).toEqual(
        clean(oracle.stdout),
      );
    } finally {
      await sandbox.destroy();
    }
  });
}

it("sandbox writeFile/readFile: file bytes are not the host's buffers", async () => {
  const sandbox = await createSandbox();
  try {
    const host = new Uint8Array([1, 2, 3]);
    await sandbox.writeFile('/workspace/h', host);
    host.fill(9);
    const read = await sandbox.readFile('/workspace/h');
    read.fill(8);
    expect([...(await sandbox.readFile('/workspace/h'))]).toEqual([1, 2, 3]);
  } finally {
    await sandbox.destroy();
  }
});
