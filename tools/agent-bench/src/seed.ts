/**
 * Seed overlay — the ONE implementation both lanes use (parity invariant:
 * identical project file tree across lanes, modulo node_modules/lockfile).
 * Local lane writes the merged tree to a temp dir; the rifty lane (pass B)
 * feeds the same merged map to `__riftyAgentBench.seed`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Relative path (no leading slash) → file contents. */
export type FileTree = Record<string, string>;

/** Read `tasks/<slug>/seed/` into a FileTree; `{}` when the task has no seed dir. */
export function readSeedSpec(taskDir: string): FileTree {
  const seedDir = join(taskDir, 'seed');
  try {
    statSync(seedDir);
  } catch {
    return {}; // no seed/ — most tasks run the pristine preset
  }
  const tree: FileTree = {};
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(dir, entry.name), rel);
      else tree[rel] = readFileSync(join(dir, entry.name), 'utf8');
    }
  };
  walk(seedDir, '');
  return tree;
}

/** Pure merge: seed files overlay (and may overwrite) the template tree. */
export function overlaySeed(template: FileTree, seed: FileTree): FileTree {
  return { ...template, ...seed };
}
