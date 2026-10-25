import { type TaskJudge, ids, issues, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async (ctx) => {
  await issues(ctx);
  const input = ctx.view.locator('input').filter({ visible: true }).first();
  if (!(await input.count()))
    return verdict([{ name: 'search input exists', pass: false, evidence: { input: false } }]);
  await input.fill('DARK');
  const upper = await ids(ctx);
  const count = await ctx.view.locator('.result-count').innerText();
  await input.fill('dark');
  const lower = await ids(ctx);
  await input.fill('');
  const cleared = await ids(ctx);
  return verdict([
    {
      name: 'case insensitive title search while typing',
      pass: JSON.stringify(upper) === '[6]' && JSON.stringify(lower) === '[6]',
      evidence: { upper, lower },
    },
    {
      name: 'visible result count follows search',
      pass: /\b1\b/.test(count) && /25/.test(count),
      evidence: count,
    },
    {
      name: 'clear restores list',
      pass: cleared.length === 25,
      evidence: { count: cleared.length },
    },
  ]);
};
