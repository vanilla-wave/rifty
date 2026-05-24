/**
 * Run case code in a child Node process and capture its stdout. Uses a tiny
 * harness so we can preload "VFS" files into a real temp dir before evaluating
 * the user code.
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { ParityCase } from './types.ts';

export async function runInNode(testCase: ParityCase): Promise<string> {
  const workDir = await mkdtemp(join(tmpdir(), 'rifty-parity-'));
  try {
    if (testCase.setup?.files) {
      for (const [rel, content] of Object.entries(testCase.setup.files)) {
        const full = join(workDir, rel);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, content, 'utf8');
      }
    }
    const ext = testCase.kind === 'esm' ? 'mjs' : 'js';
    // Keep the entry out of cwd so a case calling `readdirSync('.')` only sees
    // the files it set up, not our harness scaffolding.
    const entryDir = `${workDir}-entry`;
    await mkdir(entryDir, { recursive: true });
    const entry = join(entryDir, `__entry.${ext}`);
    await writeFile(entry, testCase.code, 'utf8');

    return await new Promise<string>((resolve, reject) => {
      const proc = spawn(process.execPath, [entry], {
        cwd: workDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let out = '';
      let err = '';
      proc.stdout.on('data', (c) => {
        out += c.toString('utf8');
      });
      proc.stderr.on('data', (c) => {
        err += c.toString('utf8');
      });
      proc.on('close', (code) => {
        if (code !== 0) reject(new Error(`Node exited ${code}: ${err.trim() || out.trim()}`));
        else resolve(out);
      });
      proc.on('error', reject);
    });
  } finally {
    await rm(workDir, { recursive: true, force: true });
    await rm(`${workDir}-entry`, { recursive: true, force: true });
  }
}
