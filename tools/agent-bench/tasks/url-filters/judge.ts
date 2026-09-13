import { type TaskJudge, ids, issues, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async (ctx) => {
  await issues(ctx);
  const initialUrl = ctx.view.url();
  await ctx.view.getByLabel(/^Status/).selectOption('closed');
  const statusUrl = ctx.view.url();
  await ctx.view.getByLabel(/^Assignee/).selectOption('Mara');
  const selected = await ids(ctx);
  const url = ctx.view.url();
  // Move to another state before opening the saved address; localStorage alone cannot pass.
  await ctx.view.getByLabel(/^Status/).selectOption('open');
  await ctx.view.getByLabel(/^Assignee/).selectOption('Deniz');
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
