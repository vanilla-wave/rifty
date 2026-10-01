const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rifty-execargv-authority-'));
function put(name, content) {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), content);
}
function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  console.log(
    JSON.stringify({
      label,
      command: [process.execPath, ...args],
      cwd: root,
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    }),
  );
}
console.log(
  JSON.stringify({
    node: process.version,
    executable: process.execPath,
    fixtureRoot: root,
    command: 'node /tmp/rifty-execargv-decision-probe.cjs',
  }),
);
put(
  'pre1.cjs',
  "globalThis.order=(globalThis.order||[]).concat('require-1');globalThis.cached={};module.exports=globalThis.cached;",
);
put('pre2.cjs', "globalThis.order.push('require-2');");
put('im.mjs', "globalThis.order.push('import');");
put(
  'package.json',
  JSON.stringify({
    imports: {
      '#pick': { mutation: './mutation.cjs', custom: './custom.cjs', default: './default.cjs' },
    },
  }),
);
for (const id of ['mutation', 'custom', 'default'])
  put(`${id}.cjs`, `module.exports=${JSON.stringify(id)}`);
put(
  'node_modules/pick/package.json',
  JSON.stringify({
    exports: {
      mutation: './mutation.cjs',
      custom: './custom.cjs',
      node: './node.cjs',
      default: './default.cjs',
    },
  }),
);
for (const id of ['mutation', 'custom', 'node', 'default'])
  put(`node_modules/pick/${id}.cjs`, `module.exports=${JSON.stringify(`root-${id}`)}`);
put(
  'other/node_modules/pick/package.json',
  JSON.stringify({ exports: { custom: './custom.mjs', default: './default.mjs' } }),
);
for (const id of ['custom', 'default'])
  put(`other/node_modules/pick/${id}.mjs`, `export default ${JSON.stringify(`other-${id}`)}`);
put(
  'meta.mjs',
  `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); console.log(JSON.stringify({execArgv:process.execArgv,order:globalThis.order,cache:require('./pre1.cjs')===globalThis.cached,pick:require('pick'),imports:require('#pick'),relative:import.meta.resolve('./x.js',new URL('./other/base.mjs',import.meta.url).href),bare:import.meta.resolve('pick',new URL('./other/base.mjs',import.meta.url).href)}));`,
);
for (const flag of [[], ['--experimental-import-meta-resolve']])
  run('meta-and-startup', [
    ...flag,
    '--import',
    './im.mjs',
    '--require',
    './pre1.cjs',
    '-r',
    './pre2.cjs',
    '--require=./pre1.cjs',
    '--conditions',
    'custom',
    'meta.mjs',
  ]);
put(
  'child.cjs',
  `const {parentPort,workerData,Worker}=require('node:worker_threads'); const out={execArgv:process.execArgv.slice(),order:globalThis.order,pick:require('pick'),imports:require('#pick')};if(parentPort){if(workerData?.recursive){process.execArgv.push('--conditions=mutation');new Worker(__filename).on('message',m=>parentPort.postMessage({self:out,nested:m}));}else parentPort.postMessage(out);}else process.send(out);`,
);
put(
  'inherit.cjs',
  `const{Worker}=require('node:worker_threads');const{fork}=require('node:child_process'); process.execArgv.push('--conditions=mutation'); const entries=[['worker-default',()=>new Worker(require.resolve('./child.cjs'),{workerData:{recursive:true}})],['worker-empty',()=>new Worker(require.resolve('./child.cjs'),{execArgv:[]})],['worker-override',()=>new Worker(require.resolve('./child.cjs'),{execArgv:['--conditions=custom','--require',require.resolve('./pre1.cjs')]})],['fork-default',()=>fork(require.resolve('./child.cjs'))],['fork-empty',()=>fork(require.resolve('./child.cjs'),[],{execArgv:[]})]];for(const[label,start]of entries){const p=start();p.on('message',m=>{console.log(label,JSON.stringify(m));if(p.disconnect)p.disconnect()});}`,
);
run('worker-vs-fork-inheritance', [
  '--experimental-import-meta-resolve',
  '--require',
  './pre1.cjs',
  '--conditions',
  'custom',
  'inherit.cjs',
]);
put(
  'echo.cjs',
  `const{parentPort}=require('node:worker_threads'); if(parentPort)parentPort.postMessage({execArgv:process.execArgv});else process.send({execArgv:process.execArgv});`,
);
put(
  'validation.cjs',
  `const{Worker}=require('node:worker_threads');for(const execArgv of [['-e','globalThis.REPLAYED=true'],['--input-type=module'],['--bad-unknown'],['--require'],['--conditions'],['--require','./missing.cjs']]){try{const w=new Worker(require.resolve('./echo.cjs'),{execArgv});w.on('error',e=>console.log('async',JSON.stringify({execArgv,code:e.code,message:e.message})));w.on('message',m=>console.log('started',JSON.stringify({execArgv,m})));}catch(e){console.log('sync',JSON.stringify({execArgv,code:e.code,message:e.message}))}}`,
);
run('worker-explicit-validation', ['validation.cjs']);
const evalSource = `const{Worker}=require('node:worker_threads');const{fork}=require('node:child_process');const file=${JSON.stringify(path.join(root, 'echo.cjs'))};process.execArgv.push('--conditions=mutation');new Worker(file).on('message',m=>console.log('worker-inherited-eval',JSON.stringify(m)));const child=fork(file);child.on('message',m=>{console.log('fork-inherited-eval',JSON.stringify(m));child.disconnect()});`;
run('eval-inherited-identity', ['--conditions=custom', '-e', evalSource]);
for (const spellings of [
  ['-r./pre1.cjs', '-Ccustom'],
  ['-r', './pre1.cjs', '-C', 'custom'],
  ['--require=./pre1.cjs', '--conditions=custom'],
])
  run('short-and-equals-spellings', [...spellings, 'meta.mjs']);
put(
  'node_modules/order/package.json',
  JSON.stringify({
    exports: { second: './second.cjs', first: './first.cjs', default: './default.cjs' },
  }),
);
for (const id of ['second', 'first', 'default'])
  put(`node_modules/order/${id}.cjs`, `module.exports=${JSON.stringify(id)}`);
run('condition-declaration-order', [
  '--conditions=first',
  '--conditions=second',
  '-e',
  "console.log(require('order'))",
]);
