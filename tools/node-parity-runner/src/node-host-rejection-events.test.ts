import { Worker } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { installNodeHostRejectionEvents } from './node-host-rejection-events.ts';

interface ProbeResult {
  readonly unhandled: number;
}

const probeSource = `
const { parentPort, workerData } = require('node:worker_threads');
const install = (0, eval)('(' + workerData.installer + ')');
let unhandled = 0;
install(process, () => { unhandled += 1; });
const rejected = Promise.reject(new Error('probe rejection'));
setImmediate(() => {
  rejected.catch(() => {});
  setTimeout(() => {
    parentPort.postMessage({ unhandled });
    parentPort.close();
  }, 25);
});
`;

async function runProbe(): Promise<{ readonly result: ProbeResult; readonly stderr: string }> {
  const worker = new Worker(probeSource, {
    eval: true,
    stderr: true,
    workerData: { installer: installNodeHostRejectionEvents.toString() },
  });
  const stderr = worker.stderr;
  if (stderr === null) throw new Error('host rejection probe has no stderr pipe');
  stderr.setEncoding('utf8');
  const chunks: string[] = [];
  stderr.on('data', (chunk: string) => chunks.push(chunk));
  const result = new Promise<ProbeResult>((resolve, reject) => {
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) reject(new Error(`host rejection probe exited ${String(code)}`));
    });
  });
  const exit = new Promise<void>((resolve, reject) => {
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`host rejection probe exited ${String(code)}`));
    });
  });
  const observed = await result;
  await exit;
  return { result: observed, stderr: chunks.join('') };
}

describe('Node host rejection events', () => {
  it('keeps handled-rejection bookkeeping out of guest stderr', async () => {
    const probe = await runProbe();

    expect(probe.result).toEqual({ unhandled: 1 });
    expect(probe.stderr).toBe('');
  });
});
