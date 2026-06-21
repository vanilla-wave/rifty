import { describe, expect, it } from 'vitest';
import { TS_LIB_URL_ENV, getTsLibUrl, loadLibDts } from './lib-dts.js';

describe('loadLibDts (Node-direct read)', () => {
  it('returns a Map of lib.*.d.ts → contents from the installed compiler', async () => {
    const libs = await loadLibDts();
    expect(libs).toBeInstanceOf(Map);
    expect(libs.size).toBeGreaterThan(0);

    // Stable structural markers from the pinned TypeScript std lib.
    const es5 = libs.get('lib.es5.d.ts');
    expect(es5, 'lib.es5.d.ts present').toBeDefined();
    expect(es5).toContain('interface Array<T>');

    const promise = libs.get('lib.es2015.promise.d.ts');
    expect(promise, 'lib.es2015.promise.d.ts present').toBeDefined();
    expect(promise).toContain('interface PromiseConstructor');

    // The default lib aggregator must be present (host's getDefaultLibFileName).
    expect(libs.has('lib.d.ts')).toBe(true);
  });

  it('memoizes — repeat calls return the same Map instance', async () => {
    const a = await loadLibDts();
    const b = await loadLibDts();
    expect(a).toBe(b);
  });
});

describe('getTsLibUrl (env-config precedence — D-004)', () => {
  it('defaults to /ts-lib/lib-bundle.json when nothing is configured', () => {
    expect(getTsLibUrl()).toBe('/ts-lib/lib-bundle.json');
  });

  it('prefers the bootstrap global over the default', () => {
    const g = globalThis as Record<string, unknown>;
    const prev = g[TS_LIB_URL_ENV];
    g[TS_LIB_URL_ENV] = 'https://cdn.example/lib-bundle.json';
    try {
      expect(getTsLibUrl()).toBe('https://cdn.example/lib-bundle.json');
    } finally {
      if (prev === undefined) delete g[TS_LIB_URL_ENV];
      else g[TS_LIB_URL_ENV] = prev;
    }
  });
});
