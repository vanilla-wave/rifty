/**
 * fix-date-sort judge. Planted bug: some seeded createdAt dates are not
 * zero-padded ('2025-9-14', '2026-3-18', '2026-4-2'), so the Dashboard's
 * lexicographic sort ranks them above genuinely newer issues. Any real fix
 * (chronological compare OR normalizing the data) yields the same observable
 * order — the judge asserts only the rendered order.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';

/** True chronological top-5 of the seeded issues, newest first (ids 25..21). */
const EXPECTED_TITLES = [
  'Board view loses scroll position after closing a dialog', // 2026-06-25
  'Rate limit header parsing breaks on lowercase keys', // 2026-06-09
  'Flaky test: issue reorder drag-and-drop', // 2026-05-29
  'Add per-project issue templates', // 2026-05-16
  'Issue links in Slack unfurl with the wrong title', // 2026-05-07
];

export async function judge(ctx: JudgeContext): Promise<JudgeVerdict> {
  const probes: JudgeProbe[] = [];
  const { page } = ctx;
  await page.goto(ctx.previewUrl, { waitUntil: 'load' });
  // Issue-detail links (href /issues/<id>) on the Dashboard are exactly the
  // "Recently filed" entries; the nav link (/issues) does not match.
  const links = page.locator('main a[href^="/issues/"]');
  await links.first().waitFor({ state: 'visible', timeout: 10_000 });
  const texts = (await links.allInnerTexts()).map((t) => t.trim());

  const firstFive = texts.slice(0, EXPECTED_TITLES.length);
  const inOrder =
    firstFive.length === EXPECTED_TITLES.length &&
    EXPECTED_TITLES.every((title, i) => firstFive[i] === title);
  probes.push({
    name: 'Recently filed lists the 5 most recent issues, newest first',
    pass: inOrder,
    evidence: inOrder
      ? `rendered order matches chronological order: ${firstFive.join(' | ')}`
      : `rendered: [${firstFive.join(' | ')}] expected: [${EXPECTED_TITLES.join(' | ')}]`,
  });

  return verdictFromProbes(probes);
}
