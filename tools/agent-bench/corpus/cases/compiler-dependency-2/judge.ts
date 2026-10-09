import assert from 'node:assert/strict';
import { expect } from '@playwright/test';
import { action, caption, editableControl, renderedValue } from '../../../src/judge/context.ts';
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
  const task = { id: 'compiler-dependency-2', family: 'compiler-integration', group: 'app' };
  const higher = true;
  const source = editableControl(ctx, /^Source$/i);
  const target = editableControl(ctx, /^Target$/i);
  if (higher) await editableControl(ctx, /^Compiler$/i).selectOption('esbuild');
  await source.fill('const box: {n:number} = {n:21}; globalThis.answer = box?.n * 2;');
  await target.selectOption('es2015');
  await action(ctx, caption('Compile')).click();
  const output = ctx.view.getByLabel('JavaScript', { exact: true });
  await expect.poll(() => renderedValue(output), { timeout: 60000 }).not.toBe('');
  const code = await renderedValue(output);
  assert.equal(code.trim(), (higher ? compilerGoldens.esbuild : compilerGoldens.typescript).trim());
  const answer = await ctx.view.evaluate((text) => {
    const box: { answer?: number } = {};
    new Function('globalThis', text)(box);
    return box.answer;
  }, code);
  assert.equal(answer, 42);
  await source.fill('const = ;');
  await action(ctx, caption('Compile')).click();
  await expect
    .poll(() => renderedValue(ctx.view.getByLabel('Diagnostics', { exact: true })))
    .not.toBe('');
  assert.equal((await renderedValue(output)).trim(), '');
  return {
    family: task.family,
    source: 'actual browser compilation/syntax error/result clearing',
    answer,
  };
}
export async function judge(ctx: JudgeContext) {
  try {
    const result = await publicScenario(ctx);
    return {
      pass: true,
      probes: [
        { name: 'published compiler-integration level2 workflow', pass: true, evidence: result },
      ],
    };
  } catch (error) {
    return {
      pass: false,
      probes: [
        {
          name: 'published compiler-integration level2 workflow',
          pass: false,
          evidence: String(error),
        },
      ],
    };
  }
}
