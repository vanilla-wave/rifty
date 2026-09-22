import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  code: `
    const fs = require('node:fs');
    const childProcess = require('node:child_process');
    const proc = require('node:process');
    console.log(JSON.stringify({
      statfsSync: typeof fs.statfsSync,
      spawnSync: typeof childProcess.spawnSync,
      memoryUsage: typeof proc.memoryUsage,
      boundMemoryUsage: typeof proc.memoryUsage?.bind(proc),
    }));
  `,
};

export default c;
