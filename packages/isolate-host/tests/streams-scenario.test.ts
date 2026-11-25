/**
 * node-streams goal carrier (docs/backlog/epics/node-streams-as-in-node/map.md item 0), isolate
 * host: each `c-*` program run by its own sandbox (`exec`) over the same files as live
 * `node <program>` on this runner, the oracle run per case too, so no case reads another's state.
 * Today's outcome is pinned whole (exit code, stdout, the whole stderr, the written files); the
 * owning unit replaces its pin with Node's. Browser-host twins: tests/browser-unit, tests/no-coi
 * `streams-scenario.spec.ts`.
 */
import { describe, expect, it } from 'vitest';
import { inSandboxWritten } from './package-closure.ts';
import {
  CARRIER,
  type Program,
  inNode,
  isWritten,
  manifestOf,
  programFile,
  verdict,
  workspace,
} from './streams-scenario.ts';
import { type Observed, type Pin, pinOf } from './zlib-scenario.ts';

const NO_RS =
  'NotImplementedError: Not implemented: isolate-host.ReadableStream (not available in the rifty isolate host, ADR-0557)';
/** Measured on main c2250727d: the whole stderr, no mask (the isolate's paths are `/workspace/…`). A guard has none. */
const PINS: Readonly<Record<string, Pin>> = {
  'c-xlsx-roundtrip': {
    exitCode: 0,
    stdout: `writeBuffer ok 
readFile threw TypeError: stream.close is not a function
`,
    stderr: '',
    output: `in.xlsx values [["Revenue",[[null,"Region","Revenue"],[null,"North",120],[null,"South",95]]]]
`,
  },
  'c-csv-read': {
    exitCode: 0,
    stdout: `csv threw ${NO_RS}
`,
    stderr: '',
    output: `in.csv sha256 69e3f7d86e55a164d25cc34e15e3102daf7cd40f67b98913016cbfafcfe98d09
`,
  },
  'c-graceful-fs': {
    exitCode: 0,
    stdout: `createWriteStream threw TypeError: Class constructor FileWriteStream cannot be invoked without 'new'
`,
    stderr: '',
    output: null,
  },
  'c-unzip-stored': {
    exitCode: 0,
    stdout: `extract error ${NO_RS}
`,
    stderr: '',
    output: `a.zip entries a.txt=eb06cb57b0a7944a5fdd77b42dc87f454b57a87c6c11d32a10edcd710d9d3d03 dir/b.txt=0f882365d720e9c4fc399ff41f81728abe2196760810a9da2f7913759d05207b
`,
  },
  'c-for-await': {
    exitCode: 1,
    stdout: `for-await threw TypeError: fs.createReadStream(...) is not a function or its return value is not async iterable
`,
    stderr: `${NO_RS}

Node.js v24.0.0
`,
    output: `in.bin sha256 d08928a168952dcd1f23061570816ee3b9d5c5c01ec65e00adbda68d328f4dbb
`,
  },
  'c-late-listener': {
    exitCode: 1,
    stdout: `exit bytes 0 end false
`,
    stderr: `${NO_RS}

Node.js v24.0.0
`,
    output: `in.txt sha256 91e3faafd322bcdf160f3f0ce886acb092b9b9e2a1e8526b40f21a8898a8700b
`,
  },
  'c-readable-read': {
    exitCode: 1,
    stdout: `exit bytes 0 end false
`,
    stderr: `${NO_RS}

Node.js v24.0.0
`,
    output: `in.txt sha256 24f3158d242f72ab36abd6ff23fa6b7c05c338c77a2666b97ac123d76b661f46
`,
  },
  'c-transform-big': {
    exitCode: 0,
    stdout: `ws error ${NO_RS}
`,
    stderr: '',
    output: `big.bin sha256 6027b5bbeb7704477c7cdb74d484a7ce6491512887f6385b1f3eb6550c75858b
big.out sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
`,
  },
  'c-pipeline-asyncgen': {
    exitCode: 1,
    stdout: `pipeline threw TypeError: pipeline: argument must be a stream (index 1 received a non-stream value)
`,
    stderr: `${NO_RS}

Node.js v24.0.0
`,
    output: `in.txt sha256 dc77b5b303347f6c9ee23a7acd7f618144e8d318df793b27017c9afff9a031f5
out.txt sha256 e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
`,
  },
};

async function inIsolate(p: Program): Promise<Observed> {
  const r = await inSandboxWritten(workspace(p), programFile(p), (path) => isWritten(p, path));
  return {
    exitCode: r.exitCode,
    stdout: r.stdout,
    stderr: r.stderr,
    output: await manifestOf(r.written),
  };
}

describe('node-streams goal scenario vs Node (isolate host)', () => {
  for (const p of CARRIER) {
    it(`${p.id} ${p.title} — ${verdict(p)}`, { timeout: 120_000 }, async () => {
      const node = pinOf(await inNode(p));
      const rifty = pinOf(await inIsolate(p));
      const pin = PINS[p.id];
      expect(pin === undefined, 'a pin exactly when an owner is named').toBe(p.owners.length === 0);
      if (pin === undefined) return expect(rifty).toEqual(node);
      expect(rifty).toEqual(pin);
      expect(rifty, 'the pin is a gap against live Node').not.toEqual(node);
    });
  }
});
