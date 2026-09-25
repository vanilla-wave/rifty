import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import fs, { statfsSync } from 'node:fs';
    import cp, { spawnSync } from 'node:child_process';
    import p from 'node:process';
    console.log('statfsSync', typeof statfsSync, statfsSync === fs.statfsSync);
    console.log('spawnSync', typeof spawnSync, spawnSync === cp.spawnSync);
    console.log('memoryUsage', typeof p.memoryUsage, typeof p.memoryUsage.bind(p));
  `,
};

export default c;
