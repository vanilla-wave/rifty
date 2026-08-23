import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

test.describe('TerminalPanel owner completion settlement', () => {
  test.beforeEach(async ({ page }) => {
    await gotoHarness(page);
    await page.evaluate(async () => {
      const { mountTerminalCompletionHarness } = await import(
        '/src/browser-unit/terminal-completion-harness.tsx'
      );
      const root = document.createElement('div');
      root.id = 'terminal-completion-test-root';
      document.body.append(root);
      mountTerminalCompletionHarness(root);
    });
  });

  test('an edit superseding pending completion A prevents its late menu from publishing', async ({
    page,
  }) => {
    const harness = page.getByTestId('terminal-completion-harness');
    const input = harness.locator('textarea.xterm-helper-textarea, textarea').first();
    await expect(input).toBeAttached();
    await input.focus();
    await page.keyboard.insertText('pr');
    await page.keyboard.press('Tab');
    await expect(harness).toHaveAttribute('data-pending-completions', '1');

    await page.keyboard.insertText('o');
    await expect(page.getByTestId('terminal-buffer')).toHaveAttribute(
      'data-terminal-buffer',
      /pro/u,
    );

    await page.evaluate(async () => {
      const { resolveTerminalCompletion } = await import(
        '/src/browser-unit/terminal-completion-harness.tsx'
      );
      resolveTerminalCompletion({
        start: 0,
        end: 2,
        items: [{ value: 'probe' }, { value: 'printf' }],
      });
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    await expect(harness).toHaveAttribute('data-pending-completions', '0');
    await expect(harness.locator('.rf-terminal-autocomplete')).toHaveCount(0);
  });

  test('completion B rejection reports its exact owner failure and leaves no menu', async ({
    page,
  }) => {
    const harness = page.getByTestId('terminal-completion-harness');
    const input = harness.locator('textarea.xterm-helper-textarea, textarea').first();
    await expect(input).toBeAttached();
    await input.focus();
    await page.keyboard.insertText('ow');
    await page.keyboard.press('Tab');
    await expect(harness).toHaveAttribute('data-pending-completions', '1');

    await page.evaluate(async () => {
      const { rejectTerminalCompletion } = await import(
        '/src/browser-unit/terminal-completion-harness.tsx'
      );
      rejectTerminalCompletion('owner completion readdir failed exactly');
      await Promise.resolve();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    await expect(page.getByTestId('terminal-completion-error')).toHaveText(
      'Completion failed: owner completion readdir failed exactly',
    );
    await expect(harness.locator('.rf-terminal-autocomplete')).toHaveCount(0);
  });
});
