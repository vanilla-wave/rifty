import { type Locator, type Page, expect, test } from '@playwright/test';
import { pickStarter, terminalBuffer } from '../e2e/helpers/playground.ts';

async function pickStarterAndWaitForTemplate(page: Page): Promise<void> {
  const editorLines = page.locator('[data-testid="editor"] .view-lines').first();
  const previewBody = page.frameLocator('iframe[title="Preview port 5174"]').locator('body');
  await pickStarter(page, 'typescript-ls');
  await expect.poll(() => terminalBuffer(page), { timeout: 45_000 }).toContain('$ vite');
  await expect(editorLines).toContainText('LibraryShape', { timeout: 45_000 });
  await expect(previewBody).toContainText('TypeScript language surface', { timeout: 90_000 });
}

async function clickRenderedText(page: Page, line: Locator, text: string): Promise<void> {
  const point = await line.evaluate((el, needle) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const value = node.textContent ?? '';
      const index = value.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    }
    throw new Error(`visible text not found in Monaco line: ${needle}`);
  }, text);
  await page.mouse.click(point.x, point.y);
}

test.describe('production build — TypeScript starter editor intelligence', () => {
  test('F12 opens starter declaration package and broken package types surface Problems', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(180_000);
    await page.goto('/');

    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);
    await pickStarterAndWaitForTemplate(page);

    const editor = page.locator('[data-testid="editor"]');
    const input = editor.locator('textarea.inputarea').first();
    const editorLines = editor.locator('.view-lines').first();

    const typeImportLine = editor
      .locator('.view-line')
      .filter({ hasText: "import type { LibraryShape } from '@rifty/example-types';" })
      .first();
    await expect(typeImportLine).toBeVisible({ timeout: 10_000 });
    await clickRenderedText(page, typeImportLine, 'LibraryShape');
    await expect(input).toBeFocused();
    await page.keyboard.press('F12');

    await expect(page.getByRole('tab', { name: /index\.d\.ts/ }).first()).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 90_000 },
    );
    await expect(editorLines).toContainText('interface LibraryShape', { timeout: 30_000 });

    await page
      .getByRole('tab', { name: /main\.ts/ })
      .first()
      .click();
    await expect(editorLines).toContainText('LibraryShape', { timeout: 10_000 });
    await editor
      .locator('.view-line')
      .first()
      .click({ position: { x: 4, y: 8 } });
    await expect(input).toBeFocused();

    await page.keyboard.press('Home');
    await page.keyboard.insertText(
      'const typedBrokenShape: LibraryShape = { id: 123, labels: [123] };\n',
    );
    await expect(editorLines).toContainText('typedBrokenShape', { timeout: 10_000 });
    await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeVisible({
      timeout: 120_000,
    });
    await page.locator('[data-testid="problems-tab"]').click();
    const packageTypeProblem = page
      .locator('[data-testid="problem-row"]')
      .filter({ hasText: /number|string/i })
      .first();
    await expect(packageTypeProblem).toBeVisible({ timeout: 30_000 });
  });
});
