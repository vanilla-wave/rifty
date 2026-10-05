import type { JudgeContext } from '../../../src/judge/context.ts';
import { verdict } from '../../../src/judge/context.ts';
export async function judge({ view }: JudgeContext) {
  const probes = [];
  try {
    const title = view.getByRole('textbox', { name: /^Title$/i });
    const body = view.getByRole('textbox', { name: /^Markdown$/i });
    const save = view.getByRole('button', { name: /^Save$/i });
    await view.getByRole('button', { name: /New note/i }).click();
    await title.fill('Alpha');
    await body.fill('# First\n**Important**\n[[Beta]]\n<script>not code</script>');
    await save.click();
    const preview = view.getByRole('region', { name: /Markdown preview/i });
    probes.push({
      name: 'markdown and HTML safety',
      pass:
        (await preview.getByRole('heading', { name: 'First' }).count()) === 1 &&
        (await preview.locator('strong').count()) === 1 &&
        (await preview.locator('script').count()) === 0,
      evidence: await preview.innerHTML(),
    });
    await preview.getByRole('link', { name: 'Beta', exact: true }).click();
    probes.push({
      name: 'missing link reported without draft loss',
      pass:
        (await body.inputValue()) ===
          '# First\n**Important**\n[[Beta]]\n<script>not code</script>' &&
        /missing/i.test(await view.getByRole('status').innerText()),
      evidence: await view.getByRole('status').innerText(),
    });
    await view.getByRole('button', { name: /New note/i }).click();
    await title.fill('Beta');
    await body.fill('Unique body needle');
    await save.click();
    await view.goto(view.url());
    await view.getByRole('textbox', { name: /^Search$/i }).fill('NEEDLE');
    probes.push({
      name: 'search includes body and preserves saved notes',
      pass:
        (await view.getByRole('button', { name: 'Beta', exact: true }).count()) === 1 &&
        (await view.getByRole('button', { name: 'Alpha', exact: true }).count()) === 0,
      evidence: await view.getByRole('navigation').innerText(),
    });
    await view.getByRole('textbox', { name: /^Search$/i }).fill('');
    await view.getByRole('button', { name: 'Alpha', exact: true }).click();
    await preview.getByRole('link', { name: 'Beta', exact: true }).click();
    probes.push({
      name: 'link navigates to saved body',
      pass:
        (await title.inputValue()) === 'Beta' && (await body.inputValue()) === 'Unique body needle',
      evidence: await body.inputValue(),
    });
    await body.fill('unsaved overwrite');
    await view.goto(view.url());
    await view.getByRole('button', { name: 'Beta', exact: true }).click();
    probes.push({
      name: 'unsaved draft does not replace persisted body',
      pass: (await body.inputValue()) === 'Unique body needle',
      evidence: await body.inputValue(),
    });
    await view.getByRole('button', { name: /^Delete$/i }).click();
    await view.goto(view.url());
    probes.push({
      name: 'delete persists without losing other notes',
      pass:
        (await view.getByRole('button', { name: 'Beta', exact: true }).count()) === 0 &&
        (await view.getByRole('button', { name: 'Alpha', exact: true }).count()) === 1,
      evidence: await view.getByRole('navigation').innerText(),
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
