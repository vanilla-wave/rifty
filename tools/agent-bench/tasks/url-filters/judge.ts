/**
 * url-filters judge — outcome, not mechanism: choosing status "resolved"
 * changes the address, and cold-loading that address restores the filtered
 * view. Param names/encoding are the agent's choice; we only require the URL
 * to differ and to round-trip.
 */
import {
  type JudgeContext,
  type JudgeProbe,
  type JudgeVerdict,
  verdictFromProbes,
} from '../../src/judge/context.ts';

const RESOLVED_TITLE = 'API returns 500 when the page size is zero'; // status: resolved
const OPEN_TITLE = 'Webhook retries hammer the endpoint without backoff'; // status: open

export async function judge(ctx: JudgeContext): Promise<JudgeVerdict> {
  const probes: JudgeProbe[] = [];
  const { page } = ctx;
  const issuesUrl = new URL('/issues', ctx.previewUrl).href;
  await page.goto(issuesUrl, { waitUntil: 'load' });
  await page.getByText(OPEN_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 });
  const urlBefore = page.url();

  // Find the select that offers a "resolved" option (the status filter),
  // whatever its markup/labels look like after the agent's change.
  const selects = page.locator('select');
  const selectCount = await selects.count();
  let statusSelectIdx = -1;
  for (let i = 0; i < selectCount; i += 1) {
    const hasResolved = await selects
      .nth(i)
      .evaluate((el) =>
        [...(el as HTMLSelectElement).options].some((o) =>
          `${o.value} ${o.textContent}`.toLowerCase().includes('resolved'),
        ),
      );
    if (hasResolved) {
      statusSelectIdx = i;
      break;
    }
  }
  probes.push({
    name: 'a status filter with a "resolved" option exists',
    pass: statusSelectIdx >= 0,
    evidence:
      statusSelectIdx >= 0
        ? `select #${statusSelectIdx} offers a "resolved" option`
        : `none of the ${selectCount} selects on /issues offers a "resolved" option`,
  });
  if (statusSelectIdx < 0) return verdictFromProbes(probes);

  const statusSelect = selects.nth(statusSelectIdx);
  const resolvedValue = await statusSelect.evaluate(
    (el) =>
      [...(el as HTMLSelectElement).options].find((o) =>
        `${o.value} ${o.textContent}`.toLowerCase().includes('resolved'),
      )?.value ?? null,
  );
  if (resolvedValue === null) throw new Error('url-filters judge: resolved option vanished');
  await statusSelect.selectOption(resolvedValue);

  // The URL must change to encode the filter (poll: agents may debounce).
  let urlAfter = page.url();
  const deadline = Date.now() + 3000;
  while (urlAfter === urlBefore && Date.now() < deadline) {
    await page.waitForTimeout(150);
    urlAfter = page.url();
  }
  probes.push({
    name: 'changing the status filter updates the URL',
    pass: urlAfter !== urlBefore,
    evidence:
      urlAfter !== urlBefore
        ? `URL changed: ${urlBefore} → ${urlAfter}`
        : `URL stayed ${urlBefore} after selecting "resolved"`,
  });
  if (urlAfter === urlBefore) return verdictFromProbes(probes);

  // Cold-load the captured URL: the filtered view must be restored.
  await page.goto(urlAfter, { waitUntil: 'load' });
  await page.getByText(RESOLVED_TITLE).first().waitFor({ state: 'visible', timeout: 10_000 });
  const resolvedVisible = await page.getByText(RESOLVED_TITLE).first().isVisible();
  const openVisible = await page.getByText(OPEN_TITLE).first().isVisible();
  probes.push({
    name: 'opening the captured URL restores the filtered view',
    pass: resolvedVisible && !openVisible,
    evidence: `after goto(${urlAfter}): resolved-issue visible=${resolvedVisible}, open-issue visible=${openVisible} (want true/false)`,
  });

  return verdictFromProbes(probes);
}
