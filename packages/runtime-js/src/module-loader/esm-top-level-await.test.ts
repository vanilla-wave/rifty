import { describe, expect, it } from 'vitest';
import { transformEsm } from './esm-ast.ts';

describe('ESM top-level await metadata', () => {
  it('finds direct await and for-await', () => {
    expect(transformEsm('await Promise.resolve();', '/direct.mjs').hasTopLevelAwait).toBe(true);
    expect(
      transformEsm('for await (const value of values) consume(value);', '/for-await.mjs')
        .hasTopLevelAwait,
    ).toBe(true);
  });

  it('excludes nested function bodies', () => {
    expect(
      transformEsm('export async function later() { await Promise.resolve(); }', '/nested.mjs')
        .hasTopLevelAwait,
    ).toBe(false);
  });

  it('includes class definition expressions but excludes method bodies', () => {
    expect(
      transformEsm("class Example { [await Promise.resolve('key')]() {} }", '/class-key.mjs')
        .hasTopLevelAwait,
    ).toBe(true);
    expect(
      transformEsm('class Example { async method() { await Promise.resolve(); } }', '/method.mjs')
        .hasTopLevelAwait,
    ).toBe(false);
  });
});
