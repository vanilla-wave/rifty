import type { ParityCase } from '../../src/types.ts';
import { startupFilesUnder } from '../process/startup-options-program.ts';

// ADR-0449 §2: `fork(modulePath, args, { execArgv })` starts the child with
// Node's startup options — its exact `process.execArgv`, `--require` preloads
// run in order from the child's cwd (the `cwd` option) before the entry,
// `--conditions` for every resolution, `--experimental-import-meta-resolve` for
// import.meta.resolve's parent argument. A preload that cannot be found ends the
// child with exit 1 and Node's "Cannot find module" error on its stderr. Without
// `execArgv`, fork passes the parent's public `process.execArgv` as it is at the
// call (a mutated array included).
const c: ParityCase = {
  cwd: '/project',
  setup: { files: startupFilesUnder('project') },
  code: `
    const { fork } = require('node:child_process');
    const { resolve } = require('node:path');
    const process = require('node:process');
    const run = (label, entry, options) =>
      new Promise((done) => {
        let facts = null;
        let stderr = '';
        let child;
        try {
          child = fork(resolve(entry), [], { silent: true, ...options });
        } catch (error) {
          console.log(label, 'throw', error.name, error.message);
          done();
          return;
        }
        child.stderr.on('data', (chunk) => { stderr += chunk; });
        child.on('message', (message) => { facts = message; });
        child.on('exit', (code) =>
          setImmediate(() => {
            const missing = stderr.split('\\n').find((line) => line.startsWith('Error: Cannot find module'));
            console.log(label, 'exit', code, JSON.stringify(facts), missing ?? '');
            done();
          }),
        );
      });
    const cases = [
      ['empty', 'probe.cjs', { execArgv: [] }],
      ['require', 'probe.cjs', { execArgv: ['--require', './pre.cjs'] }],
      ['short', 'probe.cjs', { execArgv: ['-r', './pre.cjs', '-C', 'custom'] }],
      ['order-child-cwd', 'probe.cjs', { cwd: 'sub', execArgv: ['--require', './pre.cjs', '--require', '../pre2.cjs'] }],
      [
        'inline-esm',
        'probe.mjs',
        { execArgv: ['--require=./pre.cjs', '--conditions=custom', '--experimental-import-meta-resolve'] },
      ],
      ['missing-preload', 'probe.cjs', { execArgv: ['--require', './missing.cjs'] }],
      ['default', 'probe.cjs', {}],
      ['default-mutated', 'probe.cjs', {}],
    ];
    (async () => {
      for (const [label, entry, options] of cases) {
        if (label === 'default-mutated') process.execArgv.push('--conditions=custom');
        try {
          await run(label, entry, options);
        } finally {
          if (label === 'default-mutated') process.execArgv.pop();
        }
      }
    })();
  `,
  expected:
    'empty exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"} \n' +
    'require exit 0 {"execArgv":["--require","./pre.cjs"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require","./pre.cjs"],"cpkg":"req"},"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"} \n' +
    'short exit 0 {"execArgv":["-r","./pre.cjs","-C","custom"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["-r","./pre.cjs","-C","custom"],"cpkg":"custom"},"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"custom"} \n' +
    'order-child-cwd exit 0 {"execArgv":["--require","./pre.cjs","--require","../pre2.cjs"],"pre":["pre-sub","pre2"],"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"} \n' +
    'inline-esm exit 0 {"execArgv":["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"],"pre":["pre"],"preFacts":{"requireMain":"undefined","execArgv":["--require=./pre.cjs","--conditions=custom","--experimental-import-meta-resolve"],"cpkg":"custom"},"static":"custom","staticSub":"custom-sub","dynamicImport":"custom","metaBare":"node_modules/cpkg/custom.js","metaParent":"sub/a.mjs","metaParentUrl":"sub/a.mjs","metaParentInvalid":"TypeError:ERR_UNSUPPORTED_RESOLVE_REQUEST","metaParentBare":"sub/node_modules/lpkg/index.js","warnings":["VM Modules is an experimental feature and might change at any time","other warning"]} \n' +
    "missing-preload exit 1 null Error: Cannot find module './missing.cjs'\n" +
    'default exit 0 {"execArgv":[],"pre":null,"preFacts":null,"require":"req","requireResolve":"node_modules/cpkg/def-sub.js","imports":"i-def","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"imp"} \n' +
    'default-mutated exit 0 {"execArgv":["--conditions=custom"],"pre":null,"preFacts":null,"require":"custom","requireResolve":"node_modules/cpkg/custom-sub.js","imports":"i-custom","warnings":["VM Modules is an experimental feature and might change at any time","other warning"],"dynamicImport":"custom"} \n',
  kind: 'child-worker',
  expectedPhysicalWorkers: 8,
};

export default c;
