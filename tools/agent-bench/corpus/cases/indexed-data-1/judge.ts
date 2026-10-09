import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import {
  action,
  caption,
  editableControl,
  fieldValue,
  renderedValue,
} from '../../../src/judge/context.ts';
import type { JudgeContext } from '../../../src/judge/context.ts';
const compilerGoldens = {
  source: 'const box: {n:number} = {n:21}; globalThis.answer = box?.n * 2;',
  target: 'es2015',
  typescriptVersion: '5.9.2',
  esbuildWasmVersion: '0.28.0',
  typescript:
    'const box = { n: 21 };\nglobalThis.answer = (box === null || box === void 0 ? void 0 : box.n) * 2;\n',
  esbuild: 'const box = { n: 21 };\nglobalThis.answer = (box == null ? void 0 : box.n) * 2;\n',
};
async function publicScenario(ctx: JudgeContext) {
  const task = { id: 'indexed-data-1', family: 'indexed-resource', group: 'app' };
  const higher = false;
  assert.equal(task.family, 'indexed-resource');
  const count = higher ? 1000000 : 100000;
  const search = editableControl(ctx, /^Search$/i);
  const status = await ctx.view.getByLabel('Status', { exact: true }).elementHandle();
  assert.ok(status);
  const inputObservation = await search.evaluateHandle((node, statusNode) => {
    const observation: { phase: string | null; eventTime: number | null } = {
      phase: null,
      eventTime: null,
    };
    node.addEventListener(
      'input',
      () => {
        observation.phase =
          statusNode instanceof HTMLInputElement || statusNode instanceof HTMLTextAreaElement
            ? statusNode.value
            : statusNode instanceof HTMLElement
              ? statusNode.innerText
              : (statusNode.textContent ?? '');
        observation.eventTime = performance.now();
      },
      { capture: true, once: true },
    );
    return observation;
  }, status);
  const interactionStarted = performance.now();
  await action(ctx, caption('Load')).click({ timeout: 2000 });
  // Generous admission target; final response deadline frozen from real references before exploration.
  const remaining = 2000 - (performance.now() - interactionStarted);
  assert.ok(remaining > 0, 'Indexing blocked the first user interaction deadline');
  await search.fill('Customer 100', { timeout: remaining });
  const firstInteractionMs = performance.now() - interactionStarted;
  assert.ok(firstInteractionMs <= 2000, 'Indexing blocked the first user interaction deadline');
  assert.equal(await fieldValue(search), 'Customer 100');
  const observedInput = await inputObservation.jsonValue();
  await inputObservation.dispose();
  await status.dispose();
  assert.ok(observedInput.phase !== null, 'Actual input event was not observed');
  const interactionDuringIndexing = /indexing|loading/i.test(observedInput.phase);
  const completedBeforeInteraction = /ready/i.test(observedInput.phase);
  assert.ok(interactionDuringIndexing || completedBeforeInteraction, 'Unknown indexing phase');
  await expect(ctx.view.getByLabel('Status', { exact: true })).toContainText(/ready/i, {
    timeout: 60000,
  });
  await search.fill('');
  await editableControl(ctx, /^Region$/i).selectOption('North');
  await editableControl(ctx, /^Month$/i).selectOption('1');
  await expect
    .poll(() => renderedValue(ctx.view.getByLabel('Matching rows', { exact: true })))
    .toBe(String(Math.ceil(count / 12)));
  await editableControl(ctx, /^Sort$/i).selectOption('cents-desc');
  await action(ctx, caption('Next page')).click();
  await expect.poll(() => renderedValue(ctx.view.getByLabel('Page', { exact: true }))).toBe('2');
  const page = 'page' in ctx.view ? ctx.view.page() : ctx.view;
  const download = page.waitForEvent('download');
  await action(ctx, caption('Export')).click();
  const file = await download;
  const path = await file.path();
  assert.ok(path);
  const { readFile } = await import('node:fs/promises');
  const records = JSON.parse(await readFile(path, 'utf8')) as {
    id: number;
    cents: number;
    region: string;
    month: number;
  }[];
  assert.equal(records.length, Math.ceil(count / 12));
  assert.ok(
    records.every(
      (r) =>
        r.id >= 1 &&
        r.id <= count &&
        (r.id - 1) % 12 === 0 &&
        r.region === 'North' &&
        r.month === 1 &&
        r.cents === ((r.id - 1) * 7919) % 1000000,
    ),
  );
  for (let i = 1; i < records.length; i++)
    assert.ok(
      records[i - 1]!.cents > records[i]!.cents ||
        (records[i - 1]!.cents === records[i]!.cents && records[i - 1]!.id < records[i]!.id),
    );
  return {
    family: task.family,
    source: 'actual browser navigation/indexing/export',
    firstInteractionMs,
    observedInput,
    interactionDuringIndexing,
    completedBeforeInteraction,
    responsivenessEvidence: interactionDuringIndexing
      ? 'observed during indexing'
      : 'completed before interaction; no during-indexing proof',
    rows: count,
    exported: records.length,
  };
}
export async function judge(ctx: JudgeContext) {
  try {
    const result = await publicScenario(ctx);
    return {
      pass: true,
      probes: [
        { name: 'published indexed-resource level1 workflow', pass: true, evidence: result },
      ],
    };
  } catch (error) {
    return {
      pass: false,
      probes: [
        {
          name: 'published indexed-resource level1 workflow',
          pass: false,
          evidence: String(error),
        },
      ],
    };
  }
}
