import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  SCAN_ROOTS,
  compareToAllowlist,
  countSourceAssertions,
  findSourceTextBindings,
  walkTestFiles,
} from './source-grep-ratchet.mjs';

const direct = `
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const source = readFileSync(fileURLToPath(new URL('./App.tsx', import.meta.url)), 'utf8');
it('pins', () => {
  expect(source).toContain('createSignal');
  expect(source).not.toContain('legacy');
});
it('behavioral', () => {
  expect(1 + 1).toBe(2);
});
`;

describe('source-grep detector', () => {
  it('counts direct source-binding assertions, not behavioral ones', () => {
    expect(countSourceAssertions(direct)).toBe(2);
  });

  it('tracks multi-line readFileSync bindings (fileURLToPath/new URL formatting)', () => {
    const content = `
const bootstrapSrc = readFileSync(
  fileURLToPath(new URL('./workers/real-vite-bootstrap.ts', import.meta.url)),
  'utf8',
);
expect(bootstrapSrc).toContain('serveProjectIndex(');
`;
    expect(countSourceAssertions(content)).toBe(1);
  });

  it('ignores doc reads (.md) — doc greps are not source greps', () => {
    const content = `
const compat = readFileSync(fileURLToPath(new URL('../../docs/compat/streams.md', import.meta.url)), 'utf8');
expect(compat).toContain('❌');
`;
    expect(countSourceAssertions(content)).toBe(0);
  });

  it('tracks read-helper bindings via their call sites', () => {
    const content = `
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, dir)), 'utf8');
expect(read('./node-entry-bootstrap.ts')).toContain('installBundleLocalBuffer');
expect(somethingElse).toBe(true);
`;
    const { helpers } = findSourceTextBindings(content);
    expect([...helpers]).toEqual(['read']);
    expect(countSourceAssertions(content)).toBe(1);
  });

  it('propagates derived bindings (slice/indexOf) to the count', () => {
    const content = `
const source = readFileSync(fileURLToPath(new URL('./x.ts', import.meta.url)), 'utf8');
const tail = source.slice(source.indexOf('serveProjectIndex('));
const idx = tail.indexOf('publishSnapshot');
expect(tail).toMatch(/serveProjectIndex\\(\\s*port,/);
expect(idx).toBeGreaterThan(-1);
`;
    expect(countSourceAssertions(content)).toBe(2);
  });

  it('does not taint via the readFileSync substring of unrelated words', () => {
    const content = `
const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, dir)), 'utf8');
void read('./x.ts');
expect(readFileSyncCalls).toBe(3);
`;
    expect(countSourceAssertions(content)).toBe(0);
  });
});

describe('scanner scope', () => {
  it('covers the browser-unit lane (.spec.ts) — a grep there must not bypass the gate', () => {
    expect(SCAN_ROOTS).toContain('tests/browser-unit');
    const dir = fileURLToPath(new URL('../../tests/browser-unit', import.meta.url));
    const files = [...walkTestFiles(dir)];
    expect(files.some((p) => p.endsWith('.spec.ts'))).toBe(true);
  });
});

describe('allowlist ratchet', () => {
  const allow = [{ file: 'a.test.ts', count: 3, why: 'recorded constraint' }];

  it('passes on exact match', () => {
    expect(compareToAllowlist([{ file: 'a.test.ts', count: 3 }], allow)).toEqual([]);
  });

  it('refuses a new source-grep file', () => {
    const v = compareToAllowlist(
      [
        { file: 'a.test.ts', count: 3 },
        { file: 'b.test.ts', count: 1 },
      ],
      allow,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('b.test.ts');
    expect(v[0]).toContain('NOT on the allowlist');
  });

  it('refuses count growth in an allowlisted file', () => {
    const v = compareToAllowlist([{ file: 'a.test.ts', count: 4 }], allow);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('grew 3 → 4');
  });

  it('refuses a stale allowlist after burn-down (count drop must shrink the entry)', () => {
    const v = compareToAllowlist([{ file: 'a.test.ts', count: 1 }], allow);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('dropped 3 → 1');
  });

  it('refuses an allowlisted entry whose file no longer greps at all', () => {
    const v = compareToAllowlist([{ file: 'a.test.ts', count: 0 }], allow);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain('delete the ALLOWLIST entry');
  });

  it('accepts a why-carrying residual entry at its exact count', () => {
    const residual = [{ file: 'a.test.ts', count: 3, why: 'prod-bundle wiring invisible to e2e' }];
    expect(compareToAllowlist([{ file: 'a.test.ts', count: 3 }], residual)).toEqual([]);
  });

  it('refuses a positive-count entry without a recorded why (blank counts as missing)', () => {
    for (const entry of [
      { file: 'a.test.ts', count: 3 },
      { file: 'a.test.ts', count: 3, why: '   ' },
    ]) {
      const v = compareToAllowlist([{ file: 'a.test.ts', count: 3 }], [entry]);
      expect(v).toHaveLength(1);
      expect(v[0]).toContain('without a recorded why');
    }
  });
});
