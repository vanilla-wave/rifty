/**
 * The brand on a seeded owner (`new NodeProcess(spec)`) and on a same-realm
 * spawned child's own plain-object `process` (free, `node:process`, `process`),
 * whose `versions` the brand-based detector reads next.
 */
import type { ParityCase } from '../../src/types.ts';
import { BRAND_SOURCE } from './to-string-tag.case.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/child.js': `${BRAND_SOURCE}
        process.stdout.write(JSON.stringify({
          free: brand(process),
          binding: brand(require('node:process')),
          bare: brand(require('process')),
        }));
      `,
    },
  },
  code: `${BRAND_SOURCE}
    const { spawn } = require('node:child_process');
    const owner = brand(require('node:process'));
    const child = spawn('node', ['child.js'], { stdio: 'pipe' });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('close', (code) => {
      console.log(JSON.stringify(owner));
      console.log(code, out);
    });
  `,
} satisfies ParityCase;
