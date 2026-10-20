import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  stdin: [],
  setup: { files: { 'project/child.cjs': 'void 0;' } },
  code: `
const {spawn} = require('node:child_process');
const process = require('node:process');
const child = spawn(process.execPath,['child.cjs']);
child.on('exit',()=> {
  const ps = spawn('ps',['-A','-o','ppid,pid'],{env:{PATH:'/usr/bin:/bin'}});
  let output = '';
  ps.stdout.on('data',chunk=>{output+=chunk;});
  ps.on('close',()=> {
    console.log('dead-visible',output.trim().split('\\n').some(line=>Number(line.trim().split(/\\s+/)[1])===child.pid));
    process.stdin.resume();
  });
});
`,
  expected: 'dead-visible false',
} satisfies ParityCase;
