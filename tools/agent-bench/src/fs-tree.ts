/** Small fs helpers shared by the local lane and the parity tests. */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FileTree } from './seed.ts';

export function writeFileTree(dir: string, tree: FileTree): void {
  for (const [rel, content] of Object.entries(tree)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content, 'utf8');
  }
}

const DEFAULT_IGNORE = new Set(['node_modules', '.git', 'package-lock.json']);

/** Read a directory back into a FileTree (modulo node_modules/.git/lockfile). */
export function readFileTree(dir: string, ignore: Set<string> = DEFAULT_IGNORE): FileTree {
  const tree: FileTree = {};
  const walk = (abs: string, prefix: string): void => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (ignore.has(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(abs, entry.name), rel);
      else tree[rel] = readFileSync(join(abs, entry.name), 'utf8');
    }
  };
  walk(dir, '');
  return tree;
}
