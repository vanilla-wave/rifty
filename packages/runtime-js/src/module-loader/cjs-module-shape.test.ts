/**
 * `provenance-lie` × guest-visible module object. ADR-0325 makes one registry
 * record the CJS module Node code receives, which is right for identity — but
 * the record also carries the loader's own bookkeeping. Enumerating them puts
 * fields Node has never had (`kind`, `state`, `slots`) into
 * `Object.keys(module)`, so packages that copy, serialize, or diff `module`
 * see rifty internals instead of Node's shape.
 *
 * Node 24 own enumerable keys: id, path, exports, filename, loaded, children,
 * paths (`parent` is an inherited accessor, not an own key).
 */
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const NODE_MODULE_KEYS = ['id', 'path', 'exports', 'filename', 'loaded', 'children', 'paths'];

function setup() {
  const vfs = new MemoryFsSync();
  vfs.loadFixture({
    '/workspace/keys.js': 'module.exports = Object.keys(module);',
    '/workspace/broken.js': 'throw new Error("load failed");',
    '/workspace/keys-after-failure.js': `
try { require('./broken.js'); } catch { /* the failed record is unlinked */ }
module.exports = Object.keys(module);
`,
  });
  return createModuleLoader(vfs, { cwd: '/workspace' });
}

describe('CJS module object — Node shape, loader internals private', () => {
  it('exposes exactly the own enumerable keys Node exposes', async () => {
    const loader = setup();

    const keys = (await loader.import('/workspace/keys.js')).default as string[];

    expect([...keys].sort()).toEqual([...NODE_MODULE_KEYS].sort());
  });

  it('keeps loader bookkeeping off the guest object after a failed child load', async () => {
    const loader = setup();

    const keys = (await loader.import('/workspace/keys-after-failure.js')).default as string[];

    expect(keys).not.toContain('error');
    expect(keys).not.toContain('state');
  });
});
