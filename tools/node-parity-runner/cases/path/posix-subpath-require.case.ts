import type { ParityCase } from '../../src/types.ts';

/**
 * `node:path/posix` / bare `path/posix` through CJS `require` (vitest-run-in-browser
 * I6): same object as `require('node:path').posix`, and a registered builtin
 * for `node:module`. Each probe is isolated so one miss cannot mask another.
 * `path.win32` is NOT printed (traps.md parity-win32-alias).
 */
const c: ParityCase = {
  code: `
    const path = require('node:path');
    const mod = require('node:module');
    function probe(label, fn) {
      try {
        console.log(label, fn());
      } catch (error) {
        console.log(label, 'threw', error.code ?? error.name);
      }
    }
    probe('node:path/posix', () => require('node:path/posix') === path.posix);
    probe('path/posix', () => require('path/posix') === path.posix);
    probe('join', () => require('node:path/posix').join('a', 'b'));
    probe('isBuiltin', () => [mod.isBuiltin('node:path/posix'), mod.isBuiltin('path/posix')].join(' '));
    probe('builtinModules', () => mod.builtinModules.includes('path/posix'));
  `,
  expected: [
    'node:path/posix true',
    'path/posix true',
    'join a/b',
    'isBuiltin true true',
    'builtinModules true',
  ].join('\n'),
};

export default c;
