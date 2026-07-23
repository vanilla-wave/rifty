import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runner = resolve(repoRoot, 'tests/integration/workbench-packed-consumer.mjs');
const enabled = process.env.RIFTY_RUN_PACKED_CONSUMER === '1';
const maxOutputBytes = 1024 * 1024;

function appendBounded(output: string, chunk: unknown): string {
  const next = output + String(chunk);
  return next.length <= maxOutputBytes ? next : next.slice(-maxOutputBytes);
}

describe.skipIf(!enabled)('packed Workbench external consumer', () => {
  it('installs only tarballs and proves Vite preview plus HMR in fresh Chromium', async () => {
    const result = await new Promise<{ readonly code: number | null; readonly output: string }>(
      (resolveRun, rejectRun) => {
        const child = spawn(process.execPath, [runner], {
          cwd: repoRoot,
          env: { ...process.env, CI: '1', COREPACK_ENABLE_NETWORK: '0' },
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let output = '';
        let forceKill: ReturnType<typeof setTimeout> | undefined;
        const timeout = setTimeout(() => {
          output = appendBounded(output, '\nPacked consumer exceeded 820000ms; terminating\n');
          child.kill('SIGTERM');
          forceKill = setTimeout(() => child.kill('SIGKILL'), 60_000);
        }, 820_000);
        child.stdout.on('data', (chunk) => {
          output = appendBounded(output, chunk);
        });
        child.stderr.on('data', (chunk) => {
          output = appendBounded(output, chunk);
        });
        child.on('error', (error) => {
          clearTimeout(timeout);
          clearTimeout(forceKill);
          rejectRun(error);
        });
        child.on('close', (code) => {
          clearTimeout(timeout);
          clearTimeout(forceKill);
          resolveRun({ code, output });
        });
      },
    );

    expect(result.code, result.output).toBe(0);
    expect(result.output).toContain('Packed Workbench consumer passed');
  }, 900_000);
});
