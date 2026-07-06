import type { ParityCase } from '../../src/types.ts';

/**
 * Harness self-proof for `ParityCase.cwd` (non-root process cwd): relative +
 * dot-segment fs resolution anchored at a NON-root cwd. At the historical
 * pinned cwd `/`, a surface that silently drops cwd resolution (`data.txt` →
 * `/data.txt`) still resolved right by accident — this case is the anchor the
 * stream/relative regressions need. `../shared.txt` walks OUT of the cwd, so
 * it only passes when resolution really joins against `/app`, not `/`.
 */
const c: ParityCase = {
  expected: ['in-app', 'nested', 'above'].join('\n'),
  cwd: '/app',
  setup: {
    files: {
      'app/data.txt': 'in-app',
      'app/sub/n.txt': 'nested',
      'shared.txt': 'above',
    },
  },
  code: `
    const fs = require('node:fs');
    console.log(fs.readFileSync('data.txt', 'utf8'));
    console.log(fs.readFileSync('./sub/n.txt', 'utf8'));
    console.log(fs.readFileSync('../shared.txt', 'utf8'));
  `,
};

export default c;
