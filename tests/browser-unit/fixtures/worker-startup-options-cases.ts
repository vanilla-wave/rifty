export interface WorkerStartupOptionsCase {
  readonly name: string;
  readonly files: Readonly<Record<string, string>>;
  readonly parent: string;
  readonly workers: number;
}

const launch = `
const { Worker } = require('node:worker_threads');
const { resolve } = require('node:path');
const hold = setInterval(() => {}, 20);
function run(file, execArgv) {
  return new Promise((done, reject) => {
    const worker = new Worker(resolve(file), { execArgv });
    let message;
    worker.once('message', value => { message = value; });
    worker.once('error', reject);
    worker.once('exit', code => code === 0 ? done(message) : reject(new Error('exit=' + code)));
  });
}
`;
const finish =
  '.catch(error => { console.error(error); process.exitCode=1; }).finally(() => clearInterval(hold));';
const flags = [
  '--experimental-import-meta-resolve',
  '--require',
  './preload-a.cjs',
  '--require',
  './preload-b.cjs',
  '--conditions',
  'node',
  '--conditions',
  'development',
  '--conditions',
  'argument-first',
  '--conditions',
  'declaration-first',
];
const common: Readonly<Record<string, string>> = {
  'preload-a.cjs': `globalThis.preloadOrder = ['a']; require('./shared.cjs').count++;`,
  'preload-b.cjs': `globalThis.preloadOrder.push('b'); require('./shared.cjs').count++;`,
  'shared.cjs': 'module.exports = {count:0};',
  'package.json': JSON.stringify({
    name: 'branch-pkg',
    imports: {
      '#branch': { development: './development.cjs', node: './node.cjs', default: './default.cjs' },
      '#ordered': {
        'declaration-first': './declaration.cjs',
        'argument-first': './argument.cjs',
        node: './node.cjs',
      },
    },
  }),
  'declaration.cjs': 'module.exports="declaration-first";',
  'argument.cjs': 'module.exports="argument-first";',
  'development.cjs': 'module.exports="development";',
  'node.cjs': 'module.exports="node";',
  'default.cjs': 'module.exports="default";',
  'target.js': '',
  'alternate/target.js': '',
  'child.mjs': `
import {parentPort} from 'node:worker_threads';
import {createRequire} from 'node:module';
import branch from '#branch';
import ordered from '#ordered';
const require = createRequire(import.meta.url);
parentPort.postMessage({
  argv: process.execArgv,
  preloads: globalThis.preloadOrder ?? [],
  cached: require('./shared.cjs').count,
  branches: [require('#branch'), branch, (await import('#branch')).default],
  order: [require('#ordered'), ordered, (await import('#ordered')).default],
  alternateParent: import.meta.resolve('./target.js', new URL('./alternate/anchor.mjs', import.meta.url)).endsWith('/alternate/target.js'),
  builtin: import.meta.resolve('node:fs'),
});`,
};

export const workerStartupOptionsCases: readonly WorkerStartupOptionsCase[] = [
  {
    name: 'effective-options',
    files: common,
    workers: 2,
    parent: `${launch}
(async () => {
  globalThis.preloadOrder = ['parent'];
  const args=${JSON.stringify(flags)};
  const first=run('child.mjs',args); args.length=0;
  console.log('OPTIONS|' + JSON.stringify(await first));
  console.log('OPTIONS|' + JSON.stringify(await run('child.mjs', [])));
  console.log('OPTIONS|parent=' + JSON.stringify(globalThis.preloadOrder));
})()${finish}`,
  },
  {
    name: 'trusted-recursive-inheritance',
    workers: 3,
    files: {
      ...common,
      'middle.cjs': `
const {Worker,parentPort}=require('node:worker_threads');
const {resolve}=require('node:path');
const original=[...process.execArgv];
process.execArgv.length=0;
function child(options) { return new Promise((done,reject) => {
 const worker=new Worker(resolve('child.mjs'),options); let result;
 worker.once('message',value=>{result=value});worker.once('error',reject);worker.once('exit',code=>code===0?done(result):reject(new Error('exit='+code)));
}); }
(async()=>parentPort.postMessage({original,inherited:await child(undefined),cleared:await child({execArgv:[]}),public:process.execArgv}))().catch(error=>{throw error});`,
    },
    parent: `${launch}
(async () => {console.log('OPTIONS|' + JSON.stringify(await run('middle.cjs', ${JSON.stringify(flags)})));})()${finish}`,
  },
  ...(['missing', 'throwing'] as const).map(
    (failure): WorkerStartupOptionsCase => ({
      name: `preload-${failure}`,
      workers: 1,
      files: {
        'entry.cjs': `console.log('OPTIONS|ENTRY-MUST-NOT-RUN');`,
        'throwing.cjs': `throw new Error('preload-failure');`,
      },
      parent: `${launch}
(async () => {
 await new Promise((done,reject) => {
  const events=[];
  const worker=new Worker(resolve('entry.cjs'),{execArgv:['--require','./${failure}.cjs']});
  worker.once('message',()=>reject(new Error('unexpected message')));
  worker.once('error',error=>events.push(['error',${failure === 'missing' ? 'error.code' : 'error.message'}]));
  worker.once('exit',code=>{events.push(['exit',code]);console.log('OPTIONS|'+JSON.stringify(events));done();});
 });
})()${finish}`,
    }),
  ),
  {
    name: 'malformed-options',
    workers: 1,
    files: { 'entry.cjs': `require('node:worker_threads').parentPort.postMessage('control');` },
    parent: `${launch}
(async()=>{for(const argv of [['--conditions'],['--require']]) {
 try {new Worker(resolve('entry.cjs'),{execArgv:argv});console.log('OPTIONS|NO_THROW');}
 catch(error){console.log('OPTIONS|'+JSON.stringify([error.name,error.code]));}
}console.log('OPTIONS|'+await run('entry.cjs',[]));})()${finish}`,
  },
  ...(
    [
      'typed',
      'explicit-exit',
      'handled',
      'non-error',
      'undefined',
      'function',
      'proxy',
      'code-function',
      'cause-function',
      'serialization-failure',
      'cross-realm',
      'severed-error',
      'metadata',
    ] as const
  ).map(
    (mode): WorkerStartupOptionsCase => ({
      name: `preload-terminal-${mode}`,
      workers: 1,
      files: {
        'entry.cjs': `console.log('OPTIONS|ENTRY-MUST-NOT-RUN');`,
        'fatal.cjs':
          mode === 'typed'
            ? `process.stdout.write('before-fatal\\n'); throw Object.assign(new TypeError('typed-preload-failure'), {code:'E_PRELOAD'});`
            : mode === 'explicit-exit'
              ? 'process.exit(1);'
              : mode === 'handled'
                ? `process.on('uncaughtException', error => { process.stdout.write('handled:' + error.message + '\\n'); }); throw new Error('handled-preload');`
                : mode === 'undefined'
                  ? 'throw undefined;'
                  : mode === 'function'
                    ? 'throw function nope(){};'
                    : mode === 'proxy'
                      ? 'throw new Proxy({a:1},{});'
                      : mode === 'code-function'
                        ? `throw Object.assign(new Error('code-function'),{code:()=>1});`
                        : mode === 'cause-function'
                          ? `throw new Error('cause-function',{cause:()=>1});`
                          : mode === 'serialization-failure'
                            ? `const failure=function(){};Object.defineProperty(failure,'name',{get(){throw new Error('name-getter')}});throw failure;`
                            : mode === 'cross-realm'
                              ? `const error=require('node:vm').runInNewContext("new TypeError('foreign')");
Object.assign(error,{code:'E_FOREIGN',requireStack:['one'],custom:{n:4},stack:'TypeError: foreign\\n    at foreign-origin'});throw error;`
                              : mode === 'severed-error'
                                ? `const error=Object.assign(new TypeError('severed'),{code:'E_SEVERED'});Object.setPrototypeOf(error,null);throw error;`
                                : mode === 'metadata'
                                  ? `throw Object.assign(new TypeError('metadata'),{code:42,requireStack:['one','two'],custom:{n:4}});`
                                  : `throw {kind:'plain-throw', code:'E_PLAIN'};`,
      },
      parent: `${launch}
(async () => {
 await new Promise((done) => {
  const events=[];
  const worker=new Worker(resolve('entry.cjs'),{execArgv:['--require','./fatal.cjs'], stdout:true, stderr:true});
  worker.stdout.on('data', bytes=>events.push(['stdout', bytes.toString().trim()]));
  worker.stderr.resume();
  worker.on('error',error=>events.push(['error', ${
    ['cross-realm', 'severed-error', 'metadata'].includes(mode)
      ? `({name:error.name,message:error.message,code:error.code,requireStack:error.requireStack,custom:error.custom,isTypeError:error instanceof TypeError,stackMessage:typeof error.stack === 'string' && error.stack.includes(error.message)})`
      : `error instanceof Error ? {
   name:error.name, message:error.message, code:error.code, cause:error.cause, source:error.stack.includes('fatal.cjs:')
  } : error`
  }]));
  worker.once('exit',code=>{events.push(['exit',code]);console.log('OPTIONS|'+JSON.stringify(events));done();});
 });
})()${finish}`,
    }),
  ),
];

/** Existing util.inspect.custom boundary; deliberately separate from supported native parity. */
export const workerCustomInspectCeilingCase: WorkerStartupOptionsCase = {
  name: 'custom-inspect-ceiling',
  workers: 1,
  files: {
    'entry.cjs': `console.log('OPTIONS|ENTRY-MUST-NOT-RUN');`,
    'custom.cjs': `throw {fn:()=>1, [Symbol.for('nodejs.util.inspect.custom')](){throw function inspectFailure(){}}};`,
  },
  parent: `${launch}
(async()=>{await new Promise(done=>{
 const events=[];
 const worker=new Worker(resolve('entry.cjs'),{execArgv:['--require','./custom.cjs'],stderr:true});
 worker.stderr.resume();
 worker.on('error',error=>events.push(['error',error.name,error.code ?? null,error.feature ?? null]));
 worker.on('exit',code=>{events.push(['exit',code]);console.log('OPTIONS|'+JSON.stringify(events));done();});
});})()${finish}`,
};
