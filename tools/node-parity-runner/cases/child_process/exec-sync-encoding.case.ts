/**
 * `execSync`'s `encoding` decodes the child's stdout (Node's spawnSync:
 * `stdout.toString(encoding)` unless it is `'buffer'`), with or without
 * `stdio: 'pipe'`; omitted or `'buffer'` returns a Buffer. The goal's
 * patched-exit execSync program splits a `utf8` result (ADR-0446 Parity 12).
 */
import type { ParityCase } from '../../src/types.ts';

const c: ParityCase = {
  setup: {
    files: {
      'child.js': "process.stdout.write('h\\u00e9llo\\n');",
    },
  },
  code: `
    const { execSync } = require('node:child_process');
    const { Buffer: NodeBuffer } = require('node:buffer');
    const utf8 = execSync('node child.js', { encoding: 'utf8' });
    console.log('utf8', typeof utf8, JSON.stringify(utf8));
    const piped = execSync('node child.js', { encoding: 'utf8', stdio: 'pipe' });
    console.log('piped', typeof piped, JSON.stringify(piped));
    console.log('hex', execSync('node child.js', { encoding: 'hex' }));
    console.log('buffer', NodeBuffer.isBuffer(execSync('node child.js', { encoding: 'buffer' })));
    console.log('default', NodeBuffer.isBuffer(execSync('node child.js')));
  `,
  kind: 'exec-sync',
};

export default c;
