import { type Page, expect, test } from '@playwright/test';
import type { AgentTrace } from '../../packages/agent/src/index.ts';
import type * as Proof from '../integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts';

const root = process.cwd().replaceAll('\\', '/');
const fixture = `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/sandbox-agent-proof.ts`;
const results = (trace: AgentTrace) =>
  trace.transcript.filter((entry) => entry.role === 'toolResult');

async function run(page: Page, method: 'sandboxAgentPolicy' | 'sandboxAgentStop', hard = false) {
  await page.goto('/no-coi-harness.html');
  return page.evaluate(
    async ({ root, fixture, method, hard }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const proof = (await import(/* @vite-ignore */ fixture)) as typeof Proof;
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        skipServiceWorker: true,
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        if (crossOriginIsolated) throw new Error('Expected headerless no-COI host');
        return await proof[method](sandbox, hard);
      } finally {
        sandbox.dispose();
      }
    },
    { root, fixture, method, hard },
  );
}

test('Pi no-COI host preserves project policy, file effects and provider-error history', async ({
  page,
}) => {
  const value = (await run(page, 'sandboxAgentPolicy')) as Awaited<
    ReturnType<typeof Proof.sandboxAgentPolicy>
  >;
  expect(value.failed.status).toBe('error');
  expect(value.trace.status).toBe('done');
  expect(value).toMatchObject({ saved: 'saved', locked: 'keep', outside: 'outside' });
  expect(value.files.some((entry) => entry.name === 'forbidden.txt')).toBe(false);
  const tools = results(value.trace);
  expect(tools).toHaveLength(9);
  expect(tools.slice(0, 5).every((entry) => !entry.isError)).toBe(true);
  expect(JSON.stringify(tools[2]?.content)).toContain('saved');
  expect(JSON.stringify(tools[3]?.content)).toContain('src/created.txt');
  expect(JSON.stringify(tools[4]?.content)).toContain('src/created.txt:1: saved');
  expect(tools.slice(5, 8).every((entry) => entry.isError)).toBe(true);
  expect(JSON.stringify(tools[5])).toMatch(/read.only|EROFS/i);
  expect(JSON.stringify(tools[6])).toContain('escapes project root');
  expect(tools[8]?.details).toMatchObject({
    stdout: '/agent\nnext\n',
    exitCode: 0,
    worker: 'retained',
  });
  expect(value.requests[2]?.body.messages.filter((entry) => entry.role === 'tool')).toHaveLength(8);
  const offered = value.requests[0]?.body.tools.map((entry) => entry.function.name);
  expect(offered).toContain('shell');
  expect(offered).not.toContain('diagnostics');
  expect(offered).not.toContain('preview_fetch');
  expect(JSON.stringify(value.requests[0]?.body.messages[0])).toMatch(
    /diagnostics.*unavailable|unavailable.*diagnostics/i,
  );
});

for (const hard of [false, true]) {
  test(`Pi no-COI Stop ${hard ? 'replaces wedged Worker' : 'settles cooperative command'} before next command`, async ({
    page,
  }) => {
    const value = (await run(page, 'sandboxAgentStop', hard)) as Awaited<
      ReturnType<typeof Proof.sandboxAgentStop>
    >;
    expect(value.stopped.status).toBe('aborted');
    expect(value.trace.status).toBe('done');
    const tools = results(value.stopped);
    expect(tools).toHaveLength(2);
    expect(tools[0]?.details).toMatchObject({
      status: 'cancelled',
      worker: hard ? 'replaced' : 'retained',
    });
    expect(tools[0]?.isError).toBe(true);
    expect(tools[1]?.isError).toBe(true);
    if (hard)
      expect(tools[0]?.details).toHaveProperty('effects', {
        applied: 'unknown',
        persistence: 'unknown',
      });
    else expect(value.applied).toBe('applied\n');
    expect(value.files.some((entry) => entry.name === 'skipped.txt')).toBe(false);
    expect(results(value.trace).at(-1)?.details).toMatchObject({
      status: 'exited',
      exitCode: 0,
      stdout: '/agent-stop\nnext\n',
    });
    expect(value.requests[1]?.body.messages.filter((entry) => entry.role === 'tool')).toHaveLength(
      2,
    );
  });
}

test('same Pi session edits/builds real React, observes preview mode, exits resident and repairs build', async ({
  page,
}) => {
  test.setTimeout(420_000);
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(
    async ({ root, fixture }) => {
      const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
      const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
      const { REACT_VITE_TEMPLATE: spec } = await import(
        `/@fs${root}/apps/playground/src/templates/react-vite/index.ts`
      );
      const proof = (await import(/* @vite-ignore */ fixture)) as typeof Proof;
      const sandbox = await createSandbox({
        requireCrossOriginIsolation: false,
        serviceWorkerUrl: '/sw.js',
        toolchain: {
          workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
        },
      });
      try {
        // Fail at the missing adapter before acquiring the actual React dependency tree.
        await createSandboxAgentHost({
          sandbox,
          project: { root: '/agent-react' },
          mode: () => 'commands',
        }).close();
        const project = sandbox.project({ root: '/agent-react' });
        for (const [path, content] of Object.entries(spec.extraFiles))
          await project.fs.writeFile(path.slice(1), content);
        await project.fs.writeFile(spec.entry.relativePath.slice(1), spec.entry.content);
        await project.fs.writeFile(
          'package.json',
          JSON.stringify({
            name: 'agent-react',
            private: true,
            type: 'module',
            scripts: { build: 'vite build' },
            dependencies: spec.install,
            devDependencies: { ...spec.devDependencies, vite: '7.3.6' },
          }),
        );
        await sandbox.toolchain.install({ cwd: '/agent-react', registryUrl: '/npm-registry' });
        const lock = await project.fs.readFile('package-lock.json', 'utf8');
        const observed = await proof.sandboxAgentCycle(sandbox, {
          root: '/agent-react',
          path: 'src/main.tsx',
          original: spec.entry.content,
          port: 5191,
        });
        return { ...observed, coi: crossOriginIsolated, lock };
      } finally {
        sandbox.dispose();
      }
    },
    { root, fixture },
  );
  expect(value.coi).toBe(false);
  expect(value.firstStatus).toBe('done');
  expect(value.trace.status).toBe('done');
  expect(value.firstPreview).toBe('agent-first');
  expect(value.repairedPreview).toBe('agent-repaired');
  expect(value.repairedSource).toContain('agent-repaired');
  expect(value.exited).toMatchObject({ resident: null, unflushedWrites: false });
  expect(value.finalExit.resident).toBeNull();
  expect(value.deniedFile).toContain('resident-concurrency');
  expect(JSON.stringify(value.deniedCommand)).toContain('resident-concurrency');
  const commands = results(value.trace).filter((entry) => entry.toolName === 'shell');
  expect(commands.map((entry) => entry.isError)).toEqual([false, true, false]);
  expect(commands[0]?.details).toHaveProperty('exitCode', 0);
  expect(commands[2]?.details).toHaveProperty('exitCode', 0);
  const previewTools = value.requests[3]?.body.tools.map((entry) => entry.function.name);
  expect(previewTools).toContain('preview_fetch');
  expect(previewTools).not.toContain('write_file');
  expect(previewTools).not.toContain('shell');
  expect(JSON.stringify(value.requests[3]?.body.messages[0])).toMatch(/preview.*mode|resident/i);
  const restoredTools = value.requests[5]?.body.tools.map((entry) => entry.function.name);
  expect(restoredTools).toContain('write_file');
  expect(restoredTools).toContain('shell');
  expect(restoredTools).not.toContain('preview_fetch');
  expect(
    JSON.stringify(results(value.trace).find((entry) => entry.toolName === 'preview_query')),
  ).toContain('agent-first');
  console.log(`React no-COI exact dependency lock: ${value.lock}`);
});
