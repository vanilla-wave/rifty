import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerLifecycleCase } from './worker-lifecycle-cases.ts';

export async function nativeWorkerLifecycle(fixture: WorkerLifecycleCase): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-worker-lifecycle-'));
  try {
    await writeFile(join(directory, 'child.cjs'), fixture.child);
    if (fixture.entry !== 'eval') await writeFile(join(directory, fixture.entry), fixture.parent);
    const args = fixture.entry === 'eval' ? ['-e', fixture.parent] : [fixture.entry];
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Native ${fixture.name} timed out: ${stdout}\n${stderr}`));
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
        resolve({ code, stdout, stderr });
      });
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
