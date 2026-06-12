import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

declare global {
  var __riftyStackFrame: string | undefined;
  var __riftyOverlapReleaseA: (() => void) | undefined;
  var __riftyOverlapReleaseB: (() => void) | undefined;
  var __riftyOverlapFrame: string | undefined;
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function encodeVlq(value: number): string {
  let vlq = value < 0 ? ((-value << 1) | 1) >>> 0 : (value << 1) >>> 0;
  let out = '';
  do {
    let digit = vlq & 31;
    vlq >>>= 5;
    if (vlq > 0) digit |= 32;
    out += BASE64[digit] ?? '';
  } while (vlq > 0);
  return out;
}

function segment(values: readonly number[]): string {
  return values.map((value) => encodeVlq(value)).join('');
}

function mappingsForOriginalLines(originalLines: readonly number[]): string {
  let previousOriginalLine = 0;
  return originalLines
    .map((line) => {
      const originalLine = line - 1;
      const out = segment([0, 0, originalLine - previousOriginalLine, 0]);
      previousOriginalLine = originalLine;
      return out;
    })
    .join(';');
}

function withInlineMap(code: string, source: string, originalLines: readonly number[]): string {
  const sourceMapMarker = 'sourceMappingURL';
  const map = {
    version: 3,
    sources: ['main.ts'],
    sourcesContent: [source],
    names: [],
    mappings: mappingsForOriginalLines(originalLines),
  };
  return `${code}\n//# ${sourceMapMarker}=data:application/json;base64,${Buffer.from(
    JSON.stringify(map),
  ).toString('base64')}`;
}

function callRelease(release: (() => void) | undefined): void {
  if (!release) throw new Error('overlap release callback was not installed');
  release();
}

describe('module loader source-map stack remapping', () => {
  it('remaps escaping errors after import/export rewrites shift generated lines', async () => {
    const source = [
      'import { dep } from "./dep.js";',
      'export const value: number = dep;',
      '',
      '',
      'throw new Error("boom");',
    ].join('\n');
    const transformed = [
      'import { dep } from "./dep.js";',
      'export const value = dep;',
      '',
      '',
      'throw new Error("boom");',
    ].join('\n');

    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/dep.js': 'export const dep = 1;\n',
      '/work/main.ts': source,
    });
    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      transformSource: async () => withInlineMap(transformed, source, [1, 2, 3, 4, 5]),
    });

    await expect(loader.import('./main.ts', '/work/__entry__.ts')).rejects.toThrow(/boom/);
    try {
      await loader.import('./main.ts', '/work/__entry__.ts');
    } catch (err) {
      const frame = (err as Error).stack?.match(/\/work\/main\.ts:\d+:\d+/)?.[0] ?? 'missing';
      expect(frame).toBe('/work/main.ts:5:1');
    }
  });

  it('materializes escaping errors only once under the stack hook', async () => {
    const source = [
      'const before: number = 1;',
      'const stillBefore: number = 2;',
      'const mappedElsewhere: number = 3;',
      'const alsoBefore: number = 4;',
      'throw new Error("boom");',
      'const wrongTarget: number = 5;',
    ].join('\n');
    const transformed = [
      'const before = 1;',
      'const stillBefore = 2;',
      'throw new Error("boom");',
      'const alsoBefore = 4;',
      'const wrongTarget = 5;',
      'const after = 6;',
    ].join('\n');

    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/main.ts': source,
    });
    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      transformSource: async () => withInlineMap(transformed, source, [1, 2, 5, 4, 9, 6]),
    });

    try {
      await loader.import('./main.ts', '/work/__entry__.ts');
    } catch (err) {
      const frame = (err as Error).stack?.match(/\/work\/main\.ts:\d+:\d+/)?.[0] ?? 'missing';
      expect(frame).toBe('/work/main.ts:5:1');
    }
  });

  it('keeps the stack hook overlap-safe for concurrent mapped module execution', async () => {
    globalThis.__riftyOverlapReleaseA = undefined;
    globalThis.__riftyOverlapReleaseB = undefined;
    globalThis.__riftyOverlapFrame = undefined;

    const sourceA = [
      'await globalThis.__riftyOverlapReleaseA;',
      'try {',
      '  throw new Error("a");',
      '} catch (err) {',
      '  globalThis.__riftyOverlapFrame = String((err as Error).stack).match(/\\/work\\/a\\.ts:\\d+:\\d+/)?.[0] ?? "missing";',
      '}',
    ].join('\n');
    const transformedA = [
      'await new Promise((resolve) => { globalThis.__riftyOverlapReleaseA = resolve; });',
      'try {',
      '  throw new Error("a");',
      '} catch (err) {',
      '  globalThis.__riftyOverlapFrame = String(err.stack).match(/\\/work\\/a\\.ts:\\d+:\\d+/)?.[0] ?? "missing";',
      '}',
    ].join('\n');
    const sourceB = 'await globalThis.__riftyOverlapReleaseB;\nexport const done = true;\n';
    const transformedB =
      'await new Promise((resolve) => { globalThis.__riftyOverlapReleaseB = resolve; });\nexport const done = true;\n';

    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/a.ts': sourceA,
      '/work/b.ts': sourceB,
    });
    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      transformSource: async (req) =>
        req.id.endsWith('/a.ts')
          ? withInlineMap(transformedA, sourceA, [1, 2, 3, 4, 5, 6])
          : withInlineMap(transformedB, sourceB, [1, 2]),
    });

    const firstPrepareStackTrace = Error.prepareStackTrace;
    const bImport = loader.import('./b.ts', '/work/__entry__.ts');
    await Promise.resolve();
    const aImport = loader.import('./a.ts', '/work/__entry__.ts');
    await Promise.resolve();
    callRelease(globalThis.__riftyOverlapReleaseB);
    await bImport;
    callRelease(globalThis.__riftyOverlapReleaseA);
    await aImport;

    expect(globalThis.__riftyOverlapFrame).toBe('/work/a.ts:3:1');
    expect(Error.prepareStackTrace).toBe(firstPrepareStackTrace);
    globalThis.__riftyOverlapReleaseA = undefined;
    globalThis.__riftyOverlapReleaseB = undefined;
    globalThis.__riftyOverlapFrame = undefined;
  });

  it('remaps stack reads inside transformed TypeScript guests', async () => {
    const source = [
      'try {',
      '  const typed: number = 1;',
      '',
      '',
      '  throw new Error("boom");',
      '} catch (err) {',
      '  // stack read happens inside the guest, before the loader sees a throw.',
      '}',
    ].join('\n');
    const transformed = [
      'try {',
      '  const typed = 1;',
      '  throw new Error("boom");',
      '} catch (err) {',
      '  const stack = err instanceof Error ? err.stack : String(err);',
      '  const frame = String(stack).match(/\\/work\\/main\\.ts:\\d+:\\d+/)?.[0] ?? "missing";',
      '  globalThis.__riftyStackFrame = frame;',
      '}',
    ].join('\n');

    const vfs = new MemoryFsSync();
    vfs.loadFixture({
      '/work/package.json': JSON.stringify({ type: 'module' }),
      '/work/main.ts': source,
    });
    globalThis.__riftyStackFrame = undefined;

    const loader = createModuleLoader(vfs, {
      cwd: '/work',
      transformSource: async () => withInlineMap(transformed, source, [1, 2, 5, 6, 6, 6, 6, 8]),
    });

    await loader.import('./main.ts', '/work/__entry__.ts');

    expect(globalThis.__riftyStackFrame).toBe('/work/main.ts:5:1');
    globalThis.__riftyStackFrame = undefined;
  });
});
