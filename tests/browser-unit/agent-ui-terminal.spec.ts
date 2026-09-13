import { expect, test } from '@playwright/test';
import { bootOwner, gotoHarness } from './fixtures.ts';

test('UI command cancelled during native resize never launches', async ({ page }) => {
  await gotoHarness(page);
  await bootOwner(page, { workspaceId: 'agent-ui-terminal', persistence: 'ephemeral' });
  const value = await page.evaluate(async (root) => {
    const { createPlaygroundTerminalUi } = await import(
      `/@fs${root}/apps/playground/src/adapters/playground-terminal-ui.ts`
    );
    const { currentProject } = await import(
      `/@fs${root}/tests/browser-unit/fixtures/sealed-playground-workbench.ts`
    );
    const project = currentProject();
    const ui = createPlaygroundTerminalUi(project);
    try {
      const terminal = ui.createSession('Agent');
      const controller = new AbortController();
      const pending = ui.runLine(terminal.id, 'echo unwanted > cancelled-launch.txt', {
        signal: controller.signal,
      });
      controller.abort();
      const result = await pending.then(
        (exitCode: number) => ({ exitCode }),
        (error: Error) => ({ error: error.name }),
      );
      return {
        result,
        files: (await project.files.readdir('/')).map((entry: { path: string }) => entry.path),
      };
    } finally {
      await ui.dispose();
    }
  }, process.cwd());
  expect(value.result).toEqual({ error: 'AbortError' });
  expect(value.files).not.toContain('/cancelled-launch.txt');
});

test('public executeLine retains the native owner result, error and busy/disposal lifetime', async ({
  page,
}) => {
  await gotoHarness(page);
  const value = await page.evaluate(async (root) => {
    const { RiftyTerminal } = await import(`/@fs${root}/packages/terminal/src/index.ts`);
    let interactiveCalls = 0;
    const terminal = new RiftyTerminal({
      onInput: () => {
        interactiveCalls++;
      },
    });
    const element = document.createElement('div');
    element.style.cssText = 'width:800px;height:300px';
    document.body.append(element);
    terminal.mount(element);
    let finish!: (code: number) => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const lines: string[] = [];
    const pending = terminal.executeLine('native owner command', async (line: string) => {
      lines.push(line);
      entered();
      return new Promise<number>((resolve) => {
        finish = resolve;
      });
    });
    await started;
    const rejected = await terminal
      .executeLine('must not enter', () => {
        lines.push('wrong');
        return 0;
      })
      .then(
        () => null,
        (error: Error) => error.message,
      );
    finish(7);
    const result = await pending;
    const original = new Error('original owner failure');
    const sameError = await terminal
      .executeLine('owner rejects', () => {
        throw original;
      })
      .then(
        () => false,
        (error: unknown) => error === original,
      );
    const next = await terminal.executeLine('next owner', () => 0);
    let completeDisposed!: (code: number) => void;
    const duringDispose = terminal.executeLine(
      'dispose while waiting',
      () =>
        new Promise<number>((resolve) => {
          completeDisposed = resolve;
        }),
    );
    terminal.dispose();
    completeDisposed(9);
    const disposedResult = await duringDispose;
    const afterDispose = await terminal
      .executeLine('closed', () => {
        lines.push('closed');
        return 0;
      })
      .then(
        () => null,
        (error: Error) => error.message,
      );
    element.remove();
    return {
      lines,
      interactiveCalls,
      rejected,
      result,
      sameError,
      next,
      disposedResult,
      afterDispose,
    };
  }, process.cwd());
  expect(value).toEqual({
    lines: ['native owner command'],
    interactiveCalls: 0,
    rejected: 'Terminal input is busy',
    result: 7,
    sameError: true,
    next: 0,
    disposedResult: 9,
    afterDispose: 'Terminal is disposed',
  });
});
