/**
 * Parity invariant: seed overlay produces an identical project file tree in
 * every lane. The rifty lane (pass B) will feed the SAME merged FileTree to
 * `__riftyAgentBench.seed`, so the shared overlay function + the local lane's
 * write→read roundtrip are the surface under test.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileTree, writeFileTree } from './fs-tree.ts';
import { overlaySeed, readSeedSpec } from './seed.ts';
import { ALL_TASK_SLUGS, loadTask } from './tasks.ts';
import { templateWorkspaceFiles } from './templates.ts';

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

describe('readSeedSpec', () => {
  it('returns {} for a task without seed/', () => {
    const taskDir = tempDir('agent-bench-task-');
    expect(readSeedSpec(taskDir)).toEqual({});
  });

  it('reads nested seed files as relative paths', () => {
    const taskDir = tempDir('agent-bench-task-');
    mkdirSync(join(taskDir, 'seed', 'src', 'data'), { recursive: true });
    writeFileSync(join(taskDir, 'seed', 'README.md'), 'seed readme\n', 'utf8');
    writeFileSync(join(taskDir, 'seed', 'src', 'data', 'x.ts'), 'export const x = 1;\n', 'utf8');
    expect(readSeedSpec(taskDir)).toEqual({
      'README.md': 'seed readme\n',
      'src/data/x.ts': 'export const x = 1;\n',
    });
  });
});

describe('overlaySeed', () => {
  it('overlays and overwrites template files, seed wins', () => {
    const merged = overlaySeed(
      { 'a.txt': 'template-a', 'b.txt': 'template-b' },
      { 'b.txt': 'seed-b', 'c.txt': 'seed-c' },
    );
    expect(merged).toEqual({ 'a.txt': 'template-a', 'b.txt': 'seed-b', 'c.txt': 'seed-c' });
  });
});

describe('seed overlay tree equality across lane materializations', () => {
  it('local-lane write→read roundtrip equals the merged FileTree (react-vite + seed)', () => {
    const seed = { 'src/data/extra.ts': 'export const planted = true;\n' };
    const merged = overlaySeed(templateWorkspaceFiles('react-vite'), seed);
    const dir = tempDir('agent-bench-ws-');
    writeFileTree(dir, merged);
    expect(readFileTree(dir)).toEqual(merged);
  });

  it('every task-set-v1 task materializes deterministically (two prepares, equal trees)', () => {
    for (const slug of ALL_TASK_SLUGS) {
      const task = loadTask(slug);
      const merged = overlaySeed(templateWorkspaceFiles(task.templateId), task.seed);
      const dirA = tempDir('agent-bench-ws-a-');
      const dirB = tempDir('agent-bench-ws-b-');
      writeFileTree(dirA, merged);
      writeFileTree(dirB, merged);
      expect(readFileTree(dirA), slug).toEqual(readFileTree(dirB));
      expect(readFileTree(dirA), slug).toEqual(merged);
    }
  });
});
