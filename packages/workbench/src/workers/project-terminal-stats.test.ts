import * as nativeFs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { statSync as guestStat } from '@riftydev/runtime-js/builtins/fs';
import { createMemoryFs, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { createGuestLayout } from './guest-layout.ts';
import { ProjectTerminalFsSync } from './project-terminal-namespace.ts';

const ownerRoot = '/.rifty/workbench/v2/projects/stats/tree';
const paths = ['/', '/home', '/home/project', '/tmp', '/home/rifty'];
const fields = [
  'ino',
  'nlink',
  'mode',
  'size',
  'atimeMs',
  'mtimeMs',
  'ctimeMs',
  'birthtimeMs',
] as const;
function facts(stat: Pick<nativeFs.Stats, (typeof fields)[number] | 'isDirectory'>) {
  return {
    directory: stat.isDirectory(),
    type: stat.mode & 0o170000,
    links: stat.nlink,
    numeric: fields.map((field) => [field, typeof stat[field], Number.isFinite(stat[field])]),
  };
}

it('exposes Node directory stats with owner-stable identity across guest namespace views', () => {
  const nativeRoot = nativeFs.mkdtempSync(join(tmpdir(), 'rifty-namespace-stat-'));
  try {
    for (const path of paths) nativeFs.mkdirSync(join(nativeRoot, path), { recursive: true });
    const oracle = paths.map((path) => facts(nativeFs.statSync(join(nativeRoot, path))));
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync(ownerRoot, { recursive: true });
    const view = () =>
      new ProjectTerminalFsSync(fsSync, createGuestLayout('/home/project', ownerRoot));
    const first = view();
    setSyncMirror(first);
    expect(paths.map((path) => facts(guestStat(path)))).toEqual(oracle);
    const identity = paths.map((path) => guestStat(path).ino);
    expect(new Set(identity).size).toBe(paths.length);
    const second = view();
    setSyncMirror(second);
    expect(paths.map((path) => guestStat(path).ino)).toEqual(identity);
    for (const path of paths) expect(second.statSyncOrNull(path)).toEqual(first.statSync(path));
    expect(second.statSyncOrNull('/absent')).toBeNull();
  } finally {
    resetSyncMirror();
    nativeFs.rmSync(nativeRoot, { recursive: true, force: true });
  }
});

it('keeps a covering project root identity while counting visible mount directories', () => {
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync(`${ownerRoot}/src`, { recursive: true });
  const view = new ProjectTerminalFsSync(fsSync, createGuestLayout('/', ownerRoot));
  const stat = view.statSync('/');
  expect(stat.metadata).toEqual(fsSync.statSync(ownerRoot).metadata);
  expect(stat.nlink).toBe(2 + view.readdirSync('/').filter((entry) => entry.isDirectory).length);
});

it.each(['file', 'directory'])(
  'keeps ancestor stat usable when a project %s collides with a nested mount',
  (kind) => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync(ownerRoot, { recursive: true });
    const view = new ProjectTerminalFsSync(fsSync, createGuestLayout('/', ownerRoot));
    const root = view.statSync('/');
    if (kind === 'file') fsSync.writeFileSync(`${ownerRoot}/tmp`, new Uint8Array());
    else fsSync.mkdirSync(`${ownerRoot}/tmp`, {});
    for (const stat of [view.statSync('/'), view.statSyncOrNull('/')]) {
      expect(stat?.metadata?.ino).toBe(root.metadata?.ino);
      expect(stat?.isDirectory).toBe(true);
      expect(stat?.nlink).toBe(root.nlink);
    }
    expect(() => view.readdirSync('/')).toThrow(/EEXIST.*\/tmp/u);
    expect(() => view.statSync('/tmp')).toThrow(/EEXIST.*\/tmp/u);
    expect(() => view.statSyncOrNull('/tmp')).toThrow(/EEXIST.*\/tmp/u);
  },
);

it.each(['ancestors', 'ancestors/home'])(
  'rejects malformed %s backing with a guest-only error',
  (slot) => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync(ownerRoot, { recursive: true });
    const privateRoot = `${ownerRoot.slice(0, ownerRoot.lastIndexOf('/'))}/guest`;
    const backing = `${privateRoot}/${slot}`;
    fsSync.mkdirSync(dirname(backing), { recursive: true });
    fsSync.writeFileSync(backing, new TextEncoder().encode('not a directory'));
    const view = new ProjectTerminalFsSync(fsSync, createGuestLayout('/home/project', ownerRoot));
    for (const stat of [() => view.statSync('/home'), () => view.statSyncOrNull('/home')]) {
      let error: unknown;
      try {
        stat();
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({ code: 'ENOTDIR', path: '/home' });
      expect(String(error)).not.toContain(privateRoot);
    }
  },
);
