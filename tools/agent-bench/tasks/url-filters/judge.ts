import { expect } from '@playwright/test';
import { type TaskJudge, ids, issues, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async (ctx) => {
  await issues(ctx);
  // An existing Issues heading cannot acknowledge the preceding route transition.
  await ctx.view.goto(ctx.view.url());
  await ctx.view.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
  const renderedIds = ctx.view.locator('.issue-card__id');
  const initialUrl = ctx.view.url();
  await ctx.view.getByLabel(/^Status/).selectOption('closed');
  await expect(renderedIds).toHaveText(['#6', '#14', '#23']);
  const statusUrl = ctx.view.url();
  await ctx.view.getByLabel(/^Assignee/).selectOption('Mara');
  await expect(renderedIds).toHaveText(['#6']);
  const selected = await ids(ctx);
  const url = ctx.view.url();
  // Move to another state before opening the saved address; localStorage alone cannot pass.
  await ctx.view.getByLabel(/^Status/).selectOption('open');
  await expect(renderedIds).toHaveText(['#1', '#16', '#21']);
  await ctx.view.getByLabel(/^Assignee/).selectOption('Deniz');
  await expect(renderedIds).toHaveText(['#2', '#12', '#22']);
  await ctx.view.goto(url);
  await ctx.view.getByRole('heading', { name: 'Issues', exact: true }).waitFor();
  const restored = await ids(ctx);
  const controls = {
    status: await ctx.view.getByLabel(/^Status/).inputValue(),
    assignee: await ctx.view.getByLabel(/^Assignee/).inputValue(),
  };
  return verdict([
    {
      name: 'selected filters encoded in shareable URL',
      pass: statusUrl !== initialUrl && url !== statusUrl,
      evidence: {
        statusChangedAddress: statusUrl !== initialUrl,
        assigneeChangedAddress: url !== statusUrl,
        selected,
      },
    },
    {
      name: 'reload restores filters and list',
      pass:
        controls.status === 'closed' &&
        controls.assignee === 'Mara' &&
        JSON.stringify(restored) === '[6]',
      evidence: { controls, restored },
    },
  ]);
};
