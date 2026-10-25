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
  es2020: {
    typescript: 'const box = { n: 21 };\nglobalThis.answer = box?.n * 2;\n',
    esbuild: 'const box = { n: 21 };\nglobalThis.answer = box?.n * 2;\n',
  },
};
async function publicScenario(ctx: JudgeContext) {
  const task = { id: 'compiler-dependency-2', family: 'compiler-integration', group: 'app' };
  const higher = true;
  const source = editableControl(ctx, /^Source$/i);
  const target = editableControl(ctx, /^Target$/i);
  const output = ctx.view.getByLabel('JavaScript', { exact: true });
  const diagnostics = ctx.view.getByLabel('Diagnostics', { exact: true });
  const compilers = higher ? (['typescript', 'esbuild'] as const) : (['typescript'] as const);
  const results = [];
  for (const compiler of compilers) {
    if (higher) await editableControl(ctx, /^Compiler$/i).selectOption(compiler);
    for (const selectedTarget of ['es2015', 'es2020'] as const) {
      await source.fill(compilerGoldens.source);
      await target.selectOption(selectedTarget);
      await action(ctx, caption('Compile')).click();
      await expect
        .poll(
          async () =>
            (await renderedValue(output)).trim() || (await renderedValue(diagnostics)).trim(),
          { timeout: 60000 },
        )
        .not.toBe('');
      assert.equal((await renderedValue(diagnostics)).trim(), '');
      const code = await renderedValue(output);
      const expected =
        selectedTarget === 'es2015' ? compilerGoldens[compiler] : compilerGoldens.es2020[compiler];
      assert.equal(code.trim(), expected.trim());
      const answer = await ctx.view.evaluate((text) => {
        const box: { answer?: number } = {};
        new Function('globalThis', text)(box);
        return box.answer;
      }, code);
      assert.equal(answer, 42);
      await source.fill('const = ;');
      await action(ctx, caption('Compile')).click();
      await expect.poll(() => renderedValue(diagnostics)).not.toBe('');
      assert.equal((await renderedValue(output)).trim(), '');
      results.push({ compiler, target: selectedTarget, answer });
    }
  }
  return {
    family: task.family,
    source: 'actual browser compilation/syntax error/result clearing in each published mode/target',
    results,
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
