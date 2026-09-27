import { expect, test } from '@playwright/test';
import { vitestManifest, vitestProject } from './fixtures/vitest-run/project.ts';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

test('installed Vitest environments and providers expose their actual capability ceilings', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner requires Chromium COI/SAB');
  test.setTimeout(360_000);
  await bootShell(page);
  await openShellTerminal(page);
  const manifest = {
    ...vitestManifest,
    devDependencies: {
      ...vitestManifest.devDependencies,
      jsdom: '30.0.1',
      'happy-dom': '20.0.0',
      '@vitest/coverage-v8': '4.1.11',
      '@vitest/browser-playwright': '4.1.11',
      playwright: '1.60.0',
    },
  };
  const project = { ...vitestProject, 'package.json': JSON.stringify(manifest) };
  const quote = (text: string): string => `'${text.replaceAll("'", "'\\''")}'`;
  const setup = [
    'rm -rf node_modules package-lock.json',
    'mkdir -p src',
    ...Object.entries(project).map(([path, source]) => `echo ${quote(source)} > ${path}`),
  ].join(' && ');
  await runTerminalLineSettled(page, setup, 30_000);
  expect(await terminalHistoryExitCode(page, setup)).toBe(0);
  await runTerminalLineSettled(page, 'npm install', 180_000);
  expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);

  async function expectCeiling(command: string, message: string): Promise<void> {
    await runTerminalLineSettled(page, command, 90_000);
    const buffer = await terminalBuffer(page);
    const start = buffer.lastIndexOf(`> ${command}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const output = buffer.slice(start + command.length + 2);
    expect(await terminalHistoryExitCode(page, command), output).toBe(1);
    expect(output).toContain(message);
  }
  await expectCeiling(
    'vitest run --environment=jsdom',
    'Not implemented: vm.constants.DONT_CONTEXTIFY',
  );
  await expectCeiling(
    'vitest run --environment=happy-dom',
    'Not implemented: module-loader.esm-global-function-assignment',
  );
  await expectCeiling(
    'vitest run --coverage',
    "Built-in 'node:inspector/promises' is not implemented",
  );
  await expectCeiling(
    'vitest run --pool=vmThreads',
    'Not implemented: worker_threads.Worker.execArgv',
  );
  await expectCeiling('vitest run --pool=vmForks', 'Not implemented: child_process.fork.execArgv');

  const browserConfig =
    "import {defineConfig} from 'vitest/config'; import {playwright} from '@vitest/browser-playwright'; export default defineConfig({test:{include:['src/**/*.test.ts'],browser:{enabled:true,provider:playwright(),instances:[{browser:'chromium'}]}}});";
  const configure = `echo ${quote(browserConfig)} > vitest.config.ts`;
  await runTerminalLineSettled(page, configure, 30_000);
  expect(await terminalHistoryExitCode(page, configure)).toBe(0);
  await expectCeiling('vitest run', 'Not implemented: node:https.Agent');
});
