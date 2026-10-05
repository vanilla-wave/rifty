import { writeFileSync } from 'node:fs';
import { parseCLI } from '/tmp/rifty-vitest-native/node_modules/vitest/dist/node.js';
const cases = [
  [],
  ['run'],
  ['run', '--pool=threads'],
  ['run', '--pool', 'threads'],
  ['run', '--pool=forks', '--reporter=verbose'],
  ['run', '--reporter', 'watch'],
  ['--watch'],
  ['-w'],
  ['watch'],
  ['dev'],
  ['watch', '--run'],
  ['run', '--watch'],
  ['run', '--watch=true'],
  ['run', '--watch=false'],
  ['run', '--watch', 'false'],
  ['run', '--no-watch'],
  ['run', '-w=false'],
  ['run', '--', '--watch'],
  ['--run'],
  ['--run=false'],
  ['run', '--environment', 'jsdom'],
  ['run', '--environment=happy-dom'],
  ['run', '--coverage'],
  ['run', '--browser.enabled'],
  ['run', '--pool=vmThreads'],
  ['run', '--pool=vmForks'],
  ['run', '--changed'],
  ['list'],
];
const rows = cases.map((args) => {
  const parsed = parseCLI(['vitest', ...args]);
  const options = {};
  for (const key of [
    'run',
    'watch',
    'environment',
    'coverage',
    'browser',
    'pool',
    'changed',
    'reporter',
  ])
    if (parsed.options[key] !== undefined) options[key] = parsed.options[key];
  return { args, options, filter: parsed.filter };
});
writeFileSync(
  'docs/backlog/runtime-js/reference/vitest-cli-admission-oracle.json',
  `${JSON.stringify({ node: process.version, vitest: '4.1.11', vite: '8.0.16', command: 'node /tmp/rifty-vitest-cli-oracle.mjs', rows }, null, 2)}\n`,
);
