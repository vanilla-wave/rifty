import type { ParityCase } from '../../src/types.ts';

/**
 * Harness self-proof: `ParityCase.cwd` names a directory with NO setup files
 * inside it. The Node runner mkdirs `<workDir>/<cwd>` before spawning; the
 * rifty runner must materialize the same directory in the VFS (review
 * 2026-07-05 handoff) — otherwise every relative write here is ENOENT and
 * `readdirSync('.')` throws instead of listing the empty-then-filled dir.
 */
const c: ParityCase = {
  expected: ['[]', 'fresh', '["fresh.txt"]'].join('\n'),
  cwd: '/empty/nested',
  code: `
    const fs = require('node:fs');
    console.log(JSON.stringify(fs.readdirSync('.')));
    fs.writeFileSync('fresh.txt', 'fresh');
    console.log(fs.readFileSync('./fresh.txt', 'utf8'));
    console.log(JSON.stringify(fs.readdirSync('.')));
  `,
};

export default c;
