import type { ParityCase } from '../../src/types.ts';

// runtime-js/absent-builtin-members-loud-throws: absent builtin members must
// exist as named members, not link-time misses. vitest's cli-api does
// `import { statfsSync } from 'node:fs'`; tinyexec imports spawnSync.
const c: ParityCase = {
  kind: 'esm',
  code: `
    import { statfsSync } from 'node:fs';
    import { spawnSync } from 'node:child_process';
    console.log(typeof statfsSync, typeof spawnSync);
  `,
};

export default c;
