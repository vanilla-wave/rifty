import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** Vite host emits the sql.js WASM; @riftydev/net owns the matching JS glue. */
describe('sql.js glue/wasm version pairing', () => {
  it('playground host and @riftydev/net declare the same sql.js range', () => {
    const read = (relative: string): { dependencies?: Record<string, string> } =>
      JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8'));
    const playground = read('../../package.json');
    const net = read('../../../../packages/net/package.json');
    expect(playground.dependencies?.['sql.js']).toBeDefined();
    expect(playground.dependencies?.['sql.js']).toBe(net.dependencies?.['sql.js']);
  });
});
