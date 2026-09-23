import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import { statfsSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    import process from 'node:process';
    console.log(JSON.stringify({
      statfsSync: typeof statfsSync,
      spawnSync: typeof spawnSync,
      boundMemoryUsage: typeof process.memoryUsage.bind(process),
    }));
  `,
};

export default c;
