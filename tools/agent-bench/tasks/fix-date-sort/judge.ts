import { type TaskJudge, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async ({ view }) => {
  await view.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await view.getByRole('heading', { name: 'Recently filed', exact: true }).waitFor();
  const actual = await view
    .locator('.recent-list a')
    .evaluateAll((nodes) =>
      nodes.map((node) => Number(node.getAttribute('href')?.split('/').pop())),
    );
  const expected = [25, 24, 23, 22, 21];
  return verdict([
    {
      name: 'five newest calendar dates first',
      pass: JSON.stringify(actual) === JSON.stringify(expected),
      evidence: { actual, expected },
    },
  ]);
};
