/**
 * node:zlib goal carrier (docs/backlog/epics/node-zlib-on-every-host/map.md item 1), isolate host:
 * each step of the goal's User scenario run by the sandbox (`exec`) over the same files as live
 * `node <step>` on this runner. Today's outcome is pinned whole per step; the unit that delivers
 * the step replaces its pin with `toEqual(observed(node))` (stdout, stderr, exit code, the
 * output's bytes). Browser-host twins: tests/browser-unit, tests/no-coi `zlib-scenario.spec.ts`.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { inSandbox } from './package-closure.ts';
import {
  GREEN_BY,
  type OracleStep,
  type Pin,
  STEPS,
  type StepId,
  browserMasks,
  observed,
  outPath,
  pinOf,
  runOracle,
} from './zlib-scenario.ts';

const NO_ENGINE =
  '(no compression engine in the rifty isolate host (rifty zlib runs on web CompressionStream, absent here), ADR-0557)';
/** Measured on main dfad6553e: the whole stderr, no mask (the isolate's paths are `/workspace/…`). */
const PINS: Readonly<Record<StepId, Pin>> = {
  '1': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.DeflateRaw ${NO_ENGINE}
    at new DeflateCRC32Stream (/workspace/node_modules/crc32-stream/lib/deflate-crc32-stream.js:17:5)
    at ZipArchiveOutputStream._smartStream (/workspace/node_modules/compress-commons/lib/archivers/zip/zip-archive-output-stream.js:167:27)
    at ZipArchiveOutputStream._appendStream (/workspace/node_modules/compress-commons/lib/archivers/zip/zip-archive-output-stream.js:96:20)
    at ArchiveOutputStream.entry (/workspace/node_modules/compress-commons/lib/archivers/archive-output-stream.js:88:10)
    at ZipStream.entry (/workspace/node_modules/zip-stream/index.js:164:49)
    at Zip.append (/workspace/node_modules/archiver/lib/plugins/zip.js:56:15)
    at Archiver._moduleAppend (/workspace/node_modules/archiver/lib/core.js:179:16)
    at Archiver._onQueueTask (/workspace/node_modules/archiver/lib/core.js:405:8)
    at /workspace/node_modules/async/dist/async.js:4017:13
    at Object.process (/workspace/node_modules/async/dist/async.js:1680:21)
    at /workspace/node_modules/async/dist/async.js:1572:19
    at /workspace/node_modules/async/dist/async.js:328:20
    at Immediate.fullCallback (/workspace/node_modules/archiver/lib/core.js:396:5) {
  feature: 'isolate-host.zlib.DeflateRaw'
}

Node.js v24.0.0
`,
    output: null,
  },
  '2': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.createInflateRaw ${NO_ENGINE}
    at /workspace/node_modules/unzipper/lib/Open/unzip.js:89:52
    at tryCatcher (/workspace/node_modules/bluebird/js/release/util.js:16:23)
    at Promise._settlePromiseFromHandler (/workspace/node_modules/bluebird/js/release/promise.js:510:31)
    at Promise._settlePromise (/workspace/node_modules/bluebird/js/release/promise.js:567:18)
    at Promise._settlePromise0 (/workspace/node_modules/bluebird/js/release/promise.js:612:10)
    at Promise._settlePromises (/workspace/node_modules/bluebird/js/release/promise.js:691:18)
    at Async._drainQueue (/workspace/node_modules/bluebird/js/release/async.js:133:16)
    at Async._drainQueues (/workspace/node_modules/bluebird/js/release/async.js:143:10)
    at Async.drainQueues (/workspace/node_modules/bluebird/js/release/async.js:17:14)

Node.js v24.0.0
`,
    output: null,
  },
  '3w': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.createDeflate ${NO_ENGINE}
    at Packer.createDeflate (/workspace/node_modules/pngjs/lib/packer.js:73:24)
    at new module.exports (/workspace/node_modules/pngjs/lib/packer-async.js:14:32)
    at new exports.PNG (/workspace/node_modules/pngjs/lib/png.js:44:18)
    at Object.<anonymous> (/workspace/3w-pngjs-write.js:6:42) {
  feature: 'isolate-host.zlib.createDeflate'
}

Node.js v24.0.0
`,
    output: null,
  },
  '3r': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.Inflate ${NO_ENGINE}
    at new Inflate (/workspace/node_modules/pngjs/lib/sync-inflate.js:18:16)
    at inflateSync (/workspace/node_modules/pngjs/lib/sync-inflate.js:162:25)
    at module.exports (/workspace/node_modules/pngjs/lib/parser-sync.js:85:20)
    at exports.read (/workspace/node_modules/pngjs/lib/png-sync.js:7:10)
    at Object.<anonymous> (/workspace/3r-pngjs-read.js:7:23) {
  feature: 'isolate-host.zlib.Inflate'
}

Node.js v24.0.0
`,
    output: null,
  },
  // fontkit's load, before any zlib call: a wall outside this goal.
  '4': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.TextDecoder(ascii) (only utf-8)
    at Object.<anonymous> (/workspace/node_modules/fontkit/dist/main.cjs:5424:51)
    at Object.<anonymous> (/workspace/node_modules/pdfkit/js/pdfkit.js:7:15) {
  feature: 'isolate-host.TextDecoder(ascii)'
}

Node.js v24.0.0
`,
    output: null,
  },
  '5a': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.gunzipSync ${NO_ENGINE}
    at Object.<anonymous> (/workspace/5a-gunzip-members.js:5:33) {
  feature: 'isolate-host.zlib.gunzipSync'
}

Node.js v24.0.0
`,
    output: null,
  },
  '5b': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.unzip ${NO_ENGINE}
    at Object.<anonymous> (/workspace/5b-unzip.js:6:6) {
  feature: 'isolate-host.zlib.unzip'
}

Node.js v24.0.0
`,
    output: null,
  },
  '6': {
    exitCode: 1,
    stdout: 'params {"client_max_window_bits":11,"server_max_window_bits":10}\n',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.createDeflateRaw ${NO_ENGINE}
    at PerMessageDeflate._compress (/workspace/node_modules/ws/lib/permessage-deflate.js:416:28)
    at /workspace/node_modules/ws/lib/permessage-deflate.js:326:12
    at [kRun] (/workspace/node_modules/ws/lib/limiter.js:50:7)
    at Limiter.add (/workspace/node_modules/ws/lib/limiter.js:35:15)
    at PerMessageDeflate.compress (/workspace/node_modules/ws/lib/permessage-deflate.js:325:17)
    at /workspace/6-ws.js:6:54
    at new Promise (<anonymous>)
    at call (/workspace/6-ws.js:6:28)

Node.js v24.0.0
`,
    output: null,
  },
  '7a': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.crc32 (not implemented in rifty yet, on any host: backlog runtime-js/zlib-crc32)
    at Object.<anonymous> (/workspace/7a-crc32.js:6:37) {
  feature: 'isolate-host.zlib.crc32'
}

Node.js v24.0.0
`,
    output: null,
  },
  '7b': {
    exitCode: 1,
    stdout: '',
    stderr: `NotImplementedError: Not implemented: isolate-host.zlib.inflate ${NO_ENGINE}
    at Object.<anonymous> (/workspace/7b-inflate-corrupt.js:5:6) {
  feature: 'isolate-host.zlib.inflate'
}

Node.js v24.0.0
`,
    output: null,
  },
};
/** Per step, when it stops being a pin. */
const GREEN: Partial<Record<StepId, string>> = {
  '4': 'red after unit 3 too: isolate-host TextDecoder(ascii) — goal isolate-guest-web-api unit 3 (distribution/isolate-guest-textdecoder-legacy-encodings); then the isolate zlib gap until unit 3 here',
};

let oracle: ReadonlyMap<StepId, OracleStep>;
beforeAll(() => {
  oracle = runOracle();
}, 120_000);

describe('node:zlib goal scenario vs Node (isolate host)', () => {
  for (const step of STEPS) {
    it(
      `${step.id} ${step.title} — today pinned; ${GREEN[step.id] ?? GREEN_BY}`,
      { timeout: 120_000 },
      async () => {
        const s = oracle.get(step.id);
        if (s === undefined) throw new Error(`no oracle for ${step.id}`);
        const rifty = pinOf(
          observed(await inSandbox(new Map(s.files), step.program, outPath(step))),
        );
        expect(rifty).toEqual(PINS[step.id]);
        expect(rifty, 'the pin is a gap against live Node').not.toEqual(pinOf(observed(s.node)));
      },
    );
  }
});

// External review of PR #453 (B1): a pin that kept one stderr line let these pass.
describe('a pin holds the whole stderr', () => {
  const base = {
    exitCode: 1,
    stdout: '',
    stderr: 'NotImplementedError: Not implemented: zlib.x (why)\n    at f (/workspace/a.js:1:1)\n',
    output: null,
  };
  it('an extra stderr line changes it', () => {
    expect(pinOf({ ...base, stderr: `unexpected stderr\n${base.stderr}` })).not.toEqual(
      pinOf(base),
    );
  });
  it('a message line after the first changes it', () => {
    const stderr = base.stderr.replace('(why)\n', '(why)\nCHANGED ERROR DETAIL\n');
    expect(pinOf({ ...base, stderr })).not.toEqual(pinOf(base));
  });
});

// External review of PR #453, round 2: the browser masks hide only rifty's own frames and locations.
describe('browserMasks', () => {
  const root = '/r/rifty';
  const at = (origin: string, rest: string) => `${origin}/@fs${root}/packages/${rest}`;
  const dev = 'http://localhost:5341';
  const sdk = 'http://127.0.0.1:5441';
  const lines = {
    message: 'NotImplementedError: Not implemented: zlib.x (why)',
    riftyTop: `    at Object.x (${at(dev, 'runtime-js/src/builtins/zlib.ts:6:9')})`,
    guest: '    at eval (/tmp/z2/node_modules/a/b.js:89:52)',
    evalAt: `    at eval (eval at <anonymous> (${at(dev, 'runtime-js/src/builtins/vm/index.ts:20:25')}), <anonymous>:1:5)`,
    nonFrame: `    at diagnostic (${at(dev, 'NOT-A-FRAME')}`,
    riftyRun: `    at compileCjsSource (${at(sdk, 'runtime-js/src/module-loader/cjs.ts:1426:6')})\n    at ${at(sdk, 'runtime-js/src/module-loader/cjs.ts:1465:7')}`,
    uncaught: `Uncaught NotImplementedError: x (${at(dev, 'runtime-js/src/builtins/zlib.ts:11')})`,
    elsewhere: '    at f (http://localhost:5341/@fs/elsewhere/packages/x.ts:1:1)',
  };
  const out = pinOf(
    { exitCode: 1, stdout: '', stderr: `${Object.values(lines).join('\n')}\n`, output: null },
    browserMasks(root),
  ).stderr.split('\n');
  it("collapses each run of rifty's own frames into one line", () => {
    expect([out[1], out[5]]).toEqual(['    at <rifty frames>', '    at <rifty frames>']);
  });
  it('keeps a guest frame', () => expect(out[2]).toBe(lines.guest));
  it('keeps an `eval at` frame, its rifty origin line-masked', () => {
    expect(out[3]).toBe(
      '    at eval (eval at <anonymous> (<dev-server>/packages/runtime-js/src/builtins/vm/index.ts:<line>), <anonymous>:1:5)',
    );
  });
  it('keeps a line that is not a frame', () => {
    expect(out[4]).toBe('    at diagnostic (<dev-server>/packages/NOT-A-FRAME');
  });
  it("masks a rifty location's line outside frames, keeps a URL outside this checkout", () => {
    expect(out.slice(6)).toEqual([
      'Uncaught NotImplementedError: x (<dev-server>/packages/runtime-js/src/builtins/zlib.ts:<line>)',
      lines.elsewhere,
      '',
    ]);
  });
  it('rewrites nothing else', () => expect(out[0]).toBe(lines.message));
});
