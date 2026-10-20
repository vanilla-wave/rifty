export const childProcessFiles: Readonly<Record<string, string>> = {
  'parent.cjs': `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
globalThis.parentOnly = 'parent';
const child = spawn(process.execPath, ['node_modules/helper/cli.cjs'], { env: { CHILD_VALUE: 'child' } });
let output = '';
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.stdout.on('data', chunk => {
  output += chunk;
  if (output === 'ready\\n') {
    fs.writeFileSync('shared.txt', 'parent-update');
    child.stdin.end('go');
  }
});
child.on('error', error => { throw error; });
child.on('close', code => {
  console.log(JSON.stringify({code, output, shared:fs.readFileSync('shared.txt','utf8'),
    parent:globalThis.parentOnly, child:typeof globalThis.childOnly,
    builtin:require('node:fs').childOnly === undefined}));
});
`,
  'shared.txt': 'initial',
  'node_modules/helper/cli.cjs': `#!/usr/bin/env node
const fs = require('node:fs');
const dependency = require('helper-dependency');
globalThis.childOnly = true;
fs.childOnly = true;
process.stderr.write('child-stderr\\n');
process.stdout.write('ready\\n');
let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  console.log(JSON.stringify({parent:typeof globalThis.parentOnly, dependency,
    env:process.env.CHILD_VALUE, input, shared:fs.readFileSync('shared.txt','utf8')}));
  fs.writeFileSync('shared.txt', 'child-update');
});
`,
  'node_modules/helper-dependency/index.js': "module.exports = 'loaded-from-node_modules';",
  'esbuild.cjs': `
require('esbuild-wasm').transform('let x: number = 1', {loader:'ts'}).then(result => {
  process.stdout.write(result.code);
});
`,
  'errors.cjs': `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/errors.cjs']);
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log('close', code));
`,
  'node_modules/helper/errors.cjs': `#!/usr/bin/env node
const fs = require('node:fs');
try { fs.readFileSync('absent.txt'); } catch (error) { console.log(error.code); }
process.exitCode = 7;
`,
  'kill.cjs': `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/forever.cjs']);
child.stdout.on('data', chunk => { process.stdout.write(chunk); child.kill(); });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', (code, signal) => console.log('closed', code, signal));
`,
  'node_modules/helper/forever.cjs': `#!/usr/bin/env node
setInterval(() => {}, 1000);
console.log('ready-to-kill');
`,
  'nested.cjs': `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/nested.cjs']);
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log('parent-close', code));
`,
  'node_modules/helper/nested.cjs': `#!/usr/bin/env node
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/leaf.cjs']);
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log(JSON.stringify({code, distinct:process.pid !== child.pid, parent:Number(output) === process.pid})));
`,
  'node_modules/helper/leaf.cjs': 'console.log(process.ppid);',
  'close-authority.cjs': `
const {spawn} = require('node:child_process');
const child = spawn(process.execPath,['node_modules/helper/empty.cjs']);
child.on('close',()=> {
  const ps = spawn('ps',['-A','-o','ppid,pid'],{env:{PATH:'/usr/bin:/bin'}});
  let output = '';
  ps.stdout.on('data',chunk=>{output+=chunk;});
  ps.on('close',()=>console.log('dead-visible',output.trim().split('\\n').some(line=>Number(line.trim().split(/\\s+/)[1])===child.pid)));
});
`,
  'node_modules/helper/empty.cjs': 'void 0;',
  'snapshot.cjs': `
const {spawn} = require('node:child_process');
const env = {CHILD_VALUE:'before'};
const args = ['node_modules/helper/snapshot.cjs','before'];
const child = spawn(process.execPath,args,{env});
args[1] = 'after'; env.CHILD_VALUE = 'after';
child.stdout.on('data',chunk=>process.stdout.write(chunk));
child.stderr.on('data',chunk=>process.stderr.write(chunk));
`,
  'node_modules/helper/snapshot.cjs':
    'console.log(JSON.stringify([process.env.CHILD_VALUE,process.argv[2]]));',
  'unref-pipes.cjs': `
const {spawn} = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/delayed.cjs']);
child.stdout.on('data',chunk=>process.stdout.write(chunk));
child.stderr.on('data',chunk=>process.stderr.write(chunk));
child.unref();
`,
  'node_modules/helper/delayed.cjs': "setTimeout(()=>console.log('pipe-keeps-parent'),60);",
  'fork.cjs': `
const { fork } = require('node:child_process');
const child = fork('node_modules/helper/fork.cjs', [], {silent:true});
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('message', message => console.log(JSON.stringify(message)));
child.on('close', code => console.log('fork-close', code, child.connected));
child.send({ value:42 });
`,
  'node_modules/helper/fork.cjs': `
process.on('message', message => { process.send({value:message.value}); process.disconnect(); });
`,
  'disconnect.cjs': `
const child = require('node:child_process').fork('node_modules/helper/disconnect.cjs', [], {silent:true});
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log('fork-close', code, child.connected));
child.disconnect();
`,
  'send-disconnect.cjs': `
const child = require('node:child_process').fork('node_modules/helper/disconnect.cjs', [], {silent:true});
child.stdout.on('data', chunk => process.stdout.write(chunk));
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log('fork-close', code, child.connected));
child.send({value:42});
child.disconnect();
`,
  'node_modules/helper/disconnect.cjs': `
process.on('message', message => console.log(JSON.stringify(message)));
process.on('exit', () => console.log('child-connected', process.connected));
`,
  'signal.cjs': `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['node_modules/helper/signal.cjs']);
child.stdout.on('data', chunk => { process.stdout.write(chunk); if(String(chunk).includes('ready')) child.kill('SIGUSR2'); });
child.stderr.on('data', chunk => process.stderr.write(chunk));
child.on('close', code => console.log('signal-close', code));
`,
  'node_modules/helper/signal.cjs': `
const timer = setInterval(() => {}, 1000);
process.on('SIGUSR2', () => { clearInterval(timer); console.log('handled'); });
console.log('ready');
`,
};
