import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The wasm BINARY ships from the playground's sql.js copy
 * (`sql.js/dist/sql-wasm.wasm?url` in glue/sqlite-wasm-provider.ts) while the JS
 * glue executing it ships from @riftydev/net's copy (the `node:sqlite`
 * engine). Nothing else enforces the pairing — a one-sided bump silently runs
 * mismatched glue+wasm. Pin the declared ranges equal.
 */
describe('sql.js glue/wasm version pairing', () => {
  it('playground and @riftydev/net declare the same sql.js range', () => {
    const read = (rel: string): { dependencies?: Record<string, string> } =>
      JSON.parse(readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8'));
    const playground = read('../../package.json');
    const net = read('../../../../packages/net/package.json');
    expect(playground.dependencies?.['sql.js']).toBeDefined();
    expect(playground.dependencies?.['sql.js']).toBe(net.dependencies?.['sql.js']);
  });
});
