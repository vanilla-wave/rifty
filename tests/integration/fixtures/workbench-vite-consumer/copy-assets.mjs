import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { cp, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = new URL('./assets/', import.meta.resolve('@riftydev/workbench'));
assert.ok(existsSync(source), 'packed Workbench contains copyable runtime assets');
for (const name of [
  'owner-worker.js',
  'kernel-worker.js',
  'node-worker.js',
  'dev-server-worker.js',
  'typescript-worker.js',
  'no-coi-toolchain-worker.js',
  'sw.js',
  'quickjs.wasm',
  'sql-wasm.wasm',
]) {
  assert.ok((await stat(new URL(name, source))).isFile(), `packed runtime asset ${name}`);
}
await mkdir('public', { recursive: true });
await cp(source, resolve('public/rifty'), { recursive: true });
console.log('Copied packed runtime asset closure; no Worker/SW compilation');
