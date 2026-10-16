import type { JudgeContext } from '../../src/judge/context.ts';
import {
  action,
  caption,
  describedField,
  fieldValue,
  renderedBold,
  renderedText,
  savedNoteEntry,
  verdict,
  wikiNoteTarget,
} from '../../src/judge/context.ts';
export async function judge(ctx: JudgeContext) {
  const { view } = ctx;
  const probes = [];
  const namespace = {
    Title: ['Title', 'Name'],
    Markdown: ['Markdown', 'Body', 'Content'],
    Search: ['Search', 'Find', 'Filter'],
  };
  const input = (name: string) => describedField(ctx, name, namespace);
  const entry = (name: string) =>
    savedNoteEntry(
      ctx,
      name,
      ['Alpha', 'Beta'].filter((title) => title !== name),
    );
  try {
    const title = input('Title');
    const body = input('Markdown');
    await action(ctx, /New note/i).click();
    await title.fill('Alpha');
    await body.fill('# First\n**Important**\n[[Beta]]\n<script>not code</script>');
    await action(ctx, caption('Save')).click();
    probes.push({
      name: 'markdown headings/bold and literal HTML',
      pass:
        (await view.getByRole('heading', { name: 'First', exact: true }).count()) >= 1 &&
        (await renderedBold(ctx, 'Important')) &&
        (await renderedText(ctx, '<script>not code</script>')),
      evidence: await view.locator('body').innerText(),
    });
    const beforeMissing = await view.locator('body').ariaSnapshot();
    await (await wikiNoteTarget(ctx, 'Beta', await fieldValue(title))).first().click();
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
    await action(ctx, caption('Save')).click();
    await view.goto(view.url());
    await action(ctx, /New note/i).click();
    await input('Search').fill('ALPHA');
    probes.push({
      name: 'case-insensitive title search',
      pass:
        (await (await entry('Alpha')).count()) >= 1 && (await (await entry('Beta')).count()) === 0,
      evidence: await view.locator('body').ariaSnapshot(),
    });
    await input('Search').fill('NEEDLE');
    probes.push({
      name: 'search includes body and preserves saved notes',
      pass:
        (await (await entry('Beta')).count()) >= 1 && (await (await entry('Alpha')).count()) === 0,
      evidence: await view.locator('body').ariaSnapshot(),
    });
    await input('Search').fill('');
    await (await entry('Alpha')).first().click();
    // First matches Alpha's body only: Beta's saved entry is filtered out.
    await input('Search').fill('First');
    await (await wikiNoteTarget(ctx, 'Beta', await fieldValue(input('Title')))).first().click();
    probes.push({
      name: 'link navigates to saved body',
      pass:
        (await fieldValue(title)) === 'Beta' && (await fieldValue(body)) === 'Unique body needle',
      evidence: await fieldValue(body),
    });
    await input('Search').fill('');
    await body.fill('unsaved overwrite');
    await view.goto(view.url());
    await (await entry('Beta')).first().click();
    probes.push({
      name: 'unsaved draft does not replace persisted body',
      pass: (await fieldValue(body)) === 'Unique body needle',
      evidence: await fieldValue(body),
    });
    await action(ctx, caption('Delete')).click();
    await view.goto(view.url());
    await action(ctx, /New note/i).click();
    await input('Search').fill('');
    probes.push({
      name: 'delete persists without losing other notes',
      pass:
        (await (await entry('Beta')).count()) === 0 && (await (await entry('Alpha')).count()) >= 1,
      evidence: await view.locator('body').ariaSnapshot(),
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
