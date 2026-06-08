import type { ParityCase } from '../../src/types.ts';

// Q-2026-06-07-410 — head's two slice modes over fs.readFileSync. `head -n N`
// keeps the first N lines; `head -c N` keeps the first N BYTES (Buffer.subarray
// on the raw buffer, NOT a char slice — a byte cut can land mid-codepoint, and
// the truncated tail must decode identically to Node's). N exceeds neither the
// line count nor the byte length here, so the slice boundaries are exercised.
const c: ParityCase = {
  setup: {
    files: {
      'lines.txt': 'one\ntwo\nthree\nfour\nfivé\n',
    },
  },
  code: `
    const fs = require('node:fs');
    const N = 3;
    const text = fs.readFileSync('lines.txt', 'utf8');
    const firstLines = text.split('\\n').slice(0, N).join('\\n');
    const buf = fs.readFileSync('lines.txt');
    const firstBytes = buf.subarray(0, N).toString('utf8');
    console.log(JSON.stringify({ firstLines, firstBytes }));
  `,
};

export default c;
