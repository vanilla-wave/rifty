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
  // `workDir` is the case's cwd — it holds setup files so `fs.readdirSync('.')`
  // sees only the case's fixtures (no harness scaffolding). `entryDir` holds
  // a COPY of those same setup files PLUS the entry script, so a case calling
  // `require('./a.js')` from `main.js` resolves to a real sibling on disk.
  // This mirrors the rifty harness, which mounts setup files at `/work/<rel>`
  // alongside the entry at `/work/main.{js,mjs}` for the loader, while the
  // fs sync-mirror exposes them at `/<rel>` for `fs.*Sync` parity with the
  // Node-side cwd view.
  const workDir = await mkdtemp(join(tmpdir(), 'rifty-parity-'));
  const entryDir = `${workDir}-entry`;
  try {
    if (testCase.setup?.files) {
      for (const [rel, content] of Object.entries(testCase.setup.files)) {
        const inCwd = join(workDir, rel);
        await mkdir(dirname(inCwd), { recursive: true });
        await writeFile(inCwd, content, 'utf8');
        const inEntry = join(entryDir, rel);
        await mkdir(dirname(inEntry), { recursive: true });
        await writeFile(inEntry, content, 'utf8');
      }
    } else {
      await mkdir(entryDir, { recursive: true });
    }
    const ext = testCase.kind === 'esm' ? 'mjs' : 'js';
    const entry = join(entryDir, `main.${ext}`);
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
    await rm(entryDir, { recursive: true, force: true });
  }
}
