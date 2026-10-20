import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: {
    files: {
      'project/child.cjs': 'console.log(JSON.stringify([process.env.VALUE,process.argv[2]]));',
    },
  },
  code: `
const {spawn} = require('node:child_process');
const process = require('node:process');
const env = {VALUE:'before'};
const args = ['child.cjs','before'];
const child = spawn(process.execPath,args,{env});
env.VALUE = 'after'; args[1] = 'after';
child.stdout.pipe(process.stdout);
child.on('close',()=>process.stdin.resume());
`,
  expected: '["before","before"]',
} satisfies ParityCase;
