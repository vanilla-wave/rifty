import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const extracted = resolve('orphan-payload-extracted');
await mkdir(extracted, { recursive: true });
execFileSync('tar', ['-xzf', resolve('dist/producer-vite-snapshot.tar.gz'), '-C', extracted]);
const payload = resolve(extracted, 'payload');
const files = [];
const directories = [];
async function walk(relative = '') {
  const children = await readdir(resolve(payload, relative), { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = relative ? `${relative}/${child.name}` : child.name;
    if (child.isDirectory()) {
      directories.push(path);
      await walk(path);
    } else {
      assert(child.isFile(), 'Producer payload contains ordinary files/directories only');
      const bytes = await readFile(resolve(payload, path));
      files.push({ path, encoding: 'base64', content: bytes.toString('base64') });
    }
  }
}
await walk();
assert(files.some((file) => file.path === 'node_modules/esbuild-wasm/esbuild.wasm'));
assert(files.some((file) => file.path === 'node_modules/vite/package.json'));
const json = JSON.stringify({ directories, files });
await writeFile(resolve('dist/orphan-payload.json'), json);
console.log(
  `Real producer orphan payload: ${JSON.stringify({
    files: files.length,
    directories: directories.length,
    decodedBytes: files.reduce(
      (total, file) => total + Buffer.from(file.content, 'base64').length,
      0,
    ),
    sha256: createHash('sha256').update(json).digest('hex'),
  })}`,
);
