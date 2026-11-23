/** Shared carriers for the snapshot tests (ADR-0567). */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MemoryFsSync } from '@riftydev/vfs/internal';

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url));
/** isolated-vm as rifty's host installs it (7.0.2). */
const WORKSPACE_IVM = dirname(
  createRequire(join(PACKAGE_DIR, '../isolate-host/package.json')).resolve(
    'isolated-vm/package.json',
  ),
);

export type Step =
  | { readonly op: 'isolate'; readonly memoryLimit?: number }
  | { readonly op: 'run'; readonly code: string; readonly wait?: false }
  | { readonly op: 'settle' }
  | { readonly op: 'snapshot'; readonly options: unknown }
  | {
      readonly op: 'restore';
      readonly bytes?: string;
      readonly file?: string;
      readonly options: unknown;
    };

export interface StepResult {
  readonly ok?: true;
  readonly error?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly exitCode?: number;
  readonly bytes?: string;
  readonly exact?: boolean;
  readonly type?: string;
  readonly ms?: number;
}

/** Run `steps` in one embedder process over real isolated-vm (`snapshot-driver.mjs`). */
export function drive(steps: readonly Step[]): StepResult[] {
  const out = execFileSync(
    process.execPath,
    ['--no-node-snapshot', join(PACKAGE_DIR, 'tests/snapshot-driver.mjs'), WORKSPACE_IVM],
    { input: JSON.stringify(steps), encoding: 'utf8', timeout: 120_000, maxBuffer: 1 << 30 },
  );
  return out
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as StepResult);
}

/** Names rifty's FS holds that a UTF-8 or path-normalising format would lose or merge. */
export const ODD_NAMES = ['a b', 'new\nline', 'é', '😀', 'lone\uD800', 'trail\uDFFF', '.hidden'];

/** Guest code building the scenario's tree (step 1). */
export const BUILD_TREE = `
{
const fs = require('fs');
fs.mkdirSync('/workspace/src/deep/er', { recursive: true });
fs.mkdirSync('/workspace/empty');
fs.mkdirSync('/tmp', { recursive: true });
fs.writeFileSync('/workspace/src/index.js', 'console.log(1)\\n');
fs.writeFileSync('/workspace/bin.dat', Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
fs.writeFileSync('/workspace/empty.txt', '');
fs.writeFileSync('/workspace/src/deep/er/leaf', 'leaf');
fs.writeFileSync('/tmp/outside', 'outside /workspace');
for (const name of ${JSON.stringify(ODD_NAMES)}) fs.writeFileSync('/workspace/src/' + name, name);
fs.utimesSync('/workspace/bin.dat', 1000, 2000);
fs.utimesSync('/workspace/empty', 3000, 4000);
}
`;

/**
 * Guest code printing every path from `/`: kind, the `fs.stat` fields a
 * restore keeps (not `ino`: renewed, ADR-0567 §1), `readdirSync` order, file
 * bytes. Reading changes nothing (no atime). One run per isolate: append it to
 * the code whose tree it lists.
 */
export const LIST_TREE = `
{
const fs = require('fs');
const out = [];
const visit = (path) => {
  const s = fs.statSync(path);
  const row = { path, kind: s.isDirectory() ? 'dir' : 'file', size: s.size, nlink: s.nlink,
    mode: s.mode, mtimeMs: s.mtimeMs, atimeMs: s.atimeMs, ctimeMs: s.ctimeMs, birthtimeMs: s.birthtimeMs };
  out.push(row);
  if (row.kind === 'dir') {
    row.names = fs.readdirSync(path);
    for (const name of row.names) visit(path === '/' ? '/' + name : path + '/' + name);
  } else row.bytes = fs.readFileSync(path).toString('base64');
};
visit('/');
console.log(JSON.stringify(out));
}
`;

export interface Row {
  readonly path: string;
  readonly kind: 'dir' | 'file';
  readonly size: number;
  readonly nlink: number;
  readonly mode?: number;
  readonly mtimeMs: number;
  readonly atimeMs: number;
  readonly ctimeMs: number;
  readonly birthtimeMs: number;
  readonly names?: readonly string[];
  readonly bytes?: string;
}

/** The guest listing's shape, read from a Node-realm rifty FS (no `mode`: it follows from kind). */
export function listFs(fs: MemoryFsSync): Row[] {
  const out: Row[] = [];
  const stack = ['/'];
  while (stack.length > 0) {
    const path = stack.shift() as string;
    const s = fs.statSync(path);
    const base = {
      path,
      kind: s.isDirectory ? ('dir' as const) : ('file' as const),
      size: s.size ?? 0,
      nlink: s.nlink ?? 0,
      mtimeMs: s.mtime ?? 0,
      atimeMs: s.atime ?? 0,
      ctimeMs: s.metadata?.ctime ?? 0,
      birthtimeMs: s.metadata?.birthtime ?? 0,
    };
    if (s.isDirectory) {
      const names = fs.readdirSync(path).map((d) => d.name);
      out.push({ ...base, names });
      stack.unshift(...names.map((n) => (path === '/' ? `/${n}` : `${path}/${n}`)));
    } else {
      out.push({ ...base, bytes: Buffer.from(fs.readFileBytesSync(path)).toString('base64') });
    }
  }
  return out;
}

/** A guest listing without `mode`, for comparison with `listFs`. */
export const withoutMode = (rows: readonly Row[]): Row[] =>
  rows.map(({ mode: _mode, ...rest }) => rest);
