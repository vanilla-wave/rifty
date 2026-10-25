import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { collectSnapshot } from '../glue/vfs-snapshot-port.ts';
import { createOwnerVfsAuthority } from '../workers/owner-vfs-authority.ts';
import {
  exportPlaygroundArchiveV1,
  preparePlaygroundArchiveV1Import,
} from './internal/playground-archive.ts';

const root = '/express-project';
const content = new TextEncoder().encode('user-owned notes');
function project() {
  const fs = createOwnerVfsAuthority(new MemoryFsSync(), { ownerEpoch: 'ordinary-files' });
  fs.mkdirSync(`${root}/.vite`, { recursive: true });
  fs.writeFileSync(`${root}/.vite/notes.txt`, content);
  fs.writeFileSync(
    `${root}/package.json`,
    new TextEncoder().encode('{"dependencies":{"express":"4.21.2"}}'),
  );
  return fs;
}

describe('ordinary project package-named files', () => {
  it('includes user-owned .vite notes in the real owner snapshot', () => {
    const frame = collectSnapshot(project(), root);
    expect(
      frame.entries.find((entry) => entry.path === `${root}/.vite/notes.txt`)?.content,
    ).toEqual(content);
  });
  it('roundtrips user-owned .vite notes through archive export and import', () => {
    const fs = project();
    const json = exportPlaygroundArchiveV1(fs, root);
    const restored = preparePlaygroundArchiveV1Import(fs, '/restored', json).decodedFiles();
    expect(restored.find((file) => file.path === '.vite/notes.txt')?.bytes).toEqual(content);
  });
  it('accepts a foreign archive containing ordinary .vite files', () => {
    const json = JSON.stringify({
      version: 1,
      root: '/',
      files: [{ path: '.vite/notes.txt', encoding: 'base64', content: btoa('user-owned notes') }],
    });
    expect(
      preparePlaygroundArchiveV1Import(project(), '/restored', json).decodedFiles()[0]?.bytes,
    ).toEqual(content);
  });
});
