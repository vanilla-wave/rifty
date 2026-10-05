import type { JudgeContext } from '../../../src/judge/context.ts';
import { action, field, fieldValue, verdict } from '../../../src/judge/context.ts';
export async function judge(ctx: JudgeContext) {
  const { view } = ctx;
  const probes = [];
  const entry = (name: string) =>
    view
      .getByRole('button', { name, exact: true })
      .or(view.getByRole('link', { name, exact: true }));
  try {
    const title = field(ctx, /^Title$/i);
    const body = field(ctx, /^Markdown$/i);
    await action(ctx, /New note/i).click();
    await title.fill('Alpha');
    await body.fill('# First\n**Important**\n[[Beta]]\n<script>not code</script>');
    await action(ctx, /^Save$/i).click();
    const bold = view.getByText('Important', { exact: true });
    probes.push({
      name: 'markdown headings/bold and literal HTML',
      pass:
        (await view.getByRole('heading', { name: 'First', exact: true }).count()) === 1 &&
        (await bold.count()) === 1 &&
        (await bold.evaluate(
          (node) => Number.parseInt(getComputedStyle(node).fontWeight) >= 600,
        )) &&
        (await view.getByText('<script>not code</script>', { exact: true }).isVisible()),
      evidence: await view.locator('body').innerText(),
    });
    const beforeMissing = await view.locator('body').ariaSnapshot();
    await view.getByRole('link', { name: 'Beta', exact: true }).click();
    const afterMissing = await view.locator('body').ariaSnapshot();
    probes.push({
      name: 'missing link reported without draft loss',
      pass:
        (await fieldValue(body)) ===
          '# First\n**Important**\n[[Beta]]\n<script>not code</script>' &&
        afterMissing !== beforeMissing,
      evidence: { before: beforeMissing, after: afterMissing },
    });
    await action(ctx, /New note/i).click();
    await title.fill('Beta');
    await body.fill('Unique body needle');
    await action(ctx, /^Save$/i).click();
    await view.goto(view.url());
    await action(ctx, /New note/i).click();
    await field(ctx, /^Search$/i).fill('ALPHA');
    probes.push({
      name: 'case-insensitive title search',
      pass: (await entry('Alpha').count()) >= 1 && (await entry('Beta').count()) === 0,
      evidence: await view.locator('body').ariaSnapshot(),
    });
    await field(ctx, /^Search$/i).fill('NEEDLE');
    probes.push({
      name: 'search includes body and preserves saved notes',
      pass: (await entry('Beta').count()) >= 1 && (await entry('Alpha').count()) === 0,
      evidence: await view.locator('body').ariaSnapshot(),
    });
    await field(ctx, /^Search$/i).fill('');
    await entry('Alpha').first().click();
    // First matches Alpha's body only: Beta's saved entry is filtered out.
    await field(ctx, /^Search$/i).fill('First');
    await view.getByRole('link', { name: 'Beta', exact: true }).first().click();
    probes.push({
      name: 'link navigates to saved body',
      pass:
        (await fieldValue(title)) === 'Beta' && (await fieldValue(body)) === 'Unique body needle',
      evidence: await fieldValue(body),
    });
    await field(ctx, /^Search$/i).fill('');
    await body.fill('unsaved overwrite');
    await view.goto(view.url());
    await entry('Beta').first().click();
    probes.push({
      name: 'unsaved draft does not replace persisted body',
      pass: (await fieldValue(body)) === 'Unique body needle',
      evidence: await fieldValue(body),
    });
    await action(ctx, /^Delete$/i).click();
    await view.goto(view.url());
    await action(ctx, /New note/i).click();
    await field(ctx, /^Search$/i).fill('');
    probes.push({
      name: 'delete persists without losing other notes',
      pass: (await entry('Beta').count()) === 0 && (await entry('Alpha').count()) >= 1,
      evidence: await view.locator('body').ariaSnapshot(),
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
