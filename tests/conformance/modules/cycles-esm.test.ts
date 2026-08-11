import { createModuleLoader } from '@riftydev/runtime-js/loader';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';

function setup(files: Record<string, string>) {
  const vfs = new MemoryFsSync();
  vfs.loadFixture(files);
  return createModuleLoader(vfs);
}

describe('ESM cycles', () => {
  it('handles a simple A→B→A cycle (eventual values stable)', async () => {
    const loader = setup({
      '/a.mjs':
        "import { fromB, readA } from './b.mjs'; export let fromA = 'a'; export const observedB = fromB; export { readA };",
      '/b.mjs':
        "import { fromA } from './a.mjs'; export const fromB = 'b'; export function readA() { return fromA; }",
    });
    const a = await loader.import('./a.mjs', '/entry.mjs');
    expect(a.fromA).toBe('a');
    expect(a.observedB).toBe('b');
    expect((a.readA as () => string)()).toBe('a');
  });
});

// A module re-exporting its OWN namespace: `export * as Self from "."`. This is
// a common opencode idiom (effect-drizzle-sqlite/index.ts, core/database.ts,
// core/database/migration.ts). The self-namespace must reflect ALL of the
// module's exports — including names merged in by a sibling `export * from
// "./driver"` — and `Self.Self` must be the same object (`===`). Verified against
// Node 24: `Self` = sorted `['Self','local','makeWithDefaults']`. Regression for
// the rebuildExports-reallocation bug (the self spec captured the initial empty
// exports object at preload; reallocating left it frozen-empty). Plain `.mjs`
// (no TS transform) isolates this as pure ESM-namespace semantics.
describe('ESM self-referential namespace re-export', () => {
  it('`export * as Self from "."` reflects sibling `export *` names + own exports, Self.Self === Self', async () => {
    const loader = setup({
      '/app/driver.mjs': 'export const makeWithDefaults = () => "ok";',
      '/app/index.mjs':
        'export * from "./driver.mjs";\nexport const local = 1;\nexport * as Self from ".";',
      '/app/consumer.mjs':
        'import { Self } from "./index.mjs";\n' +
        'export const made = Self.makeWithDefaults();\n' +
        'export const localViaSelf = Self.local;\n' +
        'export const selfIsSelf = Self.Self === Self;\n' +
        'export const keys = Object.keys(Self).sort();',
    });
    const ns = await loader.import('/app/consumer.mjs', '/app/__entry__.mjs');
    expect(ns.made).toBe('ok');
    expect(ns.localViaSelf).toBe(1);
    expect(ns.selfIsSelf).toBe(true);
    expect(ns.keys).toEqual(['Self', 'local', 'makeWithDefaults']);
  });

  it('the explicit `./index.mjs` self form behaves identically to `."`', async () => {
    const loader = setup({
      '/app/driver.mjs': 'export const makeWithDefaults = () => "ok";',
      '/app/index.mjs': 'export * from "./driver.mjs";\nexport * as Self from "./index.mjs";',
      '/app/consumer.mjs':
        'import { Self } from "./index.mjs"; export const got = typeof Self.makeWithDefaults;',
    });
    const ns = await loader.import('/app/consumer.mjs', '/app/__entry__.mjs');
    expect(ns.got).toBe('function');
  });
});
