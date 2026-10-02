import { expect, test } from './fixtures/test.ts';
const root = process.cwd().replaceAll('\\', '/');

test('one agent host writes through file tools while shell redirects and Node writes stay readonly', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const { createSandboxAgentHost, createAgentSession } = await import(
      `/@fs${root}/packages/agent/src/index.ts`
    );
    const { modelCatalog } = await import(
      `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/agent-catalog.ts`
    );
    const { scriptedProvider } = await import(
      `/@fs${root}/tests/integration/fixtures/workbench-vite-consumer/src/agent-scripted-provider.ts`
    );
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    await sandbox.fs.writeFile('/policy/value.txt', 'original');
    await sandbox.fs.writeFile(
      '/policy/write.cjs',
      "require('fs').writeFileSync('value.txt', 'bad-node');",
    );
    const provider = scriptedProvider([
      [
        { name: 'write_file', args: { path: 'value.txt', content: 'file-tool' } },
        { name: 'shell', args: { command: 'echo bad-redirect > value.txt' } },
        { name: 'shell', args: { command: 'node write.cjs' } },
        { name: 'read_file', args: { path: 'value.txt' } },
      ],
      'Checked.',
    ]);
    const host = createSandboxAgentHost({
      sandbox,
      project: { root: '/policy' },
      mode: () => 'commands',
      policies: { shell: { readonlyPaths: ['.'] } },
    });
    const agent = createAgentSession({ host, ...modelCatalog(undefined, provider.fetch) });
    try {
      await agent.send('Edit the file and verify shell restrictions.');
      return {
        trace: await agent.exportTrace(),
        bytes: await sandbox.fs.readFile('/policy/value.txt', 'utf8'),
        notes: host.capabilities().notes,
      };
    } finally {
      await agent.dispose();
      sandbox.dispose();
    }
  }, root);
  const tools = value.trace.transcript.filter((m: { role: string }) => m.role === 'toolResult');
  expect(tools.map((m: { isError: boolean }) => m.isError)).toEqual([false, true, true, false]);
  expect(value.bytes).toBe('file-tool');
  expect(JSON.stringify(tools.slice(1, 3))).toMatch(/EROFS|read.only/i);
  expect(value.notes.join('\n')).toMatch(/files.*shell/s);
  expect(value.notes.join('\n')).toContain(
    JSON.stringify({
      files: { root: '/policy' },
      shell: { root: '/policy', readonlyPaths: ['.'] },
    }),
  );
});

test('SDK remains the owner of inherited, replaced, cleared and empty capability policies', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    await sandbox.fs.writeFile('/policy/value.txt', 'original');
    await sandbox.fs.writeFile('/policy/locked/value.txt', 'locked');
    const host = (project: Record<string, unknown>, policies?: Record<string, unknown>) =>
      createSandboxAgentHost({
        sandbox,
        project: { root: '/policy', ...project },
        mode: () => 'commands',
        policies,
      });
    const command = (h: ReturnType<typeof host>, command: string) =>
      h.capabilities().shell!(command, undefined, () => {});
    const write = (h: ReturnType<typeof host>, path: string) =>
      h
        .capabilities()
        .files!.change(path, () => 'changed')
        .then(
          () => 'written',
          (error: Error & { code?: string }) => error.code ?? error.message,
        );
    try {
      const old = host({ readonlyPaths: ['locked'], allowedCommands: ['pwd'] });
      const inherited = host(
        { readonlyPaths: ['locked'], allowedCommands: ['pwd'] },
        { shell: { readonlyPaths: [] } },
      );
      const inverse = host({}, { files: { readonlyPaths: ['.'] }, shell: { readonlyPaths: [] } });
      const cleared = host({ allowedCommands: ['pwd'] }, { shell: { allowedCommands: undefined } });
      const replaced = host(
        { allowedCommands: ['pwd', 'echo'] },
        { shell: { allowedCommands: ['node'] } },
      );
      const empty = host({}, { shell: { allowedCommands: [] } });
      const results = {
        oldWrite: await write(old, '/policy/locked/value.txt'),
        oldDenied: await command(old, 'echo forbidden'),
        inheritedDenied: await command(inherited, 'echo forbidden'),
        inheritedAllowed: await command(inherited, 'pwd'),
        inverseWrite: await write(inverse, '/policy/value.txt'),
        inverseShell: await command(inverse, 'echo shell-write > value.txt'),
        cleared: await command(cleared, 'echo unrestricted'),
        replacedDenied: await command(replaced, 'pwd'),
        replacedAllowed: await command(replaced, 'node --version'),
        emptyDenied: await command(empty, 'pwd'),
        clearedNotes: cleared.capabilities().notes,
        after: await sandbox.fs.readFile('/policy/value.txt', 'utf8'),
        locked: await sandbox.fs.readFile('/policy/locked/value.txt', 'utf8'),
      };
      return results;
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(value.oldWrite).toBe('EROFS');
  expect(value.inverseWrite).toBe('EROFS');
  for (const failure of [
    value.oldDenied,
    value.inheritedDenied,
    value.replacedDenied,
    value.emptyDenied,
  ])
    expect(`${failure.stderr}${JSON.stringify(failure.error)}`).toContain('prohibited');
  expect(value.inheritedAllowed.exitCode).toBe(0);
  expect(value.replacedAllowed.exitCode).toBe(0);
  expect(value.inverseShell.exitCode).toBe(0);
  expect(value.cleared.stdout).toBe('unrestricted\n');
  expect(value.after).toBe('shell-write\n');
  expect(value.locked).toBe('locked');
  expect(value.clearedNotes.join('\n')).toContain(
    JSON.stringify({
      files: { root: '/policy', allowedCommands: ['pwd'] },
      shell: { root: '/policy' },
    }),
  );
});

test('reference default runs npm build and an explicit allowlist still checks nested bins', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      await sandbox.fs.writeFile(
        '/policy/package.json',
        JSON.stringify({ name: 'policy', scripts: { build: 'build-cli' } }),
      );
      await sandbox.fs.writeFile(
        '/policy/node_modules/.bin/build-cli',
        "#!/usr/bin/env node\nimport('../build-cli/cli.js');\n",
      );
      await sandbox.fs.writeFile(
        '/policy/node_modules/build-cli/package.json',
        '{"name":"build-cli","type":"commonjs"}',
      );
      await sandbox.fs.writeFile(
        '/policy/node_modules/build-cli/cli.js',
        "process.stdout.write('built-real-cli\\n');",
      );
      const results = [];
      for (const allowedCommands of [undefined, ['npm', 'node'], ['npm', 'node', 'build-cli']]) {
        const host = createSandboxAgentHost({
          sandbox,
          project: { root: '/policy', allowedCommands },
          mode: () => 'commands',
        });
        results.push(await host.capabilities().shell!('npm run build', undefined, () => {}));
      }
      return results;
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(value[0].exitCode, JSON.stringify(value[0])).toBe(0);
  expect(value[0].stdout).toContain('built-real-cli');
  expect(value[1].stderr).toContain('Command is prohibited: build-cli');
  expect(value[2].exitCode).toBe(0);
  expect(value[2].stdout).toContain('built-real-cli');
});

test('capability policies cannot introduce another root and captured notes do not drift', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      const failures = [];
      for (const capability of ['files', 'shell']) {
        try {
          createSandboxAgentHost({
            sandbox,
            project: { root: '/policy' },
            mode: () => 'commands',
            policies: { [capability]: { root: '/outside' } },
          });
          failures.push(null);
        } catch (error) {
          failures.push((error as Error).message);
        }
      }
      const readonlyPaths = ['locked'];
      const host = createSandboxAgentHost({
        sandbox,
        project: { root: '/policy' },
        mode: () => 'commands',
        policies: { files: { readonlyPaths } },
      });
      const before = host.capabilities().notes;
      readonlyPaths.push('later');
      await sandbox.fs.writeFile('/policy/later/a.txt', 'writable');
      await host.capabilities().files!.change('/policy/later/a.txt', () => 'changed');
      return {
        failures,
        before,
        after: host.capabilities().notes,
        content: await sandbox.fs.readFile('/policy/later/a.txt', 'utf8'),
      };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(value.failures).toEqual([expect.stringMatching(/root/i), expect.stringMatching(/root/i)]);
  expect(value.after).toEqual(value.before);
  expect(value.content).toBe('changed');
  expect(value.before.join('\n')).toContain('locked');
  expect(value.before.join('\n')).not.toContain('later');
});

test('notes include non-enumerable SDK policy values and readonly overrides replace common paths', async ({
  page,
}) => {
  await page.goto('/no-coi-harness.html');
  const value = await page.evaluate(async (root) => {
    const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
    const { createSandboxAgentHost } = await import(`/@fs${root}/packages/agent/src/index.ts`);
    const sandbox = await createSandbox({
      requireCrossOriginIsolation: false,
      skipServiceWorker: true,
      storage: { persistence: 'ephemeral' },
      toolchain: {
        workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
      },
    });
    try {
      for (const directory of ['files', 'shell', 'common'])
        await sandbox.fs.writeFile(`/policy/${directory}/value.txt`, 'original');
      const project = Object.defineProperties(
        { root: '/policy' },
        {
          readonlyPaths: { value: ['common'] },
          allowedCommands: { value: ['echo'] },
        },
      );
      const host = createSandboxAgentHost({
        sandbox,
        project,
        mode: () => 'commands',
        policies: {
          files: Object.defineProperty({}, 'readonlyPaths', { value: ['files'] }),
          shell: Object.defineProperty({}, 'readonlyPaths', { value: ['shell'] }),
        },
      });
      const caps = host.capabilities();
      const fileError = await caps
        .files!.change('/policy/files/value.txt', () => 'bad')
        .then(
          () => 'written',
          (error: Error & { code?: string }) => error.code,
        );
      const shellDenied = await caps.shell!('echo bad > shell/value.txt', undefined, () => {});
      const shellAllowed = await caps.shell!(
        'echo allowed > common/value.txt',
        undefined,
        () => {},
      );
      await caps.files!.change('/policy/common/value.txt', () => 'file-allowed');
      return {
        fileError,
        shellDenied,
        shellAllowed,
        notes: caps.notes,
        files: await sandbox.fs.readFile('/policy/files/value.txt', 'utf8'),
        shell: await sandbox.fs.readFile('/policy/shell/value.txt', 'utf8'),
        common: await sandbox.fs.readFile('/policy/common/value.txt', 'utf8'),
      };
    } finally {
      sandbox.dispose();
    }
  }, root);
  expect(value.fileError).toBe('EROFS');
  expect(value.shellDenied.stderr).toMatch(/EROFS|read.only/i);
  expect(value.shellAllowed.exitCode).toBe(0);
  expect(value).toMatchObject({ files: 'original', shell: 'original', common: 'file-allowed' });
  expect(value.notes.join('\n')).toContain(
    JSON.stringify({
      files: { root: '/policy', readonlyPaths: ['files'], allowedCommands: ['echo'] },
      shell: { root: '/policy', readonlyPaths: ['shell'], allowedCommands: ['echo'] },
    }),
  );
});
