/**
 * node-endpoint judge — HTTP assertions against the Hono server (the seeded
 * messages are Ada + Lin). The POST→re-GET probe rejects hardcoded stats
 * snapshots. Requests go through `ctx.page` with RELATIVE paths: in the rifty
 * lane only the browser (via the service worker's /preview/<port>/ routing)
 * can reach the in-VFS server; locally the page sits on the server origin.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';
import { openPreview } from '../../src/judge/nav.ts';

interface Stats {
  total?: unknown;
  byAuthor?: Record<string, unknown>;
}

interface HttpResult {
  status: number;
  body: string;
}

function pageFetch(ctx: JudgeContext, path: string, init?: RequestInit): Promise<HttpResult> {
  return ctx.page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, i as RequestInit | undefined);
      return { status: res.status, body: await res.text() };
    },
    [path, init] as const,
  );
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
  await openPreview(ctx);

  const first = await pageFetch(ctx, 'api/stats');
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

  const post = await pageFetch(ctx, 'api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ author: 'Bench', text: 'stats probe' }),
  });
  probes.push({
    name: 'POST /api/messages still works',
    pass: post.status >= 200 && post.status < 300,
    evidence: `HTTP ${post.status}, body: ${post.body.slice(0, 200)}`,
  });

  const second = await pageFetch(ctx, 'api/stats');
  const secondStats = second.status === 200 ? parseStats(second.body) : null;
  const liveOk = secondStats?.total === 3 && secondStats.byAuthor?.Bench === 1;
  probes.push({
    name: 'stats update after a new message is POSTed',
    pass: liveOk,
    evidence: `body: ${second.body.slice(0, 300)} (expected total=3, byAuthor.Bench=1)`,
  });

  return verdictFromProbes(probes);
}
