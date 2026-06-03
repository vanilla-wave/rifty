import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
/**
 * End-to-end through the loader: code uses `require('node:path')`/`import`
 * to access built-ins. This is the actual user surface — the unit tests
 * import the modules directly, while these tests prove the loader plumbing.
 */
import { describe, expect, it } from 'vitest';

function loader(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('built-ins via loader', () => {
  it('require("node:path") gives the path module', () => {
    const l = loader({
      '/app/m.js': "module.exports = require('node:path').join('/a', 'b', 'c');",
    });
    expect(l.require('./m.js', '/app/entry.js')).toBe('/a/b/c');
  });

  it('require("path") (no node: prefix) also works', () => {
    const l = loader({
      '/app/m.js': "module.exports = require('path').join('/x', 'y');",
    });
    expect(l.require('./m.js', '/app/entry.js')).toBe('/x/y');
  });

  it('import path from "node:path" via ESM', async () => {
    const l = loader({
      '/app/m.mjs': "import path from 'node:path'; export const v = path.join('/x','y');",
    });
    const ns = await l.import('./m.mjs', '/app/entry.mjs');
    expect(ns.v).toBe('/x/y');
  });

  it('import { join } from "node:path" — named binding', async () => {
    const l = loader({
      '/app/m.mjs': "import { join } from 'node:path'; export const v = join('a','b');",
    });
    const ns = await l.import('./m.mjs', '/app/entry.mjs');
    expect(ns.v).toBe('a/b');
  });

  it('require("events") gives EventEmitter constructor', () => {
    const l = loader({
      '/app/m.js':
        "const EventEmitter = require('events'); const e = new EventEmitter(); let v; e.on('x', n => v = n); e.emit('x', 5); module.exports = v;",
    });
    expect(l.require('./m.js', '/app/entry.js')).toBe(5);
  });

  it('require("node:buffer") gives Buffer', () => {
    const l = loader({
      '/app/m.js': "module.exports = require('node:buffer').Buffer.from('hi').toString();",
    });
    expect(l.require('./m.js', '/app/entry.js')).toBe('hi');
  });

  it('require("node:assert") works', () => {
    const l = loader({
      '/app/m.js':
        "const assert = require('node:assert'); assert.strictEqual(1, 1); module.exports = 'ok';",
    });
    expect(l.require('./m.js', '/app/entry.js')).toBe('ok');
  });
});
