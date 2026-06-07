import type { ParityCase } from '../../src/types.ts';

// Q-2026-06-07-410 — cat's core read: fs.readFileSync(p,'utf8') over a
// multi-line + multibyte (UTF-8) file. Multibyte content pins the utf8 *decode*
// path Node-equal (a wrong code-unit boundary or latin1 fallback would diverge).
//
// The read result is asserted via console.log(JSON.stringify(...)) rather than
// process.stdout.write(text): the runner routes rifty's process.stdout.write
// through console.log (a known stdout-newline quirk, separately tracked), which
// would inject an unrelated divergence into a case whose subject is the READ,
// not stdout chunking — exactly the force-fit ADR-0086 warns against. JSON also
// makes any decode difference (a lost/mangled codepoint, a trailing-newline
// drop) explicit in the diff instead of masked by the runner's `\n+$` normalise.
const c: ParityCase = {
  setup: {
    files: {
      'poem.txt': 'café\nналево\n世界\n🦀 end\n',
    },
  },
  code: `
    const fs = require('node:fs');
    console.log(JSON.stringify(fs.readFileSync('poem.txt', 'utf8')));
  `,
};

export default c;
