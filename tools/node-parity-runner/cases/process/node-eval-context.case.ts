import { nodeCliEvalSourceTerminatorMatrix } from '../../src/node-cli-eval.ts';
import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

function separated(
  label: string,
  option: '-e' | '--eval' | '-p' | '--print' | '-pe' | '--print=ignored',
  source: string,
  scriptArgs: readonly string[] = [],
  separator = false,
  policies: Pick<NodeCliEvalInvocation, 'evalErrorStderr' | 'rejectedPromiseStdout'> = {},
): NodeCliEvalInvocation {
  return {
    label,
    nodeArgv: [option, source, ...(separator ? ['--'] : []), ...scriptArgs],
    ...policies,
  };
}

function inlineEval(
  label: string,
  source: string,
  scriptArgs: readonly string[] = [],
): NodeCliEvalInvocation {
  return {
    label,
    nodeArgv: [`--eval=${source}`, ...scriptArgs],
  };
}

function barePrint(
  label: string,
  option: '-p' | '--print' | '--print=ignored',
): NodeCliEvalInvocation {
  return {
    label,
    nodeArgv: [option],
  };
}

const identitySource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const realmPromise = Object.getPrototypeOf((async () => {})()).constructor;
const realmPromisePrototype = realmPromise.prototype;
const initialPromiseDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
const promiseRealmSnapshot = () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
  return {
    descriptor: {
      valueIdentity: descriptor?.value === realmPromise,
      writable: descriptor?.writable,
      enumerable: descriptor?.enumerable,
      configurable: descriptor?.configurable,
    },
    descriptorUnchanged:
      descriptor?.value === initialPromiseDescriptor?.value &&
      descriptor?.writable === initialPromiseDescriptor?.writable &&
      descriptor?.enumerable === initialPromiseDescriptor?.enumerable &&
      descriptor?.configurable === initialPromiseDescriptor?.configurable,
    constructorIdentity: Promise === realmPromise,
    prototypeIdentity: Promise.prototype === realmPromisePrototype,
  };
};
const promiseBefore = promiseRealmSnapshot();
const cjsBindingValues = {
  require,
  module,
  exports: module.exports,
  __filename: '[eval]',
  __dirname: '.',
};
const cjsBindingDescriptors = Object.fromEntries(
  ['require', 'module', 'exports', '__filename', '__dirname'].map((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
    return [name, {
      valueIdentity: descriptor?.value === cjsBindingValues[name],
      writable: descriptor?.writable,
      enumerable: descriptor?.enumerable,
      configurable: descriptor?.configurable,
    }];
  }),
);
const launchCwd = process.cwd();
const visibleEntries = fs.readdirSync(launchCwd).sort();
const ownerBytes = fs.readFileSync(path.join(launchCwd, 'owner-only.txt'), 'utf8');
const child = require('./marker.cjs');
const packageValue = require('eval-package');
const resolvedBefore = require.resolve('./marker.cjs');
process.chdir('/');
const resolvedAfter = require.resolve('./marker.cjs');
const promiseDuring = promiseRealmSnapshot();
setImmediate(() => {
  console.log(JSON.stringify({ promiseRealmAfter: promiseRealmSnapshot() }));
});
const expectedPaths = [];
let cursor = launchCwd;
for (;;) {
  expectedPaths.push(path.join(cursor, 'node_modules'));
  if (cursor === '/') break;
  cursor = path.dirname(cursor);
}
console.log(JSON.stringify({
  argv: [process.argv[0] === process.execPath, ...process.argv.slice(1)],
  argv0Identity: process.argv0 === (process.platform === 'rifty' ? 'rifty' : process.execPath),
  execArgv: process.execArgv,
  filename: __filename,
  dirname: __dirname,
  module: {
    id: module.id,
    filename: module.filename === path.resolve(launchCwd, '[eval]'),
    path: module.path,
    paths: JSON.stringify(module.paths) === JSON.stringify(expectedPaths),
    parent: module.parent ?? null,
    loaded: module.loaded,
  },
  requireMain: require.main ?? null,
  mainModule: process.mainModule ?? null,
  thisGlobal: this === globalThis,
  argumentsType: typeof arguments,
  cjsBindingDescriptors,
  exportsModuleIdentity: exports === module.exports,
  cached: Object.values(require.cache).includes(module),
  ownerBytes,
  noEvalCarrier: JSON.stringify(visibleEntries) === JSON.stringify(['marker.cjs','node_modules','owner-only.txt']),
  resolvedBefore: resolvedBefore === path.join(launchCwd, 'marker.cjs'),
  resolvedAfter: resolvedAfter === path.join(launchCwd, 'marker.cjs'),
  child: {
    marker: child.marker,
    parentId: child.parentId,
    parentFilename: child.parentFilename === path.resolve(launchCwd, '[eval]'),
    parentIdentity: child.parent === module,
  },
  packageValue,
  promiseRealm: {
    before: promiseBefore,
    during: promiseDuring,
  },
}));
`;

const isolationSource = String.raw`
const child = require('./marker.cjs');
console.log(JSON.stringify({
  arg: process.argv[1],
  argv0Identity: process.argv0 === (process.platform === 'rifty' ? 'rifty' : process.execPath),
  marker: child.marker,
  moduleId: module.id,
  childParent: child.parentId,
  childParentIdentity: child.parent === module,
  cached: Object.values(require.cache).includes(module),
}));
`;

const promiseRealmIdentitySource = String.raw`
const realmPromise = Object.getPrototypeOf((async () => {})()).constructor;
const realmPromisePrototype = realmPromise.prototype;
const initialPromiseDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
const snapshot = () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Promise');
  return {
    descriptor: {
      valueIdentity: descriptor?.value === realmPromise,
      writable: descriptor?.writable,
      enumerable: descriptor?.enumerable,
      configurable: descriptor?.configurable,
    },
    descriptorUnchanged:
      descriptor?.value === initialPromiseDescriptor?.value &&
      descriptor?.writable === initialPromiseDescriptor?.writable &&
      descriptor?.enumerable === initialPromiseDescriptor?.enumerable &&
      descriptor?.configurable === initialPromiseDescriptor?.configurable,
    constructorIdentity: Promise === realmPromise,
    prototypeIdentity: Promise.prototype === realmPromisePrototype,
  };
};
const before = snapshot();
const completion = Promise.resolve(42);
const during = snapshot();
setImmediate(() => {
  console.log(JSON.stringify({
    promiseRealm: {
      before,
      during,
      after: snapshot(),
      completionConstructorIdentity: completion.constructor === realmPromise,
      completionPrototypeIdentity: Object.getPrototypeOf(completion) === realmPromisePrototype,
    },
  }));
});
completion
`;

const terminatorSource =
  'const value=JSON.stringify({execArgv:process.execArgv,argv:process.argv.slice(1)});console.log(value);value';
const orderedStdioSource =
  "let phase=0;process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{for(const token of chunk){if(phase===0&&token==='1'){phase=1;process.stderr.write('stderr-middle\\n')}else if(phase===1&&token==='2'){phase=2;process.stdout.write(new Uint8Array([172]));process.stdout.write('stdout-tail\\n');process.stdin.pause();process.stdin.destroy?.()}else{throw new Error('stdio handshake protocol')}}});process.stdout.write('stdout-head|');process.stdout.write(new Uint8Array([226,130]))";
const eofOrderedStdioSource =
  "let released=false;process.stdin.setEncoding('utf8');process.stdin.on('data',chunk=>{for(const token of chunk){if(!released&&token==='1'){released=true;process.stdout.write('stdout-eof-last');process.stdin.pause();process.stdin.destroy?.()}else{throw new Error('stdio handshake protocol')}}});process.stderr.write('stderr-eof-first|')";
const terminatorInvocations = [
  ...nodeCliEvalSourceTerminatorMatrix(terminatorSource, ['alpha', 'two words', '-x'])
    .filter(({ expected }) => expected.kind === 'accepted')
    .map(({ label, nodeArgv }) => ({ label, nodeArgv })),
  {
    label: 'terminator-inline-long-eval',
    nodeArgv: [`--eval=${terminatorSource}`, '--', 'alpha', 'two words', '-x'],
  },
] satisfies readonly NodeCliEvalInvocation[];

const sequential: NodeCliEvalInvocation[] = [
  {
    ...separated('identity-and-resolver', '--eval', identitySource, ['alpha', 'two words']),
    cwd: '/fixtures/a',
  },
  {
    ...separated('isolation-sequential-b', '-e', isolationSource, ['b']),
    cwd: '/fixtures/b',
  },
];

const concurrent: NodeCliEvalInvocation[] = [
  ...terminatorInvocations,
  {
    ...separated(
      'short-e-partial-stdout-around-stderr',
      '-e',
      orderedStdioSource,
      ['alpha', 'two words', '-x'],
      true,
    ),
    stdioHandshake: [
      { stream: 'stdout', marker: 'stdout-head|' },
      { stream: 'stderr', marker: 'stderr-middle\n' },
    ],
  },
  {
    ...separated('short-e-stderr-before-stdout-eof', '-e', eofOrderedStdioSource),
    stdioHandshake: [{ stream: 'stderr', marker: 'stderr-eof-first|' }],
  },
  inlineEval(
    'inline-long-eval-global-script',
    'var evalGlobal=41;console.log(JSON.stringify({thisGlobal:this===globalThis,argumentsType:typeof arguments,global:globalThis.evalGlobal+1,execArgv:process.execArgv}))',
  ),
  separated(
    'short-print-raw-string',
    '-p',
    "console.log(JSON.stringify(process.execArgv));'hello'",
  ),
  separated(
    'long-print-array-bigint',
    '--print',
    'console.log(JSON.stringify(process.execArgv));[1,{big:2n}]',
  ),
  separated(
    'print-equals-ignored',
    '--print=ignored',
    'JSON.stringify({execArgv:process.execArgv,args:process.argv.slice(1)})',
    ['arg'],
  ),
  separated(
    'combined-print-eval-fulfilled-promise',
    '-pe',
    `console.log(JSON.stringify({execArgv:process.execArgv}));${promiseRealmIdentitySource}`,
  ),
  { label: 'explicit-empty-short-eval', nodeArgv: ['-e', ''] },
  { label: 'explicit-empty-long-eval', nodeArgv: ['--eval', ''] },
  { label: 'explicit-empty-combined-print-eval', nodeArgv: ['-pe', ''] },
  { label: 'explicit-empty-short-print', nodeArgv: ['-p', ''] },
  { label: 'explicit-empty-long-print', nodeArgv: ['--print', ''] },
  {
    label: 'explicit-empty-print-equals-ignored',
    nodeArgv: ['--print=ignored', ''],
  },
  barePrint('bare-short-print', '-p'),
  barePrint('bare-long-print', '--print'),
  barePrint('bare-print-equals-ignored', '--print=ignored'),
  separated(
    'circular-after-timer-drain',
    '-p',
    "const value={phase:'before'};value.self=value;setTimeout(()=>{console.log('timer');value.phase='after'},0);value",
  ),
  separated(
    'timer-settled-promise',
    '-p',
    'let settle;const promise=new Promise(resolve=>{settle=resolve});setTimeout(()=>settle(42),0);promise',
  ),
  separated('pending-promise', '-p', 'new Promise(()=>{})'),
  separated(
    'rejected-promise-print-before-error',
    '-p',
    "Promise.reject(new Error('print-nope'))",
    [],
    false,
    { rejectedPromiseStdout: true, evalErrorStderr: true },
  ),
  separated(
    'late-throw-prints-before-error',
    '-p',
    "setTimeout(()=>{throw new Error('later')},0);42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'late-rejection-prints-before-error',
    '-p',
    "setTimeout(()=>Promise.reject(new Error('later rejection')),0);42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated('late-process-exit-prints-before-exit', '-p', 'setTimeout(()=>process.exit(7),0);42'),
  separated(
    'microtask-throw-prints-before-error',
    '-p',
    "queueMicrotask(()=>{throw new Error('microtask later')});42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'promise-reaction-throw-prints-before-error',
    '-p',
    "Promise.resolve().then(()=>{throw new Error('then later')});42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'microtask-rejection-prints-before-error',
    '-p',
    "queueMicrotask(()=>Promise.reject(new Error('microtask rejection')));42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'microtask-process-exit-prints-before-exit',
    '-p',
    'queueMicrotask(()=>process.exit(7));42',
  ),
  separated(
    'served-late-throw-prints-before-error',
    '-p',
    "require('node:http').createServer((_q,r)=>r.end('unused')).listen(43161,()=>setTimeout(()=>{throw new Error('served later')},0));42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'served-late-rejection-prints-before-error',
    '-p',
    "require('node:http').createServer((_q,r)=>r.end('unused')).listen(43162,()=>Promise.reject(new Error('served rejection')));42",
    [],
    false,
    { evalErrorStderr: true },
  ),
  separated(
    'served-late-process-exit-prints-before-exit',
    '-p',
    "require('node:http').createServer((_q,r)=>r.end('unused')).listen(43163,()=>process.exit(7));42",
  ),
  separated('exit-code-after-print', '-p', 'process.exitCode=7;42'),
  separated('forced-exit-suppresses-print', '-p', 'process.exit(7);42'),
  separated('throw-user-frame', '-e', "throw new Error('boom')", [], false, {
    evalErrorStderr: true,
  }),
  separated('syntax-user-prelude', '-e', 'return 1', [], false, { evalErrorStderr: true }),
  separated(
    'unhandled-rejection-user-frame',
    '-e',
    "Promise.reject(new Error('unhandled'))",
    [],
    false,
    { evalErrorStderr: true },
  ),
  {
    ...separated('isolation-concurrent-a', '-e', isolationSource, ['a']),
    cwd: '/fixtures/a',
  },
  {
    ...separated('isolation-concurrent-b', '-e', isolationSource, ['b']),
    cwd: '/fixtures/b',
  },
];

export default {
  kind: 'node-cli-eval',
  code: '',
  cwd: '/',
  setup: {
    files: {
      'fixtures/a/marker.cjs':
        "module.exports={marker:'a',parent:module.parent,parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
      'fixtures/a/owner-only.txt': 'owner-a',
      'fixtures/a/node_modules/eval-package/index.js': "module.exports='package-a'\n",
      'fixtures/b/marker.cjs':
        "module.exports={marker:'b',parent:module.parent,parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
      'fixtures/b/owner-only.txt': 'owner-b',
      'fixtures/b/node_modules/eval-package/index.js': "module.exports='package-b'\n",
    },
  },
  expectedPhysicalWorkers: sequential.length + concurrent.length,
  nodeCliEval: { sequential, concurrent },
} satisfies ParityCase;
