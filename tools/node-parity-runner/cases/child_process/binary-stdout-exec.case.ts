/**
 * `execSync` returns the child's stdout BYTE-EXACT (Node returns a Buffer by
 * default), even when the bytes are not valid UTF-8 (ADR-0084 #23).
 *
 * The harness UTF-8-captures stdout on BOTH sides, so a raw binary write would
 * be mangled by the harness itself and mask the bug. We route the assertion
 * through a HEX channel: the child writes the bytes [0xff,0xfe,0x00]; the
 * parent captures them via `execSync` (a Buffer) and prints `out.toString('hex')`
 * — the ASCII string `fffe00`, which survives the harness's UTF-8 capture on
 * both runtimes.
 *
 * Pre-fix rifty mangles the non-UTF-8 child stdout to U+FFFD before framing, so
 * it emits the hex of [0xef,0xbf,0xbd,0xef,0xbf,0xbd,0x00] = `efbfbdefbfbd00`.
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'bin.js': 'process.stdout.write(Buffer.from([0xff, 0xfe, 0x00]));',
    },
  },
  code: `
    const { execSync } = require('node:child_process');
    const out = execSync('node bin.js');
    console.log(out.toString('hex'));
  `,
  expected: 'fffe00',
  // execSync is SAB-only by design; this mode wires the real v2 binary-frame
  // round-trip so the rifty side returns byte-exact stdout (ADR-0084 #23).
  kind: 'exec-sync',
};

export default c;
