/**
 * `execSync(..., { encoding: 'utf8' })` decodes the child's stdout keeping a
 * leading BOM (Node: `stdout.toString('utf8')`).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'child.js': 'process.stdout.write(Buffer.from([0xef, 0xbb, 0xbf, 0x41, 0x0a]));',
    },
  },
  code: `
    const { execSync } = require('node:child_process');
    const cps = (s) => s.length + ':' + [...s].map((ch) => ch.codePointAt(0).toString(16)).join(' ');
    console.log('utf8', cps(execSync('node child.js', { encoding: 'utf8' })));
    console.log('hex', execSync('node child.js', { encoding: 'hex' }));
  `,
  kind: 'exec-sync',
};

export default c;
