import type { ParityCase } from '../../src/types.ts';
import { startupFilesUnder } from '../process/startup-options-program.ts';

// ADR-0449 §2: a Worker's `execArgv` (`-r`/`--require`, `-C`/`--conditions`,
// `--experimental-import-meta-resolve`, separate and `=` spellings) becomes the
// worker's exact `process.execArgv`; preloads run in order, from the worker's
// cwd, before the entry (`require.main` unset, conditions already active); the
// conditions select package `exports`/`imports` targets for require,
// require.resolve, static and dynamic import and import.meta.resolve; the flag
// makes import.meta.resolve honour its parent argument (ignored without it). A
// falsy `execArgv` and an omitted one inherit the parent thread's startup
// options, which a mutated public `process.execArgv` does not change.
const c: ParityCase = {
  cwd: '/project',
  setup: { files: startupFilesUnder('project') },
  code: `
    const { Worker } = require('node:worker_threads');
    const { resolve } = require('node:path');
    const process = require('node:process');
    const run = (label, entry, options) =>
      new Promise((done) => {
        let facts = null;
        let worker;
        try {
          worker = new Worker(resolve(entry), options);
        } catch (error) {
          console.log(label, 'throw', error.name, error.code, error.message);
          done();
          return;
        }
        worker.on('message', (message) => { facts = message; });
        worker.on('error', () => {});
        worker.on('exit', (code) => {
          console.log(label, 'exit', code, JSON.stringify(facts));
          done();
        });
      });
    const cases = [
      ['empty', 'probe.cjs', { execArgv: [] }],
      ['require', 'probe.cjs', { execArgv: ['--require', './pre.cjs'] }],
      ['short', 'probe.cjs', { execArgv: ['-r', './pre.cjs', '-C', 'custom'] }],
      ['order', 'probe.cjs', { execArgv: ['--require', './pre.cjs', '--require', './pre2.cjs'] }],
      [
        'inline-esm',
        'probe.mjs',
        { execArgv: ['--require=./pre.cjs', '--conditions=custom', '--experimental-import-meta-resolve'] },
      ],
      ['development', 'probe.mjs', { execArgv: ['--conditions', 'node', '--conditions', 'development'] }],
      ['no-flag-esm', 'probe.mjs', { execArgv: [] }],
      ['falsy', 'probe.cjs', { execArgv: null }],
      ['inherit-mutated', 'probe.cjs', {}],
    ];
    (async () => {
      for (const [label, entry, options] of cases) {
        if (label === 'inherit-mutated') process.execArgv.push('--conditions=custom');
        try {
          await run(label, entry, options);
        } finally {
          if (label === 'inherit-mutated') process.execArgv.pop();
        }
      }
    })();
  `,
  expected:
    'empty exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"}\n' +
    'require exit 0 {"execArgv":["--require","./pre.cjs"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs"],"cpkg":"req"},"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"}\n' +
    'short exit 0 {"execArgv":["-r","./pre.cjs","-C","custom"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["-r","./pre.cjs","-C","custom"],"cpkg":"custom"},"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"custom"}\n' +
    'order exit 0 {"execArgv":["--require","./pre.cjs","--require","./pre2.cjs"],"pre":["pre","pre2"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs","--require","./pre2.cjs"],"cpkg":"req"},"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"}\n' +
    'inline-esm exit 0 {"execArgv":["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"],"cpkg":"custom"},"static":"custom","staticSub":"custom-sub","dynamicImport":"custom","metaBare":"node_modules/cpkg/custom.js","metaParent":"sub/a.mjs","metaParentUrl":"sub/a.mjs","metaParentInvalid":"TypeError:ERR_UNSUPPORTED_RESOLVE_REQUEST","metaParentBare":"sub/node_modules/lpkg/index.js","warnings":["VM Modules is an experimental feature and might change at any time","other warning"]}\n' +
    'development exit 0 {"execArgv":["--conditions","node","--conditions","development"],"pre":null,"preFacts":null,"static":"dev","staticSub":"def-sub","dynamicImport":"dev","metaBare":"node_modules/cpkg/dev.js","metaParent":"a.mjs","metaParentUrl":"a.mjs","metaParentInvalid":"a.mjs","warnings":["VM Modules is an experimental feature and might change at any time","other warning"]}\n' +
    'no-flag-esm exit 0 {"execArgv":[],"pre":null,"preFacts":null,"static":"imp","staticSub":"def-sub","dynamicImport":"imp","metaBare":"node_modules/cpkg/imp.mjs","metaParent":"a.mjs","metaParentUrl":"a.mjs","metaParentInvalid":"a.mjs","warnings":["VM Modules is an experimental feature and might change at any time","other warning"]}\n' +
    'falsy exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"}\n' +
    'inherit-mutated exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"}\n',
  kind: 'worker-env',
  expectedPhysicalWorkers: 9,
};

export default c;
