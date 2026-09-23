import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { WorkerStartupOptionsCase } from './worker-startup-options-cases.ts';

export async function nativeWorkerStartupOptions(
  fixture: WorkerStartupOptionsCase,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const directory = await mkdtemp(join(tmpdir(), 'rifty-worker-options-'));
  try {
    for (const [path, source] of Object.entries({ ...fixture.files, 'main.cjs': fixture.parent })) {
      await mkdir(dirname(join(directory, path)), { recursive: true });
      await writeFile(join(directory, path), source);
    }
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ['main.cjs'], {
        cwd: directory,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const deadline = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Native ${fixture.name} timeout: ${stdout}\n${stderr}`));
      }, 10000);
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
