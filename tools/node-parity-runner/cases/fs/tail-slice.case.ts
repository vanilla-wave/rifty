import type { ParityCase } from '../../src/types.ts';

// Q-2026-06-07-410 — tail's two slice modes over fs.readFileSync, including the
// no-trailing-newline edge the builtin must get right: content ends WITHOUT a
// final '\n', so the last line is real (not a split-produced empty tail) and
// the last byte is a content byte. `tail -n N` keeps the last N lines; `tail -c
// N` keeps the last N BYTES (Buffer.subarray from buf.length-N — a byte cut can
// land mid-codepoint, and the decoded tail must match Node's).
const c: ParityCase = {
  setup: {
    files: {
      // No trailing newline after "lást".
      'lines.txt': 'alpha\nbeta\ngamma\ndelta\nlást',
    },
  },
  code: `
    const fs = require('node:fs');
    const N = 2;
    const text = fs.readFileSync('lines.txt', 'utf8');
    const lastLines = text.split('\\n').slice(-N).join('\\n');
    const buf = fs.readFileSync('lines.txt');
    const lastBytes = buf.subarray(Math.max(0, buf.length - N)).toString('utf8');
    console.log(JSON.stringify({ lastLines, lastBytes }));
  `,
};

export default c;
