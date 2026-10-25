import type { ParityCase } from '../../src/types.ts';

export default {
  cwd: '/project',
  setup: { files: { 'project/helper.cjs': "process.on('message', () => {});" } },
  code: `
const {fork}=require('node:child_process');
const child=fork('helper.cjs',[],{silent:true});
let closed=false;
child.on('close',()=>{closed=true;});
child.on('exit',()=>setImmediate(()=>console.log('closed',closed,'connected',child.connected)));
child.disconnect();
`,
} satisfies ParityCase;
