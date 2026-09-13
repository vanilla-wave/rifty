import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
export type FileTree = Record<string, string>;
export const excluded = new Set(['.git', 'node_modules', 'dist']);
export async function writeTree(root: string, files: FileTree) {
  for (const [name, content] of Object.entries(files)) {
    const path = join(root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content);
  }
}
export async function readTree(root: string): Promise<FileTree> {
  const files: FileTree = Object.create(null);
  async function walk(path: string) {
    for (const entry of await readdir(join(root, path), { withFileTypes: true })) {
      if (excluded.has(entry.name)) continue;
      const name = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(name);
      else if (entry.isFile()) files[name] = await readFile(join(root, name), 'utf8');
    }
  }
  await walk('');
  return files;
}
export function diffTrees(before: FileTree, after: FileTree) {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((path) => before[path] !== after[path])
    .map((path) => ({ path, before: before[path] ?? null, after: after[path] ?? null }));
}
