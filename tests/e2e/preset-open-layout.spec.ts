import { expect, test } from '@playwright/test';
import { selectPreset } from './helpers/playground.ts';

// Regression (loader placement): after a preset opens, the lazy EditorHost
// chunk may still be in flight, so the editor slot is empty. Grid
// auto-placement in `.rf-editorarea[data-preview="on"]` then shifted the
// splitter+preview into tracks 1/2 and the "Starting dev server…" loader
// rendered inside the 12px splitter track between editor and preview. The
// preview pane must hold the right-hand preview track even while the editor
// slot is empty.
test('preview keeps its own column while the editor chunk is still loading', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');

  // Park the EditorHost module request (slow-network cold load) so the editor
  // slot stays deterministically empty while we measure the layout.
  let releaseEditorChunk = (): void => {};
  const editorChunkHeld = new Promise<void>((resolve) => {
    releaseEditorChunk = resolve;
  });
  await page.route('**/EditorHost.tsx*', async (route) => {
    await editorChunkHeld;
    await route.continue();
  });

  await page.goto('/');
  await selectPreset(page, 'project-files');

  const editorarea = page.locator('.rf-editorarea');
  await expect(editorarea).toHaveAttribute('data-preview', 'on', { timeout: 30_000 });
  const preview = page.locator('[data-testid="preview"]');
  await expect(preview).toBeVisible();
  // Guard the scenario: the held chunk means the editor cannot have mounted —
  // otherwise these geometry assertions stop covering the empty-slot window.
  expect(await page.locator('[data-testid="editor"]').count()).toBe(0);

  const areaBox = await editorarea.boundingBox();
  const previewBox = await preview.boundingBox();
  if (!areaBox || !previewBox) throw new Error('editor area or preview pane has no bounding box');
  expect(previewBox.width).toBeGreaterThan(100);
  expect(areaBox.x + areaBox.width - (previewBox.x + previewBox.width)).toBeLessThanOrEqual(1);

  releaseEditorChunk();
  await expect(page.locator('[data-testid="editor"]')).toBeVisible({ timeout: 60_000 });
});
