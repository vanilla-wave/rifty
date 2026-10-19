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
  require('esbuild-wasm').stop();
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
};
