/**
 * node-streams goal carrier (docs/backlog/epics/node-streams-as-in-node/map.md item 0), isolate
 * host: each `c-*` program run by its own sandbox (`exec`) over the same files as live
 * `node <program>` on this runner, the oracle run per case too, so no case reads another's state.
 * Today's outcome is pinned whole (exit code, stdout, the whole stderr, the written files); the
 * owning unit replaces its pin with Node's. Browser-host twins: tests/browser-unit, tests/no-coi
 * `streams-scenario.spec.ts`.
 */
import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { inSandboxWritten } from './package-closure.ts';
import {
  CARRIER,
  type Program,
  entriesOf,
  inNode,
  isWritten,
  manifest,
  manifestOf,
  programFile,
  verdict,
  workspace,
} from './streams-scenario.ts';
import { type Observed, type Pin, pinOf } from './zlib-scenario.ts';

const here = dirname(fileURLToPath(import.meta.url));
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
    output: `in.xlsx!cd#0000 name="[Content_Types].xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x9c0db91 csize=345 usize=1264 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=0
in.xlsx!cd#0001 name="_rels/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=394
in.xlsx!cd#0002 name="_rels/.rels" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0xda499ff2 csize=233 usize=587 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=430
in.xlsx!cd#0003 name="xl/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=704
in.xlsx!cd#0004 name="xl/_rels/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=737
in.xlsx!cd#0005 name="xl/_rels/workbook.xml.rels" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x56b12484 csize=233 usize=697 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=776
in.xlsx!cd#0006 name="xl/worksheets/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=1065
in.xlsx!cd#0007 name="xl/worksheets/sheet1.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x164f6293 csize=492 usize=1068 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=1109
in.xlsx!cd#0008 name="xl/sharedStrings.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x47b51438 csize=171 usize=246 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=1655
in.xlsx!cd#0009 name="xl/theme/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=1876
in.xlsx!cd#0010 name="xl/theme/theme1.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0xdf309b76 csize=1569 usize=7961 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=1915
in.xlsx!cd#0011 name="xl/styles.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x5e803b05 csize=630 usize=1539 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=3533
in.xlsx!cd#0012 name="docProps/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=4206
in.xlsx!cd#0013 name="docProps/app.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x8ed8f77a csize=387 usize=804 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=4245
in.xlsx!cd#0014 name="docProps/core.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=<masked> csize=<masked> usize=<masked> extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=4678
in.xlsx!cd#0015 name="xl/workbook.xml" made=0x14 need=10 flags=0x0 method=8 time=<masked> crc=0x12ac888e csize=347 usize=626 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=4725
in.xlsx!eocd disk=0 cdDisk=0 entriesHere=16 entries=16 cdSize=966 cdOffset=5117 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
in.xlsx!local#0000 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x9c0db91 csize=345 usize=1264 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=345:1e05d7bd7b04a1db2ea486009e4bdddbe3224b0b4406261fdb9669c501672d97 content=1264:0ee6278b34e013e933862925f7cc8fbfa34529af82df0b64f7e7de9d8e31084e descriptor=none
in.xlsx!local#0001 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0002 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0xda499ff2 csize=233 usize=587 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=233:5ad7f61fcb29f78ed338931577f98325fc40259c1b4adbb8bd09f94688b02c0c content=587:1285b20099c64699001f9d90ea040ca1c177fa99bc3ae8a841128874820f01a4 descriptor=none
in.xlsx!local#0003 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0004 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0005 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x56b12484 csize=233 usize=697 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=233:b3a6bec70cec13a628181a9a857f5b1c2fb101bcdcb37cf15d1d4dd228c94240 content=697:db152538ca9d0a12609bf550b2577971a880d45d8ba0799dfe277871531bb3b1 descriptor=none
in.xlsx!local#0006 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0007 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x164f6293 csize=492 usize=1068 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=492:822cf16aae682e13b56b573d47162b0d19feab963cf7a0b3c8c10b8c313fb85f content=1068:96a293dca7217643fd2534edba56758199ddf8774575e649cd6242d174ae2671 descriptor=none
in.xlsx!local#0008 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x47b51438 csize=171 usize=246 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=171:d7c9456af6320bdab392ada608d5787f28d080f6546a95bb4358f7a9b115d87f content=246:2cc860482e908f45ed5c3c13c1390c484b6a7a606be37c68ed248c62c4bd0e35 descriptor=none
in.xlsx!local#0009 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0010 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0xdf309b76 csize=1569 usize=7961 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=1569:d97ac6916c0620e129e391dca660709e5ae7dd4017985df54e1284968c167491 content=7961:f857ef82e4c0e273a16e5efcf5cb12ff7a9943851cbdbd992cd2722616b271ed descriptor=none
in.xlsx!local#0011 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x5e803b05 csize=630 usize=1539 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=630:a3df2b8a6a5a4a8cc637567d998289fb41cf68128992bce4e7506f9eb0747a27 content=1539:b162294abd5acb68586c0433eae4f5c97480787c08dda49d1fa145f3b7b0a692 descriptor=none
in.xlsx!local#0012 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
in.xlsx!local#0013 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x8ed8f77a csize=387 usize=804 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=387:7555958dac21dfe584ec5f07e524ffe12cbc0b92bff6edca680986ffba919c75 content=804:351686dafc92b804882bc4a5b2b5d8e61a218ddeeba980588aa6a93659084e5a descriptor=none
in.xlsx!local#0014 name==cd need=10 flags=0x0 method=8 time=<masked> crc=<masked> csize=<masked> usize=<masked> extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=<masked> content=masked-times:792e3aef103f422afdf0d049ae13527118d6ee0fd2b91a5c972616e5927b2fd0 descriptor=none
in.xlsx!local#0015 name==cd need=10 flags=0x0 method=8 time=<masked> crc=0x12ac888e csize=347 usize=626 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=347:7a15ca3ec5d162663b8f055fd478b357641d49f8fd74c09da1cd8728996c897a content=626:f034bd45edb557b11f3452e6732994cd2636bbd3dfb30d687c466f0ad47bf049 descriptor=none
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
    output: `a.zip!cd#0000 name="a.txt" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x7811f98b csize=9890 usize=9890 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=0
a.zip!cd#0001 name="dir/" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x10 offset=9925
a.zip!cd#0002 name="dir/b.txt" made=0x14 need=10 flags=0x0 method=0 time=<masked> crc=0x225e88ee csize=31411 usize=31411 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 disk=0 iattr=0x0 eattr=0x0 offset=9959
a.zip!eocd disk=0 cdDisk=0 entriesHere=3 entries=3 cdSize=156 cdOffset=41409 comment=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
a.zip!local#0000 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x7811f98b csize=9890 usize=9890 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=9890:eb06cb57b0a7944a5fdd77b42dc87f454b57a87c6c11d32a10edcd710d9d3d03 content=9890:eb06cb57b0a7944a5fdd77b42dc87f454b57a87c6c11d32a10edcd710d9d3d03 descriptor=none
a.zip!local#0001 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x0 csize=0 usize=0 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 content=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 descriptor=none
a.zip!local#0002 name==cd need=10 flags=0x0 method=0 time=<masked> crc=0x225e88ee csize=31411 usize=31411 extra=0:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 data=31411:0f882365d720e9c4fc399ff41f81728abe2196760810a9da2f7913759d05207b content=31411:0f882365d720e9c4fc399ff41f81728abe2196760810a9da2f7913759d05207b descriptor=none
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

// External review of PR #467, round 3: a zip is compared by every container byte but `ZIP_MASKS`.
describe('a zip entry of the manifest sees every container byte', () => {
  const JSZip = createRequire(
    join(realpathSync(join(here, '../node_modules/exceljs')), 'package.json'),
  )('jszip') as new () => {
    file(name: string, data: string, options?: { date?: Date }): void;
    generateAsync(o: Record<string, unknown>): Promise<Uint8Array>;
  };
  const zip = async (
    names: readonly string[],
    options: Record<string, unknown> = {},
    core = '<x>2026-01-01T00:00:00.000Z</x>',
  ): Promise<Uint8Array> => {
    const z = new JSZip();
    for (const name of names)
      z.file(name, name === 'docProps/core.xml' ? core : `${name} body`, { date: new Date(0) });
    return z.generateAsync({ type: 'uint8array', compression: 'DEFLATE', ...options });
  };
  const NAMES = ['a.xml', 'docProps/core.xml', 'b.xml'];
  const of = async (b: Uint8Array): Promise<string | null> => manifest(await entriesOf('x.zip', b));
  const cat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
    const o = new Uint8Array(a.length + b.length);
    o.set(a);
    o.set(b, a.length);
    return o;
  };
  it('changes with bytes before, after and around the structures', async () => {
    const base = await zip(NAMES);
    const four = new Uint8Array([1, 2, 3, 4]);
    for (const changed of [cat(base, four), cat(four, base)])
      expect(await of(changed)).not.toEqual(await of(base));
  });
  it('changes with a comment, the entry order, a data descriptor, external attributes', async () => {
    const base = await of(await zip(NAMES));
    expect(await of(await zip(NAMES, { comment: 'c' }))).not.toEqual(base);
    expect(await of(await zip([...NAMES].reverse()))).not.toEqual(base);
    expect(await of(await zip(NAMES, { streamFiles: true }))).not.toEqual(base);
    expect(await of(await zip(NAMES, { platform: 'UNIX' }))).not.toEqual(base);
  });
  it("hides docProps/core.xml's timestamps and what follows from them, nothing else", async () => {
    const base = await of(await zip(NAMES));
    expect(await of(await zip(NAMES, {}, '<x>1999-12-31T23:59:59.5Z</x>'))).toEqual(base);
    expect(await of(await zip(NAMES, {}, '<x>2026-01-01T00:00:00.000Z</x><y/>'))).not.toEqual(base);
  });
  it('names an empty archive', async () => {
    expect(await of(await zip([]))).toMatch(/^x\.zip!eocd .*entries=0 /);
  });
});
