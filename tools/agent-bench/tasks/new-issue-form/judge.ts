import type { Page } from '@playwright/test';
/**
 * new-issue-form judge — user flow only: open the creation UI from /issues,
 * an empty title creates nothing, a valid title shows up in the list. Uses
 * client-side navigation (header "Issues" link) between steps because created
 * issues live in app state — a full reload would legitimately reset them.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';

async function countIssueEntries(page: Page): Promise<number> {
  // Links to an issue detail (/issues/<id>) are how this app renders list
  // entries; a static "/issues/new" opener is constant across counts.
  return page.locator('a[href^="/issues/"]').count();
}

async function gotoIssuesListClientSide(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Issues', exact: true }).first().click();
  await page.waitForTimeout(400);
}

async function openCreationUi(page: Page): Promise<boolean> {
  const opener = page
    .getByRole('button', { name: /new|create|add/i })
    .or(page.getByRole('link', { name: /new|create|add/i }))
    .first();
  if (!(await opener.isVisible())) return false;
  await opener.click();
  await page.waitForTimeout(400);
  return true;
}

function submitControl(page: Page) {
  return page
    .locator('button[type="submit"]')
    .or(page.getByRole('button', { name: /create|add|save|submit/i }))
    .first();
}

export async function judge(ctx: JudgeContext): Promise<JudgeVerdict> {
  const probes: JudgeProbe[] = [];
  const { page } = ctx;
  await page.goto(new URL('/issues', ctx.previewUrl).href, { waitUntil: 'load' });
  await page
    .getByText('Webhook retries hammer the endpoint without backoff')
    .first()
    .waitFor({ state: 'visible', timeout: 10_000 });
  const baselineCount = await countIssueEntries(page);

  // Probe 1: creation UI reachable from the Issues page.
  const opened = await openCreationUi(page);
  probes.push({
    name: 'a "New issue" control on /issues opens a creation form',
    pass: opened,
    evidence: opened
      ? 'found and clicked a new/create/add control'
      : 'no visible button/link matching /new|create|add/i on /issues',
  });
  if (!opened) return verdictFromProbes(probes);

  // Probe 2: empty title creates nothing.
  const submit = submitControl(page);
  const submitVisible = await submit.isVisible();
  if (submitVisible) await submit.click();
  await page.waitForTimeout(400);
  await gotoIssuesListClientSide(page);
  const afterEmpty = await countIssueEntries(page);
  probes.push({
    name: 'submitting with an empty title creates no issue',
    pass: submitVisible && afterEmpty === baselineCount,
    evidence: submitVisible
      ? `issue entries before=${baselineCount}, after empty submit=${afterEmpty}`
      : 'no visible submit control inside the creation form',
  });

  // Probe 3: a valid title shows up in the list.
  const marker = `Bench issue ${Date.now()}`;
  const reopened = await openCreationUi(page);
  if (!reopened) {
    probes.push({
      name: 'a valid new issue appears in the issues list',
      pass: false,
      evidence: 'creation UI could not be reopened for the valid-title attempt',
    });
    return verdictFromProbes(probes);
  }
  const textInputs = page.locator('input[type="text"], input:not([type]), textarea');
  const inputCount = await textInputs.count();
  let filled = 0;
  for (let i = 0; i < inputCount; i += 1) {
    const input = textInputs.nth(i);
    if ((await input.isVisible()) && (await input.isEnabled())) {
      await input.fill(marker);
      filled += 1;
    }
  }
  const submit2 = submitControl(page);
  if (await submit2.isVisible()) await submit2.click();
  await page.waitForTimeout(400);
  await gotoIssuesListClientSide(page);
  const markerVisible = await page.getByText(marker).first().isVisible();
  const afterValid = await countIssueEntries(page);
  probes.push({
    name: 'a valid new issue appears in the issues list',
    pass: markerVisible,
    evidence: `filled ${filled} field(s) with "${marker}"; marker visible in list=${markerVisible}; entries ${baselineCount} → ${afterValid}`,
  });

  return verdictFromProbes(probes);
}
