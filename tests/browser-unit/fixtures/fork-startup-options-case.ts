import type { ParityCase } from '../../../tools/node-parity-runner/src/types.ts';

const flags = [
  '--experimental-import-meta-resolve',
  '--require',
  './preload.cjs',
  '--conditions',
  'node',
  '--conditions',
  'development',
];
const files = {
  'marker.js': '',
  'nested/marker.js': '',
  'preload.cjs': 'globalThis.__preloadRuns = (globalThis.__preloadRuns || 0) + 1;',
  'child.cjs': `
(async () => {
 const esm = await import('./resolver.mjs');
 process.send({execArgv: process.execArgv, preload: globalThis.__preloadRuns || 0,
   requireCondition: require('#branch'), importCondition: esm.selected,
   secondResolveParent: esm.secondResolveParent});
 process.disconnect();
})().catch(error => {console.error(error);process.exitCode=1;process.disconnect();});`,
  'resolver.mjs': `import selected from '#branch';
import {pathToFileURL} from 'node:url';
export {selected};
export const secondResolveParent = import.meta.resolve('./marker.js', pathToFileURL(process.cwd() + '/nested/base.mjs')).endsWith('/nested/marker.js');`,
  'package.json': JSON.stringify({
    name: 'fork-branch-probe',
    imports: {
      '#branch': { development: './development.cjs', node: './node.cjs', default: './default.cjs' },
    },
  }),
  'development.cjs': `module.exports='development';`,
  'node.cjs': `module.exports='node';`,
  'default.cjs': `module.exports='default';`,
};

export const forkStartupOptionsCase: ParityCase = {
  kind: 'child-worker',
  cwd: '/scratch',
  expectedPhysicalWorkers: 4,
  setup: {
    files: Object.fromEntries(
      Object.entries(files).map(([path, source]) => [`scratch/${path}`, source]),
    ),
  },
  code: `
const {fork} = require('node:child_process');
function launch(label, execArgv) {
 return new Promise((resolve, reject) => {
  const child = fork('./child.cjs', [], {silent:true, ...(execArgv === undefined ? {} : {execArgv})});
  child.on('message', message => console.log('FORK_OPTIONS|' + JSON.stringify({label, ...message})));
  child.stderr.on('data', bytes => console.error(bytes.toString()));
  child.on('error', reject);
  child.on('close', (code, signal) => {
    console.log('FORK_OPTIONS|' + JSON.stringify({label, code, signal}));
    code === 0 ? resolve() : reject(new Error('child exit=' + code));
  });
 });
}
(async () => {
 await launch('vitest-family', ${JSON.stringify(flags)});
 const callerArgs = ${JSON.stringify(flags)};
 const snapshot = launch('caller-snapshot', callerArgs);
 callerArgs.length = 0;
 await snapshot;
 const original = process.execArgv;
 try {
  process.execArgv = ${JSON.stringify(flags)};
  const inherited = launch('public-default');
  process.execArgv.length = 0;
  await inherited;
  process.execArgv = ${JSON.stringify(flags)};
  await launch('explicit-empty', []);
 } finally { process.execArgv = original; }
})().catch(error => {console.error(error); process.exitCode=1;});
`,
};
