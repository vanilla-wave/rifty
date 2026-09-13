import { type TaskJudge, issues, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async (ctx) => {
  await issues(ctx);
  const button = ctx.view
    .getByRole('button', { name: /new issue/i })
    .or(ctx.view.getByRole('link', { name: /new issue/i }));
  if (!(await button.count()))
    return verdict([{ name: 'new issue entry exists', pass: false, evidence: { button: false } }]);
  const before = await ctx.view.locator('.issue-card').count();
  await button.click();
  const title = ctx.view.getByRole('textbox', { name: /title/i });
  await title.waitFor({ state: 'visible', timeout: 5000 });
  const submit = ctx.view
    .locator('form')
    .filter({ has: title })
    .getByRole('button', { name: /create|submit|save|add/i })
    .first();
  await title.fill('');
  await submit.click();
  const nativeRequired = await title.evaluate(
    (node) =>
      (node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement) &&
      !node.validity.valid &&
      node.validationMessage.length > 0,
  );
  const customRequired = await ctx.view
    .getByText(/title.*required|required.*title/i)
    .filter({ visible: true })
    .count();
  const afterEmpty = await ctx.view.locator('.issue-card').count();
  const marker = 'Benchmark newly filed issue';
  await title.fill(marker);
  await submit.click();
  const visible = await ctx.view.getByText(marker, { exact: true }).first().isVisible();
  if (await ctx.view.getByRole('link', { name: 'Issues', exact: true }).count()) await issues(ctx);
  await ctx.view.locator('.issue-card').filter({ hasText: marker }).waitFor({
    state: 'visible',
    timeout: 5000,
  });
  const inList = await ctx.view.locator('.issue-card').filter({ hasText: marker }).count();
  const finalCount = await ctx.view.locator('.issue-card').count();
  return verdict([
    {
      name: 'empty title rejected with required feedback',
      pass: (nativeRequired || customRequired > 0) && afterEmpty <= before,
      evidence: { required: nativeRequired || customRequired > 0, before, afterEmpty },
    },
    {
      name: 'valid issue appears in list',
      pass: inList === 1 && finalCount === before + 1,
      evidence: { visible, inList, finalCount, before },
    },
  ]);
};
