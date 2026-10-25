import { type TaskJudge, verdict } from '../../src/judge/context.ts';
export const judge: TaskJudge = async ({ view }) => {
  const result = await view.evaluate(async () => {
    const initialResponse = await fetch('api/messages');
    const before = { status: initialResponse.status, body: await initialResponse.json() };
    const statsResponse = await fetch('api/stats');
    const stats = { status: statsResponse.status, body: await statsResponse.json() };
    await fetch('api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author: 'Bench', text: 'first' }),
    });
    await fetch('api/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ author: 'Bench', text: 'second' }),
    });
    const afterResponse = await fetch('api/messages');
    const after = { status: afterResponse.status, body: await afterResponse.json() };
    const updatedResponse = await fetch('api/stats');
    const updated = { status: updatedResponse.status, body: await updatedResponse.json() };
    return { before, stats, after, updated };
  });
  const expected = (messages: { author: string }[]) => {
    const byAuthor: Record<string, number> = {};
    for (const message of messages) byAuthor[message.author] = (byAuthor[message.author] ?? 0) + 1;
    return { total: messages.length, byAuthor };
  };
  const equal = (a: unknown, b: unknown) =>
    JSON.stringify(a, Object.keys(a as object).sort()) ===
    JSON.stringify(b, Object.keys(b as object).sort());
  const check = (stats: typeof result.stats, messages: { author: string }[]) =>
    stats.status === 200 &&
    stats.body.total === messages.length &&
    equal(stats.body.byAuthor, expected(messages).byAuthor);
  return verdict([
    {
      name: 'stats matches initial messages',
      pass: check(result.stats, result.before.body),
      evidence: { actual: result.stats, expected: expected(result.before.body) },
    },
    {
      name: 'stats follows posts grouped by author',
      pass: check(result.updated, result.after.body),
      evidence: { actual: result.updated, expected: expected(result.after.body) },
    },
  ]);
};
