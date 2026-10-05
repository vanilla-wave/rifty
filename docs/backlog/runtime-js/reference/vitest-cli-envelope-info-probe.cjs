const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const base = '/tmp/rifty-vitest-native';
const rows = [];
for (const args of [
  ['run', '--help'],
  ['run', '-h'],
  ['run', '--pool=threads', '--help'],
  ['run', '--watch', '--help'],
  ['run', '--help', '--expand-help'],
  ['run', '--version'],
  ['--reporter=verbose', 'run'],
  ['--pool=threads', 'run'],
]) {
  const snippet = `process.argv=${JSON.stringify([process.execPath, `${base}/node_modules/vitest/vitest.mjs`, ...args])}; const {parseCLI}=await import('${base}/node_modules/vitest/dist/node.js'); const p=parseCLI(['vitest',...process.argv.slice(2)]); process.stderr.write(JSON.stringify(p));`;
  const helper = spawnSync(process.execPath, ['--input-type=module', '-e', snippet], {
    cwd: base,
    encoding: 'utf8',
    timeout: 10000,
  });
  const cli = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', ...args], {
    cwd: base,
    encoding: 'utf8',
    timeout: 10000,
  });
  let p;
  try {
    p = JSON.parse(helper.stderr);
  } catch {}
  rows.push({
    args,
    parsed: p,
    helperCode: helper.status,
    cliCode: cli.status,
    helperStdout: helper.stdout,
    cliStdout: cli.stdout,
    helpOutputEqual: p?.options?.help ? helper.stdout === cli.stdout : undefined,
    cliBanner: cli.stdout.match(/(?:RUN|DEV)\s+v4\.1\.11/)?.[0],
  });
}
writeFileSync(
  '/tmp/vitest-envelope-info-probe.json',
  JSON.stringify({ node: process.version, vitest: '4.1.11', vite: '8.0.16', rows }, null, 2),
);
console.log(
  rows.map(({ args, parsed, helperCode, cliCode, helpOutputEqual, cliBanner }) => ({
    args,
    parsed,
    helperCode,
    cliCode,
    helpOutputEqual,
    cliBanner,
  })),
);
