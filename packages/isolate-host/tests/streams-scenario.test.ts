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
/** Measured on main c2250727d, unchanged on d19d891b9: the whole stderr, no mask (the isolate's paths are `/workspace/…`). A guard has none. */
const PINS: Readonly<Record<string, Pin>> = {
  'c-xlsx-roundtrip': {
    exitCode: 0,
    stdout: `writeBuffer ok 
readFile threw TypeError: stream.close is not a function
`,
    stderr: '',
    output: `in.xlsx![Content_Types].xml method 8 sha256 0ee6278b34e013e933862925f7cc8fbfa34529af82df0b64f7e7de9d8e31084e
in.xlsx!_rels/ method 0 dir
in.xlsx!_rels/.rels method 8 sha256 1285b20099c64699001f9d90ea040ca1c177fa99bc3ae8a841128874820f01a4
in.xlsx!docProps/ method 0 dir
in.xlsx!docProps/app.xml method 8 sha256 351686dafc92b804882bc4a5b2b5d8e61a218ddeeba980588aa6a93659084e5a
in.xlsx!docProps/core.xml method 8 sha256 792e3aef103f422afdf0d049ae13527118d6ee0fd2b91a5c972616e5927b2fd0
in.xlsx!xl/ method 0 dir
in.xlsx!xl/_rels/ method 0 dir
in.xlsx!xl/_rels/workbook.xml.rels method 8 sha256 db152538ca9d0a12609bf550b2577971a880d45d8ba0799dfe277871531bb3b1
in.xlsx!xl/sharedStrings.xml method 8 sha256 2cc860482e908f45ed5c3c13c1390c484b6a7a606be37c68ed248c62c4bd0e35
in.xlsx!xl/styles.xml method 8 sha256 b162294abd5acb68586c0433eae4f5c97480787c08dda49d1fa145f3b7b0a692
in.xlsx!xl/theme/ method 0 dir
in.xlsx!xl/theme/theme1.xml method 8 sha256 f857ef82e4c0e273a16e5efcf5cb12ff7a9943851cbdbd992cd2722616b271ed
in.xlsx!xl/workbook.xml method 8 sha256 f034bd45edb557b11f3452e6732994cd2636bbd3dfb30d687c466f0ad47bf049
in.xlsx!xl/worksheets/ method 0 dir
in.xlsx!xl/worksheets/sheet1.xml method 8 sha256 96a293dca7217643fd2534edba56758199ddf8774575e649cd6242d174ae2671
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
    output: `a.zip!a.txt method 0 sha256 b53a397c07aa67b8e768b08b36a85531ab0c44342199ce5e15c7fd53fafc7114
a.zip!dir/ method 0 dir
a.zip!dir/b.txt method 0 sha256 12fd37d78287b8f1a9a1837ceb096dbe75bf1591666ca996b0baf1cb715f90b9
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
    // Above the oracle's bound plus the sandbox's `exec` bound (120 s, `inSandboxWritten`).
    it(`${p.id} ${p.title} — ${verdict(p)}`, { timeout: 240_000 }, async () => {
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
