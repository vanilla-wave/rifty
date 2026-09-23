import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModuleLoader } from '../../module-loader/loader.ts';
import { runInThisContext } from './index.ts';

// Unit runtime-js/vm-run-in-this-context-offsets, fault matrix: the
// `Error.prepareStackTrace` slot has several writers — guest code, the
// ADR-0136 source-map window (module-loader/source-maps.ts) and the vm offset
// projection. Each row drives one writer interleaving and asserts the honest
// outcome. The offset frame oracle is Node v24.16.0 (evidence §P1 row N and
// parity case vm/run-in-this-context-offsets `deferred-line2`).

declare global {
  var __riftyOffsetFrames: string[] | undefined;
  var __riftyOffsetInner: (() => void) | undefined;
  var __riftyOffsetEvaluate: (() => void) | undefined;
}

const LATE_SOURCE = '(function outer() {\n  return function inner() { throw new Error("late") } })';
const LATE_OPTIONS = { filename: '/virtual/late.js', lineOffset: 2, columnOffset: -4 };
const LATE_FRAME = '/virtual/late.js:4:35';

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

/** Identity line map: generated line N → original line N, column 0. */
function withIdentityInlineMap(code: string): string {
  const lines = code.split('\n').length;
  const mappings = Array.from({ length: lines }, (_, index) =>
    [0, 0, index === 0 ? 0 : 1, 0].map(encodeVlq).join(''),
  ).join(';');
  const map = { version: 3, sources: ['m.ts'], sourcesContent: [code], names: [], mappings };
  const marker = 'sourceMappingURL';
  return `${code}\n//# ${marker}=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}`;
}

/** A mapped module whose top level records its own remapped frame and the offset frame. */
function mappedModule(name: string, evaluateFirst: boolean): string {
  return [
    evaluateFirst ? 'globalThis.__riftyOffsetEvaluate();' : 'void 0;',
    'try {',
    `  throw new Error("${name}");`,
    '} catch (err) {',
    `  globalThis.__riftyOffsetFrames.push(String(err.stack).match(/\\/work\\/${name}\\.ts:\\d+:\\d+/)?.[0] ?? "missing");`,
    '}',
    'try { globalThis.__riftyOffsetInner(); } catch (err) {',
    '  globalThis.__riftyOffsetFrames.push(String(err.stack).match(/\\/virtual\\/late\\.js(?::-?\\d+){0,2}/)?.[0] ?? "missing");',
    '}',
  ].join('\n');
}

function lateInner(): () => void {
  const outer = runInThisContext(LATE_SOURCE, LATE_OPTIONS) as () => () => void;
  return outer();
}

function lateFrame(fn: () => void): string {
  try {
    fn();
  } catch (error) {
    return (
      /\/virtual\/late\.js(?::-?\d+){0,2}/.exec(String((error as Error).stack))?.[0] ?? 'missing'
    );
  }
  return 'no-throw';
}

function loaderFor(names: readonly string[], evaluateFirst: boolean) {
  const vfs = new MemoryFsSync();
  const sources = new Map(
    names.map((name) => [`/work/${name}.ts`, mappedModule(name, evaluateFirst)]),
  );
  vfs.loadFixture({
    '/work/package.json': JSON.stringify({ type: 'module' }),
    ...Object.fromEntries(sources),
  });
  return createModuleLoader(vfs, {
    cwd: '/work',
    transformSource: async (req) => {
      const source = sources.get(req.id);
      if (source === undefined) throw new Error(`unexpected transform ${req.id}`);
      return withIdentityInlineMap(source);
    },
  });
}

let savedHook: PropertyDescriptor | undefined;

beforeEach(() => {
  savedHook = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  globalThis.__riftyOffsetFrames = [];
});

afterEach(() => {
  if (savedHook) Object.defineProperty(Error, 'prepareStackTrace', savedHook);
  else Reflect.deleteProperty(Error, 'prepareStackTrace');
  globalThis.__riftyOffsetFrames = undefined;
  globalThis.__riftyOffsetInner = undefined;
  globalThis.__riftyOffsetEvaluate = undefined;
});

describe('vm offset projection shares the stack hook slot', () => {
  it('source-map windows opened after an offset script keep both remaps and restore the hook they found', async () => {
    globalThis.__riftyOffsetInner = lateInner();
    const before = Error.prepareStackTrace;
    const loader = loaderFor(['a', 'b'], false);

    await loader.import('./a.ts', '/work/__entry__.ts');
    await loader.import('./b.ts', '/work/__entry__.ts');

    expect(globalThis.__riftyOffsetFrames).toEqual([
      '/work/a.ts:3:1',
      LATE_FRAME,
      '/work/b.ts:3:1',
      LATE_FRAME,
    ]);
    expect(Error.prepareStackTrace).toBe(before);
    expect(lateFrame(globalThis.__riftyOffsetInner)).toBe(LATE_FRAME);
  });

  it('an offset script first evaluated inside a source-map window keeps projecting after the window closes', async () => {
    globalThis.__riftyOffsetEvaluate = () => {
      globalThis.__riftyOffsetInner = lateInner();
    };
    const loader = loaderFor(['a'], true);

    await loader.import('./a.ts', '/work/__entry__.ts');

    expect(globalThis.__riftyOffsetFrames).toEqual(['/work/a.ts:3:1', LATE_FRAME]);
    const inner = globalThis.__riftyOffsetInner;
    if (!inner) throw new Error('offset script was not evaluated');
    expect(lateFrame(inner)).toBe(LATE_FRAME);
  });

  it('a formatter that bypasses the hook never shows a plausible wrong position; the next offset script projects again', () => {
    const inner = lateInner();
    Reflect.deleteProperty(Error, 'prepareStackTrace');

    let bypassed = '';
    try {
      inner();
    } catch (error) {
      bypassed = String((error as Error).stack);
    }
    // Unshifted `/virtual/late.js:2:39` would be a provenance lie.
    expect(bypassed).toContain('Error: late');
    expect(bypassed).not.toMatch(/\/virtual\/late\.js:\d/);

    runInThisContext('0', { filename: '/virtual/reinstall.js', lineOffset: 1 });
    expect(lateFrame(inner)).toBe(LATE_FRAME);
  });
});
