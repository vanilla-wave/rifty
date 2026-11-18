/**
 * `node:zlib` ceiling reasons — rifty's own `NotImplementedError(feature, hint)`
 * convention, not Node parity (Node runs these). Every export that throws names
 * its working async alternative, or states there is none. Observed defect: no-COI
 * office-docs pdf t1/t3 agents read `Not implemented: zlib.inflateSync` as "zlib is
 * not implemented" and never tried the working async `zlib.inflate`.
 *
 * `CEILINGS` is the closed list: the completeness case derives the module's actual
 * throwing exports and compares, so a new or changed ceiling cannot slip past it.
 */
import nodeZlib from 'node:zlib';
import { MemoryFsSync, resetSyncMirror, setSyncMirror } from '@riftydev/vfs/internal';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBuiltin } from '../../../packages/io/src/builtin-registry.ts';
import { ensureRuntimeJsBuiltinsRegistered } from '../../../packages/runtime-js/src/builtins/index.ts';
import { runNodeEntry } from '../../../packages/runtime-js/src/builtins/node-entry.ts';
import { resetKeepalive } from '../../../packages/runtime-js/src/internal/event-loop-keepalive.ts';

type OneShot = 'gzip' | 'gunzip' | 'deflate' | 'inflate' | 'deflateRaw' | 'inflateRaw';
/** The working async alternative a row's message names; `by-header` = gunzip or inflate. */
type Alternative = OneShot | 'by-header' | 'none';

const call = (fn: OneShot): string =>
  `zlib.${fn}(buf, cb) or await util.promisify(zlib.${fn})(buf)`;
const BY_HEADER =
  'pick by header: gzip input (starts 1f 8b) → async zlib.gunzip, else → async zlib.inflate; both take (buf, cb) and work with util.promisify';
const sync = (fn: OneShot): string =>
  `sync zlib not implemented yet; async zlib.${fn} works: ${call(fn)}`;
const stream = (fn: OneShot): string =>
  `this stream not implemented yet; buffer the input, then call async zlib.${fn}: ${call(fn)}`;
const none = (codec: string): string =>
  `${codec} not implemented yet; node:zlib has no working alternative`;

const CEILINGS: Readonly<Record<string, readonly [Alternative, string]>> = Object.freeze({
  gzipSync: ['gzip', sync('gzip')],
  gunzipSync: ['gunzip', sync('gunzip')],
  deflateSync: ['deflate', sync('deflate')],
  inflateSync: ['inflate', sync('inflate')],
  deflateRawSync: ['deflateRaw', sync('deflateRaw')],
  inflateRawSync: ['inflateRaw', sync('inflateRaw')],

  unzip: ['by-header', `gzip/zlib auto-detect not implemented yet; ${BY_HEADER}`],
  unzipSync: ['by-header', `sync zlib not implemented yet; ${BY_HEADER}`],

  brotliCompress: ['none', none('brotli')],
  brotliCompressSync: ['none', none('brotli')],
  brotliDecompress: ['none', none('brotli')],
  brotliDecompressSync: ['none', none('brotli')],
  zstdCompress: ['none', none('zstd')],
  zstdCompressSync: ['none', none('zstd')],
  zstdDecompress: ['none', none('zstd')],
  zstdDecompressSync: ['none', none('zstd')],
  crc32: ['none', none('crc32')],

  createGunzip: ['gunzip', stream('gunzip')],
  createDeflate: ['deflate', stream('deflate')],
  createInflate: ['inflate', stream('inflate')],
  createDeflateRaw: ['deflateRaw', stream('deflateRaw')],
  createInflateRaw: ['inflateRaw', stream('inflateRaw')],
  createUnzip: [
    'by-header',
    `this stream not implemented yet; buffer the input, then ${BY_HEADER}`,
  ],
  createBrotliCompress: ['none', none('brotli')],
  createBrotliDecompress: ['none', none('brotli')],
  createZstdCompress: ['none', none('zstd')],
  createZstdDecompress: ['none', none('zstd')],

  Gunzip: ['gunzip', stream('gunzip')],
  Deflate: ['deflate', stream('deflate')],
  Inflate: ['inflate', stream('inflate')],
  DeflateRaw: ['deflateRaw', stream('deflateRaw')],
  InflateRaw: ['inflateRaw', stream('inflateRaw')],
  Unzip: ['by-header', `this stream not implemented yet; buffer the input, then ${BY_HEADER}`],
  BrotliCompress: ['none', none('brotli')],
  BrotliDecompress: ['none', none('brotli')],
  ZstdCompress: ['none', none('zstd')],
  ZstdDecompress: ['none', none('zstd')],
});

/** Function exports that run instead of throwing; with CEILINGS, all 45 (= Node 24.16's 45). */
const WORKING = [
  'gzip',
  'gunzip',
  'deflate',
  'inflate',
  'deflateRaw',
  'inflateRaw',
  'createGzip',
  'Gzip',
];

ensureRuntimeJsBuiltinsRegistered();
const zlib = loadBuiltin('node:zlib') as Record<string, unknown>;
// The guest's own util.promisify — the one the messages tell a guest to call.
const { promisify } = loadBuiltin('node:util') as {
  promisify: typeof import('node:util').promisify;
};

function isNotImplemented(error: unknown): error is Error & { feature: string } {
  return error instanceof Error && error.name === 'NotImplementedError';
}

/** Argument shapes probed: none, and a valid one-shot `(buf, cb)` call. */
const PROBE_ARGS: ReadonlyArray<readonly unknown[]> = [[], [Buffer.from('x'), () => {}]];

/** The `NotImplementedError`s an export throws, called and constructed, per probe. */
function ceilingErrors(value: unknown): Array<Error & { feature: string }> {
  if (typeof value !== 'function') return [];
  const fn = value as (...args: unknown[]) => unknown;
  const errors: Array<Error & { feature: string }> = [];
  for (const args of PROBE_ARGS) {
    for (const invoke of [
      () => Reflect.apply(fn, undefined, args),
      () => Reflect.construct(fn, args),
    ]) {
      try {
        const made = invoke() as { destroy?: () => void } | undefined;
        made?.destroy?.();
      } catch (error) {
        if (isNotImplemented(error)) errors.push(error);
      }
    }
  }
  return errors;
}

describe('node:zlib ceilings — the closed list matches the module', () => {
  it('every throwing export is a CEILINGS row, every row throws, the rest run', () => {
    const exported = Reflect.ownKeys(zlib).filter(
      (key): key is string => typeof key === 'string' && typeof zlib[key] === 'function',
    );
    const throwing = exported.filter((key) => ceilingErrors(zlib[key]).length > 0);
    expect(throwing.sort()).toEqual(Object.keys(CEILINGS).sort());
    expect(exported.filter((key) => !throwing.includes(key)).sort()).toEqual([...WORKING].sort());
  });
});

describe('node:zlib ceilings — the message names the async alternative or states none', () => {
  for (const [name, [alternative, reason]] of Object.entries(CEILINGS)) {
    it(`${name} → ${alternative}`, () => {
      const errors = ceilingErrors(zlib[name]);
      expect(errors.length).toBeGreaterThan(0);
      for (const error of errors) {
        expect(error.feature).toBe(`zlib.${name}`);
        expect(error.message).toBe(`Not implemented: zlib.${name} (${reason})`);
        if (alternative === 'none') {
          expect(error.message).toContain('no working alternative');
        } else {
          for (const fn of alternative === 'by-header' ? ['gunzip', 'inflate'] : [alternative]) {
            expect(error.message).toContain(`zlib.${fn}`);
          }
          expect(error.message).toContain('util.promisify');
        }
      }
    });
  }
});

describe('node:zlib ceilings — every named alternative works on the same module', () => {
  const text = 'BT /F1 12 Tf (Invoice number 42) Tj ET '.repeat(20);
  const encoded: Record<OneShot, (data: Buffer) => Buffer> = {
    gzip: nodeZlib.gunzipSync,
    deflate: nodeZlib.inflateSync,
    deflateRaw: nodeZlib.inflateRawSync,
    gunzip: nodeZlib.gzipSync,
    inflate: nodeZlib.deflateSync,
    inflateRaw: nodeZlib.deflateRawSync,
  };
  const named = new Set(
    Object.values(CEILINGS).flatMap(([alternative]) =>
      alternative === 'none'
        ? []
        : alternative === 'by-header'
          ? ['gunzip', 'inflate']
          : [alternative],
    ),
  ) as Set<OneShot>;

  for (const fn of named) {
    it(`guest util.promisify(zlib.${fn}) round-trips with real Node zlib`, async () => {
      const run = promisify(
        zlib[fn] as (data: Buffer, cb: (e: Error | null, r: Buffer) => void) => void,
      );
      const compressing = fn === 'gzip' || fn === 'deflate' || fn === 'deflateRaw';
      const output = compressing
        ? encoded[fn](Buffer.from(await run(Buffer.from(text))))
        : Buffer.from(await run(encoded[fn](Buffer.from(text))));
      expect(output.toString()).toBe(text);
    });
  }
});

describe('node:zlib ceilings — the pdf t1 command sees the reason', () => {
  afterEach(() => {
    resetSyncMirror();
    resetKeepalive();
  });

  it('node -e inflateSync over a FlateDecode stream throws the reasoned ceiling', async () => {
    // pdf/t1 trace: `node -e '…b=z.inflateSync(Buffer.from(m[1],"latin1"))…'` →
    // stderr `node: Not implemented: zlib.inflateSync`; Node exits 0 (contrast-native.json).
    // Path made absolute: this harness has no guest cwd.
    const vfs = new MemoryFsSync();
    setSyncMirror(vfs);
    const content = nodeZlib.deflateSync(Buffer.from('BT /F1 20 Tf (Kestrel Supply Co.) Tj ET'));
    vfs.mkdirSync('/work/attachments', { recursive: true });
    vfs.writeFileSync(
      '/work/attachments/invoice.pdf',
      Buffer.concat([
        Buffer.from('%PDF-1.4\n4 0 obj\n<< /Filter /FlateDecode >>\nstream\n', 'latin1'),
        content,
        Buffer.from('\nendstream\nendobj\n%%EOF\n', 'latin1'),
      ]),
    );
    const source =
      'const fs=require("fs"),z=require("zlib");let s=fs.readFileSync("/work/attachments/invoice.pdf").toString("latin1"),m=s.match(/stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream/),b=z.inflateSync(Buffer.from(m[1],"latin1"));console.log(b.toString("latin1"))';
    let thrown: unknown;
    try {
      await runNodeEntry({
        kind: 'eval',
        vfs,
        cwd: '/work',
        source,
        print: false,
        explicitCommonJs: false,
      });
    } catch (error) {
      thrown = error;
    }
    expect(isNotImplemented(thrown)).toBe(true);
    expect((thrown as Error).message).toBe(
      `Not implemented: zlib.inflateSync (${CEILINGS.inflateSync?.[1]})`,
    );
  });
});
