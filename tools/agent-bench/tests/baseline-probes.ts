import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentModelServer } from '../../../tests/e2e/fixtures/agent-model-server.ts';
import type { ScriptedReply } from '../../../tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts';
import { loadConfig } from '../src/config.ts';
import type { Lane } from '../src/lanes/types.ts';
import { run } from '../src/runner.ts';
import { loadTasks } from '../src/tasks.ts';

// Separate diagnostic programs; never part of the42 quality-task denominator.
const lane = process.argv[2] as Lane;
assert.ok(['rifty', 'rifty-no-coi', 'local-reference'].includes(lane), 'Pass a lane');
const preinstalled = process.argv[3] === 'vitest';
const read = lane === 'local-reference' ? 'read' : 'read_file';
const shell = lane === 'local-reference' ? 'bash' : 'shell';
const write = lane === 'local-reference' ? 'write' : 'write_file';
const call = (name: string, args: Record<string, unknown>): ScriptedReply => [{ name, args }];
const commands = [
  './node_modules/.bin/tsc --noEmit',
  'node -e "console.log(\'BASELINE_NODE_E\')"',
  'node -p "6 * 7"',
  'pwd && echo BASELINE_BUILTINS',
  ...(lane === 'rifty-no-coi' ? ['git init'] : []),
  'git status --short',
  'echo BASELINE_PIPE | cat',
];
const script: ScriptedReply[] = [
  call(read, { path: 'package.json' }),
  call(read, { path: 'node_modules/@types/react/package.json' }),
  call(read, { path: 'node_modules/@types/react-dom/package.json' }),
  ...commands.map((command) => call(shell, { command })),
  ...(lane === 'rifty' ? [call('diagnostics', { path: 'src/App.tsx' })] : []),
  ...(preinstalled ? [] : [call(shell, { command: 'npm install --save-dev vitest@2.1.9' })]),
  call(write, {
    path: 'baseline.test.js',
    content:
      "import {it,expect} from 'vitest';\nimport {readFileSync} from 'node:fs';\nit('loads the real project package',()=>{expect(JSON.parse(readFileSync('package.json','utf8')).name).toBeTruthy();});\n",
  }),
  call(shell, { command: './node_modules/.bin/vitest run baseline.test.js' }),
  'Baseline observations complete. No task repair was requested.',
];
const model = await agentModelServer(script);
const config = await loadConfig();
config.endpoint = { baseUrl: model.baseUrl, model: 'scripted' };
config.runsPerTask = 1;
config.limits = { maxToolCalls: 30, runTimeoutMs: 300000 };
const original = (await loadTasks())[0]!;
const files = { ...original.files };
if (preinstalled) {
  const pkg = JSON.parse(files['package.json']!);
  pkg.devDependencies.vitest = '2.1.9';
  files['package.json'] = JSON.stringify(pkg, null, 2);
}
assert.ok(
  !preinstalled || lane !== 'rifty',
  'UI dependency installation uses its ordinary shell in the stock probe',
);
const task = {
  ...original,
  id: `baseline-${preinstalled ? 'vitest' : 'stock'}`,
  files,
  prompt:
    'Measure the installed project dependencies, TypeScript diagnostics, Node flags, shell commands and Vitest. Preserve each failed command result; do not fix the application.',
};
const out = await mkdtemp(join(tmpdir(), `rifty-bench-baseline-${lane}-`));
console.log(`BASELINE ${lane} ${preinstalled ? 'vitest' : 'stock'} ${out}`);
try {
  const report = await run(config, [task], [lane], out);
  const requests = model.requests.map((request) => request.body);
  await writeFile(join(out, 'observed-provider-requests.json'), JSON.stringify(requests, null, 2));
  console.log(
    JSON.stringify(
      {
        out,
        agentStatus: report.runs[0]?.agentStatus,
        requests: requests.length,
        expectedRequests: script.length,
      },
      null,
      2,
    ),
  );
  if (preinstalled && report.runs[0]?.stage === 'setup') {
    assert.match(report.runs[0].error ?? '', /esbuild\.version/);
    assert.equal(requests.length, 0);
  } else {
    assert.equal(report.runs[0]?.agentStatus, 'done', JSON.stringify(report.runs[0]));
    assert.equal(requests.length, script.length);
  }
} finally {
  await model.close();
}
