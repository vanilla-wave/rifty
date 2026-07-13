import type { ParityCase } from '../../src/types.ts';

const child = `
const { existsSync } = require('node:fs');
process.stdout.write(JSON.stringify([
  existsSync('marker.txt'),
  process.env.PARENT_ONLY ?? null,
  process.env.EXPLICIT_ONLY ?? null,
  Object.hasOwn(process.env, 'UNDEFINED_VALUE'),
]));
`;

export default {
  setup: {
    files: {
      'app/child.js': child,
      'app/marker.txt': 'present',
    },
  },
  cwd: '/app',
  code: `
    const { execSync } = require('node:child_process');
    process.env.PARENT_ONLY = 'parent';
    process.env.REPLACED = 'parent';

    console.log(execSync('node child.js').toString());
    console.log(execSync('node child.js', {
      env: {
        PATH: process.env.PATH,
        EXPLICIT_ONLY: 'explicit',
        UNDEFINED_VALUE: undefined,
      },
    }).toString());
  `,
  kind: 'exec-sync',
  expected: '[true,"parent",null,false]\n[true,null,"explicit",false]\n',
} satisfies ParityCase;
