/**
 * add-search judge — user-observable outcome only: the /issues page has a text
 * input, and typing a known title substring narrows the visible list to
 * matching titles. Deliberately no assertions on files/components.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';
import { openIssuesPage } from '../../src/judge/nav.ts';

const MATCHING_TITLE = 'Dark mode: table stripes are unreadable';
const OTHER_TITLE = 'Webhook retries hammer the endpoint without backoff';
const QUERY = 'table stripes';

export async function judge(ctx: JudgeContext): Promise<JudgeVerdict> {
  const probes: JudgeProbe[] = [];
  const { page } = ctx;
  await openIssuesPage(ctx);
  await page.getByText(MATCHING_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 });

  const bothVisible =
    (await page.getByText(MATCHING_TITLE).first().isVisible()) &&
    (await page.getByText(OTHER_TITLE).first().isVisible());
  probes.push({
    name: 'baseline: full issue list visible on /issues',
    pass: bothVisible,
    evidence: bothVisible
      ? `both "${MATCHING_TITLE}" and "${OTHER_TITLE}" visible before searching`
      : 'expected seeded issue titles are not visible on /issues — app broken before search',
  });

  const candidates = page.locator('input[type="search"], input[type="text"], input:not([type])');
  const count = await candidates.count();
  const visibleIdx: number[] = [];
  for (let i = 0; i < count; i += 1) {
    if (await candidates.nth(i).isVisible()) visibleIdx.push(i);
  }
  probes.push({
    name: 'a text/search input exists on /issues',
    pass: visibleIdx.length > 0,
    evidence:
      visibleIdx.length > 0
        ? `${visibleIdx.length} visible text input(s) found`
        : 'no visible text/search input on /issues',
  });

  let narrowed = false;
  let evidence = 'no candidate input narrowed the list';
  for (const i of visibleIdx) {
    const input = candidates.nth(i);
    await input.fill(QUERY);
    await page.waitForTimeout(500);
    const matchVisible = await page.getByText(MATCHING_TITLE).first().isVisible();
    const otherVisible = await page.getByText(OTHER_TITLE).first().isVisible();
    if (matchVisible && !otherVisible) {
      narrowed = true;
      evidence = `typing "${QUERY}" into input #${i} kept "${MATCHING_TITLE}" and hid "${OTHER_TITLE}"`;
      break;
    }
    evidence = `typing "${QUERY}" into input #${i}: matching visible=${matchVisible}, non-matching visible=${otherVisible}`;
    await input.fill('');
    await page.waitForTimeout(200);
  }
  probes.push({
    name: 'typing a title substring narrows the list to matching titles',
    pass: narrowed,
    evidence,
  });

  return verdictFromProbes(probes);
}
