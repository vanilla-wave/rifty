/**
 * node:zlib goal carrier (docs/backlog/runtime-js/zlib-node-acceptance-carrier.md), isolate host:
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
  observed,
  outPath,
  pinOf,
  runOracle,
} from './zlib-scenario.ts';

const NO_ENGINE =
  '(no compression engine in the rifty isolate host (rifty zlib runs on web CompressionStream, absent here), ADR-0557)';
const failed = (error: string, stdout = ''): Pin => ({ exitCode: 1, stdout, error, output: null });
/** Measured on main dfad6553e. */
const PINS: Readonly<Record<StepId, Pin>> = {
  '1': failed(`NotImplementedError: Not implemented: isolate-host.zlib.DeflateRaw ${NO_ENGINE}`),
  '2': failed(
    `NotImplementedError: Not implemented: isolate-host.zlib.createInflateRaw ${NO_ENGINE}`,
  ),
  '3w': failed(
    `NotImplementedError: Not implemented: isolate-host.zlib.createDeflate ${NO_ENGINE}`,
  ),
  '3r': failed(`NotImplementedError: Not implemented: isolate-host.zlib.Inflate ${NO_ENGINE}`),
  // fontkit's load, before any zlib call: a wall outside this goal.
  '4': failed('NotImplementedError: Not implemented: isolate-host.TextDecoder(ascii) (only utf-8)'),
  '5a': failed(`NotImplementedError: Not implemented: isolate-host.zlib.gunzipSync ${NO_ENGINE}`),
  '5b': failed(`NotImplementedError: Not implemented: isolate-host.zlib.unzip ${NO_ENGINE}`),
  '6': failed(
    `NotImplementedError: Not implemented: isolate-host.zlib.createDeflateRaw ${NO_ENGINE}`,
    'params {"client_max_window_bits":11,"server_max_window_bits":10}\n',
  ),
  '7a': failed(
    'NotImplementedError: Not implemented: isolate-host.zlib.crc32 (not implemented in rifty yet, on any host: backlog runtime-js/zlib-crc32)',
  ),
  '7b': failed(`NotImplementedError: Not implemented: isolate-host.zlib.inflate ${NO_ENGINE}`),
};
/** Per step, when it stops being a pin. */
const GREEN: Partial<Record<StepId, string>> = {
  '4': 'red after unit 3 too: at least isolate-host TextDecoder(ascii), outside this goal',
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
