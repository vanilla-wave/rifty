import { NotImplementedError, registerBuiltin } from '@riftydev/io';
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
    '/workspace/collision.json': JSON.stringify({ 'module.exports': 'payload' }),
    '/workspace/message.txt': marker,
  });
  return { loader: createModuleLoader(vfs, { cwd: '/workspace' }), vfs };
}

describe('common CJS→ESM namespace (ADR-0226 D3)', () => {
  it('uses the exact CJS outer as ESM default while preserving named references', async () => {
    const { loader } = setup();
    const outer = loader.require('esbuild', ENTRY_ID) as EsbuildLikeOuter;
    const namespace = await loader.import('esbuild', ENTRY_ID);

    expect(outer).not.toBe(outer.default);
    expect(outer.default.default).toBe(outer.default);
    expect(namespace.default).toBe(outer);
    expect(namespace['module.exports']).toBe(outer);
    expect(namespace.transform).toBe(outer.transform);
  });

  it('snapshots a detected named reference when the namespace is created', async () => {
    const { loader } = setup();
    const outer = loader.require('snapshot', ENTRY_ID) as { api: () => string };
    const initial = outer.api;
    const namespace = await loader.import('snapshot', ENTRY_ID);

    outer.api = () => 'replacement';

    expect(namespace.api).toBe(initial);
    expect((namespace.default as { api: () => string }).api).toBe(outer.api);
  });

  it('returns one namespace object for repeated imports of one CJS module record', async () => {
    const { loader } = setup();

    const first = await loader.import('esbuild', ENTRY_ID);
    const second = await loader.import('esbuild', ENTRY_ID);

    expect(second).toBe(first);
  });

  it('shares one outer and namespace across require-first and import-first loads', async () => {
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

  it('gives two ESM parents the same CJS default outer', async () => {
    const { loader } = setup();
    const first = await loader.import('./first.mjs', ENTRY_ID);
    const second = await loader.import('./second.mjs', ENTRY_ID);
    const outer = loader.require('esbuild', ENTRY_ID);

    expect(first.value).toBe(outer);
    expect(second.value).toBe(outer);
  });

  it('deduplicates same-turn imports onto one final namespace', async () => {
    const { loader } = setup();
    const [first, second] = await Promise.all([
      loader.import('esbuild', '/workspace/a.mjs'),
      loader.import('esbuild', '/workspace/b.mjs'),
    ]);

    expect(second).toBe(first);
    expect(first.default).toBe(loader.require('esbuild', ENTRY_ID));
  });

  it('evicts only the targeted CJS namespace during rifty coherent invalidation', async () => {
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

  it('uses stable record-owned namespaces for JSON and text modules', async () => {
    const { loader } = setup();

    const json = await loader.import('./data.json', ENTRY_ID);
    expect(json.default).toEqual({ marker: 'v1' });
    expect(Object.hasOwn(json, 'module.exports')).toBe(false);
    expect(await loader.import('./data.json', '/workspace/other.mjs')).toBe(json);

    const collision = await loader.import('./collision.json', ENTRY_ID);
    expect(collision.default).toEqual({ 'module.exports': 'payload' });
    expect(collision['module.exports']).toBe('payload');

    const text = await loader.import('./message.txt', ENTRY_ID);
    expect(text.default).toBe('v1');
    expect(Object.hasOwn(text, 'module.exports')).toBe(false);
    expect(await loader.import('./message.txt', '/workspace/other.mjs')).toBe(text);
  });

  it('refreshes a builtin namespace only when its registered outer changes', async () => {
    const { loader } = setup();
    const bareName = 'rifty-test-cjs-namespace';
    const specifier = `node:${bareName}`;
    const firstOuter = { marker: 'first' };
    registerBuiltin(bareName, () => firstOuter);

    const first = await loader.import(specifier, ENTRY_ID);
    expect(first.default).toBe(firstOuter);
    expect(Object.hasOwn(first, 'module.exports')).toBe(false);
    expect(await loader.import(specifier, '/workspace/other.mjs')).toBe(first);

    const secondOuter = { marker: 'second' };
    registerBuiltin(bareName, () => secondOuter);
    const second = await loader.import(specifier, '/workspace/reloaded.mjs');
    expect(second).not.toBe(first);
    expect(second.default).toBe(secondOuter);
  });

  it('keeps an issued import job on its captured generation across invalidation', async () => {
    const { loader, vfs } = setup();
    const id = '/node_modules/cycle/index.js';
    const cycleSource = (marker: string) => `
const outer = { marker: ${JSON.stringify(marker)} };
module.exports = outer;
const pending = import('./index.js');
outer.pending = () => pending;
`;
    vfs.loadFixture({
      '/node_modules/cycle/package.json': JSON.stringify({ main: './index.js' }),
      [id]: cycleSource('v1'),
    });
    const outer = loader.require('cycle', ENTRY_ID) as {
      marker: string;
      pending: () => Promise<Record<string, unknown>>;
    };
    const oldJob = outer.pending();

    vfs.loadFixture({ [id]: cycleSource('v2') });
    loader.invalidate(id);
    const [oldNamespace, freshNamespace] = await Promise.all([
      oldJob,
      loader.import('cycle', ENTRY_ID),
    ]);

    expect(oldNamespace.default).toBe(outer);
    expect((oldNamespace.default as { marker: string }).marker).toBe('v1');
    expect((freshNamespace.default as { marker: string }).marker).toBe('v2');
    expect(freshNamespace).not.toBe(oldNamespace);
  });

  it('caches an import-job error separately from retryable require state', async () => {
    const { loader, vfs } = setup();
    const id = '/node_modules/failing/index.js';
    vfs.loadFixture({
      '/node_modules/failing/package.json': JSON.stringify({ main: './index.js' }),
      [id]: `throw new Error('job-boom');`,
    });

    const first = await loader.import('failing', ENTRY_ID).catch((error: unknown) => error);
    const repeated = await loader.import('failing', ENTRY_ID).catch((error: unknown) => error);
    let requireError: unknown;
    try {
      loader.require('failing', ENTRY_ID);
    } catch (error) {
      requireError = error;
    }

    expect(repeated).toBe(first);
    expect(requireError).not.toBe(first);
    expect(await loader.import('failing', ENTRY_ID).catch((error: unknown) => error)).toBe(first);

    vfs.loadFixture({ [id]: `module.exports = { marker: 'recovered' };` });
    loader.invalidate(id);
    const recovered = await loader.import('failing', ENTRY_ID);
    expect(recovered.default).toEqual({ marker: 'recovered' });
  });

  it('does not let a failed detached job cross coherent-invalidation generations', async () => {
    const { loader, vfs } = setup();
    const id = '/node_modules/failed-generation/index.js';
    vfs.loadFixture({
      '/node_modules/failed-generation/package.json': JSON.stringify({ main: './index.js' }),
      [id]: `
const error = new Error('v1-boom');
error.pending = import('./index.js');
throw error;
`,
    });
    let requireError: unknown;
    try {
      loader.require('failed-generation', ENTRY_ID);
    } catch (error) {
      requireError = error;
    }
    const oldJob = (requireError as { pending: Promise<Record<string, unknown>> }).pending;

    vfs.loadFixture({ [id]: `module.exports = { marker: 'v2' };` });
    loader.invalidate(id);
    const freshJob = loader.import('failed-generation', ENTRY_ID);
    const [oldError, freshNamespace] = await Promise.all([
      oldJob.catch((error: unknown) => error),
      freshJob,
    ]);

    expect(oldError).toBe(requireError);
    expect(freshNamespace.default).toEqual({ marker: 'v2' });
    expect(await loader.import('failed-generation', '/workspace/repeat.mjs')).toBe(freshNamespace);
  });

  it('keeps a failed import job separate from an intervening require generation', async () => {
    const { loader, vfs } = setup();
    const id = '/node_modules/intervening-require/index.js';
    vfs.loadFixture({
      '/node_modules/intervening-require/package.json': JSON.stringify({ main: './index.js' }),
      [id]: `
const error = new Error('old-job-boom');
error.pending = import('./index.js');
throw error;
`,
    });
    let firstError: unknown;
    try {
      loader.require('intervening-require', ENTRY_ID);
    } catch (error) {
      firstError = error;
    }
    const oldJob = (firstError as { pending: Promise<Record<string, unknown>> }).pending;

    vfs.loadFixture({ [id]: `module.exports = { marker: 'required-v2' };` });
    const nextOuter = loader.require('intervening-require', ENTRY_ID);
    const oldError = await oldJob.catch((error: unknown) => error);

    expect(nextOuter).toEqual({ marker: 'required-v2' });
    expect(oldError).toBeInstanceOf(NotImplementedError);
    expect((oldError as NotImplementedError).feature).toBe(
      'module-loader.cjs-import-job-failed-require',
    );
    expect(
      await loader.import('intervening-require', ENTRY_ID).catch((error: unknown) => error),
    ).toBe(oldError);

    loader.invalidate(id);
    const retried = await loader.import('intervening-require', ENTRY_ID);
    expect(retried.default).toEqual({ marker: 'required-v2' });
    expect(retried.default).not.toBe(nextOuter);
  });

  it('loudly rejects a self-import from failed require without re-executing source', async () => {
    const { loader, vfs } = setup();
    const id = '/node_modules/failed-require/index.js';
    const stateKey = '__riftyCjsFailedRequireRuns';
    delete (globalThis as unknown as Record<string, unknown>)[stateKey];
    vfs.loadFixture({
      '/node_modules/failed-require/package.json': JSON.stringify({ main: './index.js' }),
      [id]: `
const run = (globalThis.__riftyCjsFailedRequireRuns || 0) + 1;
globalThis.__riftyCjsFailedRequireRuns = run;
if (run === 1) {
  const error = new Error('failed-require');
  error.pending = import('./index.js');
  throw error;
}
module.exports = { run };
`,
    });
    let requireError: unknown;
    try {
      loader.require('failed-require', ENTRY_ID);
    } catch (error) {
      requireError = error;
    }
    const pending = (requireError as { pending: Promise<Record<string, unknown>> }).pending;

    const jobError = await pending.catch((error: unknown) => error);

    expect(jobError).toBeInstanceOf(NotImplementedError);
    expect((jobError as NotImplementedError).feature).toBe(
      'module-loader.cjs-import-job-failed-require',
    );
    expect(loader.require('failed-require', ENTRY_ID)).toEqual({ run: 2 });
    delete (globalThis as unknown as Record<string, unknown>)[stateKey];
  });

  it('settles an in-flight job when a detected export getter throws', async () => {
    const { loader, vfs } = setup();
    vfs.loadFixture({
      '/node_modules/getter/package.json': JSON.stringify({ main: './index.js' }),
      '/node_modules/getter/index.js': `
exports.boom = 1;
Object.defineProperty(exports, 'boom', {
  enumerable: true,
  get() { throw new Error('getter-boom'); },
});
const pending = import('./index.js');
exports.pending = () => pending;
`,
    });
    const outer = loader.require('getter', ENTRY_ID) as {
      pending: () => Promise<Record<string, unknown>>;
    };

    const namespace = await Promise.race([
      outer.pending(),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('in-flight getter import timed out')), 100);
      }),
    ]);

    expect(namespace.default).toBe(outer);
    expect(namespace.boom).toBeUndefined();
  });

  it('preserves default and marker when optional named-key reflection throws', async () => {
    const { loader, vfs } = setup();
    vfs.loadFixture({
      '/node_modules/proxy/package.json': JSON.stringify({ main: './index.js' }),
      '/node_modules/proxy/index.js': `
module.exports = new Proxy({ marker: 'proxy-outer' }, {
  ownKeys() { throw new Error('ownkeys-boom'); },
});
`,
    });
    const outer = loader.require('proxy', ENTRY_ID);
    const namespace = await loader.import('proxy', ENTRY_ID);

    expect(namespace.default).toBe(outer);
    expect(namespace['module.exports']).toBe(outer);
  });

  it('drops every record-owned namespace on full coherent invalidation', async () => {
    const { loader } = setup();
    const first = await loader.import('esbuild', ENTRY_ID);
    const sibling = await loader.import('sibling', ENTRY_ID);

    loader.invalidate();

    expect(await loader.import('esbuild', ENTRY_ID)).not.toBe(first);
    expect(await loader.import('sibling', ENTRY_ID)).not.toBe(sibling);
  });
});
