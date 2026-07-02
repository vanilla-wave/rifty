/**
 * node-endpoint judge — pure HTTP assertions against the Hono server (the
 * seeded messages are Ada + Lin). The POST→re-GET probe rejects hardcoded
 * stats snapshots. `ctx.page` is unused by design: the outcome is an API.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';

interface Stats {
  total?: unknown;
  byAuthor?: Record<string, unknown>;
}

async function getStats(previewUrl: string): Promise<{ status: number; body: string }> {
  const res = await fetch(new URL('/api/stats', previewUrl).href);
  return { status: res.status, body: await res.text() };
}

function parseStats(body: string): Stats | null {
  try {
    const parsed: unknown = JSON.parse(body);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Stats) : null;
  } catch {
    return null;
  }
}

export async function judge(ctx: JudgeContext): Promise<JudgeVerdict> {
  const probes: JudgeProbe[] = [];

  const first = await getStats(ctx.previewUrl);
  const firstStats = first.status === 200 ? parseStats(first.body) : null;
  probes.push({
    name: 'GET /api/stats returns 200 with a JSON object',
    pass: firstStats !== null,
    evidence: `HTTP ${first.status}, body: ${first.body.slice(0, 300)}`,
  });
  if (firstStats === null) return verdictFromProbes(probes);

  const seededOk =
    firstStats.total === 2 && firstStats.byAuthor?.Ada === 1 && firstStats.byAuthor?.Lin === 1;
  probes.push({
    name: 'stats reflect the seeded messages (total 2: Ada, Lin)',
    pass: seededOk,
    evidence: `body: ${first.body.slice(0, 300)} (expected total=2, byAuthor.Ada=1, byAuthor.Lin=1)`,
  });

  const post = await fetch(new URL('/api/messages', ctx.previewUrl).href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'Bench', text: 'stats probe' }),
  });
  const postBody = await post.text();
  probes.push({
    name: 'POST /api/messages still works',
    pass: post.status >= 200 && post.status < 300,
    evidence: `HTTP ${post.status}, body: ${postBody.slice(0, 200)}`,
  });

  const second = await getStats(ctx.previewUrl);
  const secondStats = second.status === 200 ? parseStats(second.body) : null;
  const liveOk = secondStats?.total === 3 && secondStats.byAuthor?.Bench === 1;
  probes.push({
    name: 'stats update after a new message is POSTed',
    pass: liveOk,
    evidence: `body: ${second.body.slice(0, 300)} (expected total=3, byAuthor.Bench=1)`,
  });

  return verdictFromProbes(probes);
}
