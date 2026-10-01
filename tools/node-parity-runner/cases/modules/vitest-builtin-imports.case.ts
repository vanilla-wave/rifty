import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  kind: 'esm',
  code: `
    import path from 'node:path';
    import posix, { join } from 'node:path/posix';
    import win32 from 'node:path/win32';
    import * as proc from 'node:process';
    import { cwd, nextTick } from 'node:process';
    import { statfsSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    console.log(posix === path.posix, win32 === path.win32, join('a','b'));
    console.log(typeof cwd(), typeof nextTick, typeof proc.memoryUsage);
    console.log('on' in proc, 'emit' in proc, 'constructor' in proc);
    console.log(typeof statfsSync, typeof spawnSync);
  `,
};

export default c;
