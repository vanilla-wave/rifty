import { registerBuiltin } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const MODULE_ID = '/node_modules/esbuild/lib/main.js';
const ENTRY_ID = '/workspace/entry.mjs';

interface EsbuildLikeOuter {
  readonly default: EsbuildLikeDefault;
  transform: () => string;
  readonly version: string;
}

interface EsbuildLikeDefault {
  readonly default: EsbuildLikeDefault;
  readonly transform: () => string;
}

function source(marker: string): string {
  return `
const api = { transform() { return ${JSON.stringify(marker)}; } };
api.default = api;
module.exports = { default: api, transform: api.transform, version: ${JSON.stringify(marker)} };
`;
}

function setup(marker = 'v1') {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    '/node_modules/esbuild/package.json': JSON.stringify({ main: './lib/main.js' }),
    [MODULE_ID]: source(marker),
    '/node_modules/snapshot/package.json': JSON.stringify({ main: './index.js' }),
    '/node_modules/snapshot/index.js': `
const api = () => 'initial';
module.exports = { api };
`,
    '/node_modules/sibling/package.json': JSON.stringify({ main: './index.js' }),
    '/node_modules/sibling/index.js': `module.exports = { marker: 'sibling' };`,
    '/workspace/first.mjs': `
import value from 'esbuild';
export { value };
`,
    '/workspace/second.mjs': `
import value from 'esbuild';
export { value };
`,
    '/workspace/data.json': JSON.stringify({ marker }),
    '/workspace/message.txt': marker,
  });
  return { loader: createModuleLoader(vfs, { cwd: '/workspace' }), vfs };
}

describe('common CJS→ESM namespace Contract+RED (ADR-0226 D3)', () => {
  it.fails(
    'uses the exact CJS outer as ESM default while preserving named references',
    async () => {
      const { loader } = setup();
      const outer = loader.require('esbuild', ENTRY_ID) as EsbuildLikeOuter;
      const namespace = await loader.import('esbuild', ENTRY_ID);

      expect(outer).not.toBe(outer.default);
      expect(outer.default.default).toBe(outer.default);
      expect(namespace.default).toBe(outer);
      expect(namespace['module.exports']).toBe(outer);
      expect(namespace.transform).toBe(outer.transform);
    },
  );

  it.fails('snapshots a detected named reference when the namespace is created', async () => {
    const { loader } = setup();
    const outer = loader.require('snapshot', ENTRY_ID) as { api: () => string };
    const initial = outer.api;
    const namespace = await loader.import('snapshot', ENTRY_ID);

    outer.api = () => 'replacement';

    expect(namespace.api).toBe(initial);
    expect((namespace.default as { api: () => string }).api).toBe(outer.api);
  });

  it.fails(
    'returns one namespace object for repeated imports of one CJS module record',
    async () => {
      const { loader } = setup();

      const first = await loader.import('esbuild', ENTRY_ID);
      const second = await loader.import('esbuild', ENTRY_ID);

      expect(second).toBe(first);
    },
  );

  it.fails('shares one outer and namespace across require-first and import-first loads', async () => {
    const requireFirst = setup();
    const required = requireFirst.loader.require('esbuild', ENTRY_ID);
    const importedAfterRequire = await requireFirst.loader.import('esbuild', ENTRY_ID);
    expect(importedAfterRequire.default).toBe(required);
    expect(await requireFirst.loader.import('esbuild', '/workspace/other.mjs')).toBe(
      importedAfterRequire,
    );

    const importFirst = setup();
    const imported = await importFirst.loader.import('esbuild', ENTRY_ID);
    expect(importFirst.loader.require('esbuild', '/workspace/other.cjs')).toBe(imported.default);
    expect(await importFirst.loader.import('esbuild', '/workspace/other.mjs')).toBe(imported);
  });

  it.fails('gives two ESM parents the same CJS default outer', async () => {
    const { loader } = setup();
    const first = await loader.import('./first.mjs', ENTRY_ID);
    const second = await loader.import('./second.mjs', ENTRY_ID);
    const outer = loader.require('esbuild', ENTRY_ID);

    expect(first.value).toBe(outer);
    expect(second.value).toBe(outer);
  });

  it.fails('deduplicates same-turn imports onto one final namespace', async () => {
    const { loader } = setup();
    const [first, second] = await Promise.all([
      loader.import('esbuild', '/workspace/a.mjs'),
      loader.import('esbuild', '/workspace/b.mjs'),
    ]);

    expect(second).toBe(first);
    expect(first.default).toBe(loader.require('esbuild', ENTRY_ID));
  });

  it.fails('evicts only the targeted CJS namespace during rifty coherent invalidation', async () => {
    const { loader, vfs } = setup();
    const first = await loader.import('esbuild', ENTRY_ID);
    const sibling = await loader.import('sibling', ENTRY_ID);

    vfs.loadFixture({ [MODULE_ID]: source('v2') });
    loader.invalidate(MODULE_ID);

    const nextOuter = loader.require('esbuild', ENTRY_ID) as EsbuildLikeOuter;
    const next = await loader.import('esbuild', ENTRY_ID);
    expect(next).not.toBe(first);
    expect(next.default).toBe(nextOuter);
    expect(next.version).toBe('v2');
    expect(await loader.import('esbuild', '/workspace/repeat.mjs')).toBe(next);
    expect(await loader.import('sibling', '/workspace/repeat.mjs')).toBe(sibling);
  });

  it.fails('uses stable record-owned namespaces for JSON and text modules', async () => {
    const { loader } = setup();

    const json = await loader.import('./data.json', ENTRY_ID);
    expect(json.default).toEqual({ marker: 'v1' });
    expect(await loader.import('./data.json', '/workspace/other.mjs')).toBe(json);

    const text = await loader.import('./message.txt', ENTRY_ID);
    expect(text.default).toBe('v1');
    expect(await loader.import('./message.txt', '/workspace/other.mjs')).toBe(text);
  });

  it.fails('refreshes a builtin namespace only when its registered outer changes', async () => {
    const { loader } = setup();
    const bareName = 'rifty-test-cjs-namespace';
    const specifier = `node:${bareName}`;
    const firstOuter = { marker: 'first' };
    registerBuiltin(bareName, () => firstOuter);

    const first = await loader.import(specifier, ENTRY_ID);
    expect(first.default).toBe(firstOuter);
    expect(await loader.import(specifier, '/workspace/other.mjs')).toBe(first);

    const secondOuter = { marker: 'second' };
    registerBuiltin(bareName, () => secondOuter);
    const second = await loader.import(specifier, '/workspace/reloaded.mjs');
    expect(second).not.toBe(first);
    expect(second.default).toBe(secondOuter);
  });
});
