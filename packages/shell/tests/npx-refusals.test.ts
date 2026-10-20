import { createMemoryFs } from '@riftydev/vfs/internal';
import { expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

for (const [command, feature] of [
  ['npx missing', 'shell.npx.acquire'],
  ['npx echo hello', 'shell.npx.acquire'],
  ['npx name@1.0.0', 'shell.npx.package-spec'],
  ['npx @scope/name', 'shell.npx.package-spec'],
  ['npx --package name command', 'shell.npx.options'],
  ['npx', 'shell.npx.interactive'],
] as const) {
  it(`names the unsupported local-npx boundary: ${command}`, async () => {
    const { fsSync } = createMemoryFs();
    const shell = new Shell({ fileSystem: fsSync });
    const result = await shell.run(command);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Not implemented: ${feature}`);
    expect(result.stdout).toBe('');
  });
}

it('applies host command policy to the selected local bin', async () => {
  const { fsSync } = createMemoryFs();
  fsSync.mkdirSync('/node_modules/.bin', { recursive: true });
  fsSync.writeFileSync(
    '/node_modules/.bin/hello',
    new TextEncoder().encode('#!/usr/bin/env node\n'),
  );
  const shell = new Shell({
    fileSystem: fsSync,
    assertCommand(command) {
      if (command === 'hello') throw new Error('host-policy-denied-hello');
    },
  });
  const outcome = await shell.run('npx hello').then(
    (result) => result.stderr,
    (error) => String(error),
  );
  expect(outcome).toContain('host-policy-denied-hello');
});
