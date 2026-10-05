import { readFile } from 'node:fs/promises';
import type { JudgeContext } from '../../../src/judge/context.ts';
import { action, field, fieldValue, verdict } from '../../../src/judge/context.ts';
export async function judge(ctx: JudgeContext) {
  const { view } = ctx;
  const probes = [];
  try {
    const source = field(ctx, /CSV data/i);
    await source.fill(
      'name,email\r\n"Alice, A",alice@example.test\r\n\r\n"Bob ""B""",broken\r\n,empty@example.test\r\nCara,cara@example.test\r\n',
    );
    await action(ctx, /^Import$/i).click();
    const names = field(ctx, /^Name\b/i);
    const emails = field(ctx, /^Email\b/i);
    const initialNames = await Promise.all((await names.all()).map(fieldValue));
    probes.push({
      name: 'quoted fields/blank lines and invalid rows retained/editable',
      pass:
        (await emails.count()) === 4 &&
        initialNames.includes('Bob "B"') &&
        initialNames.includes(''),
      evidence: initialNames,
    });
    const save = action(ctx, /^Save$/i);
    probes.push({
      name: 'save blocked for invalid email/name',
      pass: await save.isDisabled(),
      evidence: await save.isDisabled(),
    });
    for (let i = 0; i < (await emails.count()); i++)
      if ((await fieldValue(emails.nth(i))) === 'broken')
        await emails.nth(i).fill('bob@example.test');
    probes.push({
      name: 'empty name remains invalid after email correction',
      pass: await save.isDisabled(),
      evidence: await save.isDisabled(),
    });
    for (let i = 0; i < (await names.count()); i++)
      if ((await fieldValue(names.nth(i))) === '') await names.nth(i).fill('Empty corrected');
    await save.click();
    await view.goto(view.url());
    const restored = await Promise.all((await field(ctx, /^Email\b/i).all()).map(fieldValue));
    probes.push({
      name: 'corrected contacts persist',
      pass:
        restored.length === 4 &&
        restored.includes('bob@example.test') &&
        restored.includes('empty@example.test'),
      evidence: restored,
    });
    await field(ctx, /^Filter$/i).fill('BOB@');
    const page = 'page' in view ? view.page() : view;
    const download = page.waitForEvent('download', { timeout: 3000 }).catch(() => undefined);
    await action(ctx, /^Export$/i).click();
    const candidates = field(ctx, /Export/i).or(view.getByText(/^name,email\b/));
    const outputs: string[] = [];
    for (const candidate of await candidates.all())
      if (await candidate.isVisible()) outputs.push(await fieldValue(candidate));
    const file = await download;
    const path = await file?.path();
    if (path) outputs.push(await readFile(path, 'utf8'));
    probes.push({
      name: 'case-insensitive email filter and escaped CSV export',
      pass: outputs.some(
        (exported) =>
          exported.includes('"Bob ""B""",bob@example.test') &&
          !exported.includes('alice@example.test') &&
          !exported.includes('cara@example.test') &&
          !exported.includes('empty@example.test'),
      ),
      evidence: outputs,
    });
    await source.fill('name,email\nNew,new@example.test');
    await action(ctx, /^Import$/i).click();
    await view.goto(view.url());
    const unsaved = await Promise.all((await field(ctx, /^Email\b/i).all()).map(fieldValue));
    probes.push({
      name: 'unsaved import leaves saved records intact',
      pass: unsaved.length === 4 && unsaved.includes('bob@example.test'),
      evidence: unsaved,
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
