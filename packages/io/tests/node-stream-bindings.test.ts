/**
 * Stream core 8a bindings (`src/streams/node/bindings.ts`, ADR-0575 §2) against Node v24.16.0's own
 * (a child with `--expose-internals`): every primordial the core reads is Node's value, or built as
 * Node builds it (same name and length); the zlib constants and the StreamBase indices are Node's
 * binding data; the tables bind exactly the ids the generated core reads. Behaviour: the
 * differential (tests/integration/node-streams-differential.test.ts).
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { boundIds } from '../src/streams/node/bindings.ts';
import { BINDINGS, INTERNAL_BINDINGS } from '../src/streams/node/generated/node-streams.js';
import { ZLIB_CONSTANTS } from '../src/streams/node/zlib-constants.ts';

const here = dirname(fileURLToPath(import.meta.url));
const tsx = createRequire(import.meta.url).resolve('tsx');
interface Shape {
  readonly type: string;
  readonly name?: string;
  readonly length?: number;
}
const probe = JSON.parse(
  execFileSync(
    process.execPath,
    [
      '--expose-internals',
      '--import',
      tsx,
      join(here, 'fixtures/node-stream-bindings-vs-node.mts'),
    ],
    { encoding: 'utf8' },
  ),
) as {
  rows: { name: string; identical: boolean; rifty: Shape; node: Shape }[];
  extra: string[];
  zlib: [string, string][];
  streamWrap: Record<string, number>;
  streamBaseStateLength: number;
  uvEof: number;
};

describe('stream core bindings = Node v24.16.0 bindings', () => {
  it("each primordial: Node's own value, or Node's construction (name, length)", () => {
    const off = probe.rows
      .filter((r) => !r.identical && JSON.stringify(r.rifty) !== JSON.stringify(r.node))
      .map((r) => `${r.name}: rifty ${JSON.stringify(r.rifty)}, Node ${JSON.stringify(r.node)}`);
    expect(off).toEqual([]);
    expect(probe.rows.length).toBe(79);
    // Values Node keeps as the intrinsic itself are the same object here (one realm).
    expect(probe.rows.filter((r) => r.identical).length).toBe(43);
    // The bindings' own extra read is Node's too.
    expect(probe.extra).toEqual(['TypedArrayPrototypeGetSymbolToStringTag']);
  });

  it("internalBinding('constants').zlib: Node's table, key order included", () => {
    expect(Object.entries(ZLIB_CONSTANTS).map(([k, v]) => [k, String(v)])).toEqual(probe.zlib);
  });

  it("internalBinding('stream_wrap') indices and 'uv'.UV_EOF: Node's", () => {
    expect(probe.streamWrap).toEqual({
      kReadBytesOrError: 0,
      kArrayBufferOffset: 1,
      kBytesWritten: 2,
      kLastWriteWasAsync: 3,
    });
    expect(probe.streamBaseStateLength).toBe(4);
    expect(probe.uvEof).toBe(-4095);
  });

  it('the tables bind exactly the ids the generated core reads', () => {
    expect(boundIds()).toEqual({
      modules: [...BINDINGS].sort(),
      internalBindings: [...INTERNAL_BINDINGS].sort(),
    });
  });
});
