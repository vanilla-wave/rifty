import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const MODULE_ID = '/node_modules/esbuild/lib/main.js';
const ENTRY_ID = '/workspace/entry.mjs';

interface EsbuildLikeOuter {
  readonly default: EsbuildLikeDefault;
  readonly transform: () => string;
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
  });
  return { loader: createModuleLoader(vfs, { cwd: '/workspace' }), vfs };
}

describe('common CJS→ESM namespace Contract+RED (ADR-0226 D3)', () => {
  it('uses the exact CJS outer as ESM default while preserving named references', async () => {
    const { loader } = setup();
    const outer = loader.require('esbuild', ENTRY_ID) as EsbuildLikeOuter;
    const namespace = await loader.import('esbuild', ENTRY_ID);

    expect(outer).not.toBe(outer.default);
    expect(outer.default.default).toBe(outer.default);
    expect(namespace.default).toBe(outer);
    expect(namespace.transform).toBe(outer.transform);
  });

  it('returns one namespace object for repeated imports of one CJS module record', async () => {
    const { loader } = setup();

    const first = await loader.import('esbuild', ENTRY_ID);
    const second = await loader.import('esbuild', ENTRY_ID);

    expect(second).toBe(first);
  });

  it('evicts the CJS namespace with its record during coherent invalidation', async () => {
    const { loader, vfs } = setup();
    const first = await loader.import('esbuild', ENTRY_ID);

    vfs.loadFixture({ [MODULE_ID]: source('v2') });
    loader.invalidate(MODULE_ID);

    const nextOuter = loader.require('esbuild', ENTRY_ID) as EsbuildLikeOuter;
    const next = await loader.import('esbuild', ENTRY_ID);
    expect(next).not.toBe(first);
    expect(next.default).toBe(nextOuter);
    expect(next.version).toBe('v2');
  });
});
