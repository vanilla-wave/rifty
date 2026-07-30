import type { NodeCliEvalInvocation, ParityCase } from '../../src/types.ts';

function separated(
  label: string,
  option: '-e' | '--eval' | '-p' | '--print' | '-pe' | '--print=ignored',
  source: string,
  print: boolean,
  scriptArgs: readonly string[] = [],
  separator = false,
  policies: Pick<NodeCliEvalInvocation, 'evalErrorStderr' | 'rejectedPromiseStdout'> = {},
): NodeCliEvalInvocation {
  return {
    label,
    nodeArgv: [option, source, ...(separator ? ['--'] : []), ...scriptArgs],
    source,
    print,
    execArgv: [option, source],
    scriptArgs,
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
    source,
    print: false,
    execArgv: [`--eval=${source}`],
    scriptArgs,
  };
}

function barePrint(
  label: string,
  option: '-p' | '--print' | '--print=ignored',
): NodeCliEvalInvocation {
  return {
    label,
    nodeArgv: [option],
    source: '',
    print: true,
    execArgv: [option],
    scriptArgs: [],
  };
}

const identitySource = String.raw`
const fs = require('node:fs');
const path = require('node:path');
const launchCwd = process.cwd();
const visibleEntries = fs.readdirSync(launchCwd).sort();
const child = require('./marker.cjs');
const packageValue = require('eval-package');
const resolvedBefore = require.resolve('./marker.cjs');
process.chdir('/');
const resolvedAfter = require.resolve('./marker.cjs');
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
  cached: Object.values(require.cache).includes(module),
  noEvalCarrier: JSON.stringify(visibleEntries) === JSON.stringify(['marker.cjs','node_modules']),
  resolvedBefore: resolvedBefore === path.join(launchCwd, 'marker.cjs'),
  resolvedAfter: resolvedAfter === path.join(launchCwd, 'marker.cjs'),
  child: {
    marker: child.marker,
    parentId: child.parentId,
    parentFilename: child.parentFilename === path.resolve(launchCwd, '[eval]'),
  },
  packageValue,
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
  cached: Object.values(require.cache).includes(module),
}));
`;

const sequential: NodeCliEvalInvocation[] = [
  {
    ...separated('identity-and-resolver', '--eval', identitySource, false, ['alpha', 'two words']),
    cwd: '/fixtures/a',
  },
  {
    ...separated('isolation-sequential-b', '-e', isolationSource, false, ['b']),
    cwd: '/fixtures/b',
  },
];

const concurrent: NodeCliEvalInvocation[] = [
  separated(
    'short-e-order-and-separator',
    '-e',
    "console.log(JSON.stringify({execArgv:process.execArgv,argv:process.argv.slice(1)}));setTimeout(()=>console.error('stderr-after'),5);setTimeout(()=>console.log('stdout-last'),10)",
    false,
    ['alpha', 'two words', '-x'],
    true,
  ),
  inlineEval(
    'inline-long-eval-global-script',
    'var evalGlobal=41;console.log(JSON.stringify({thisGlobal:this===globalThis,argumentsType:typeof arguments,global:globalThis.evalGlobal+1,execArgv:process.execArgv}))',
  ),
  separated(
    'short-print-raw-string',
    '-p',
    "console.log(JSON.stringify(process.execArgv));'hello'",
    true,
  ),
  separated(
    'long-print-array-bigint',
    '--print',
    'console.log(JSON.stringify(process.execArgv));[1,{big:2n}]',
    true,
  ),
  separated(
    'print-equals-ignored',
    '--print=ignored',
    'JSON.stringify({execArgv:process.execArgv,args:process.argv.slice(1)})',
    true,
    ['arg'],
  ),
  separated(
    'combined-print-eval-fulfilled-promise',
    '-pe',
    'console.log(JSON.stringify({execArgv:process.execArgv}));Promise.resolve(42)',
    true,
  ),
  barePrint('bare-short-print', '-p'),
  barePrint('bare-long-print', '--print'),
  barePrint('bare-print-equals-ignored', '--print=ignored'),
  separated(
    'circular-after-timer-drain',
    '-p',
    "const value={phase:'before'};value.self=value;setTimeout(()=>{console.log('timer');value.phase='after'},0);value",
    true,
  ),
  separated(
    'timer-settled-promise',
    '-p',
    'let settle;const promise=new Promise(resolve=>{settle=resolve});setTimeout(()=>settle(42),0);promise',
    true,
  ),
  separated('pending-promise', '-p', 'new Promise(()=>{})', true),
  separated(
    'rejected-promise-print-before-error',
    '-p',
    "Promise.reject(new Error('print-nope'))",
    true,
    [],
    false,
    { rejectedPromiseStdout: true, evalErrorStderr: true },
  ),
  separated('exit-code-after-print', '-p', 'process.exitCode=7;42', true),
  separated('forced-exit-suppresses-print', '-p', 'process.exit(7);42', true),
  separated('throw-user-frame', '-e', "throw new Error('boom')", false, [], false, {
    evalErrorStderr: true,
  }),
  separated('syntax-user-prelude', '-e', 'return 1', false, [], false, { evalErrorStderr: true }),
  separated(
    'unhandled-rejection-user-frame',
    '-e',
    "Promise.reject(new Error('unhandled'))",
    false,
    [],
    false,
    { evalErrorStderr: true },
  ),
  {
    ...separated('isolation-concurrent-a', '-e', isolationSource, false, ['a']),
    cwd: '/fixtures/a',
  },
  {
    ...separated('isolation-concurrent-b', '-e', isolationSource, false, ['b']),
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
        "module.exports={marker:'a',parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
      'fixtures/a/node_modules/eval-package/index.js': "module.exports='package-a'\n",
      'fixtures/b/marker.cjs':
        "module.exports={marker:'b',parentId:module.parent?.id,parentFilename:module.parent?.filename}\n",
      'fixtures/b/node_modules/eval-package/index.js': "module.exports='package-b'\n",
    },
  },
  expectedPhysicalWorkers: sequential.length + concurrent.length,
  nodeCliEval: { sequential, concurrent },
} satisfies ParityCase;
