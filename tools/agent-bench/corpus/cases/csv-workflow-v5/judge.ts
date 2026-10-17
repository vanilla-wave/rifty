import { readFile } from 'node:fs/promises';
import type { JudgeContext } from '../../../src/judge/context.ts';
import {
  action,
  caption,
  csvExportMatches,
  describedField,
  fieldValue,
  outputTexts,
  verdict,
} from '../../../src/judge/context.ts';
export async function judge(ctx: JudgeContext) {
  const { view } = ctx;
  const probes = [];
  const namespace = {
    CSV: ['CSV', 'comma separated'],
    Name: ['Name'],
    Email: ['Email', 'E-mail'],
    Filter: ['Filter', 'Search'],
  };
  const input = (name: string) => describedField(ctx, name, namespace);
  try {
    const source = input('CSV');
    await source.fill(
      'name,email\r\n"Alice, A",alice@example.test\r\n\r\n"Bob ""B""",broken\r\n,empty@example.test\r\nCara,cara@example.test\r\n',
    );
    await action(ctx, caption('Import')).click();
    const names = input('Name');
    const emails = input('Email');
    const initialNames = await Promise.all((await names.all()).map(fieldValue));
    probes.push({
      name: 'quoted fields/blank lines and invalid rows retained/editable',
      pass:
        (await emails.count()) === 4 &&
        initialNames.includes('Bob "B"') &&
        initialNames.includes(''),
      evidence: initialNames,
    });
    const save = action(ctx, caption('Save'));
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
    const saved = [
      ['Alice, A', 'alice@example.test'],
      ['Bob "B"', 'bob@example.test'],
      ['Empty corrected', 'empty@example.test'],
      ['Cara', 'cara@example.test'],
    ];
    const restored = await exportFor('');
    probes.push({
      name: 'corrected contacts persist',
      pass: restored.some((exported) => csvExportMatches(exported, saved, true)),
      evidence: restored,
    });
    async function exportFor(query: string): Promise<string[]> {
      await input('Filter').fill(query);
      const outputs = await outputTexts(ctx);
      const page = 'page' in view ? view.page() : view;
      const download = page.waitForEvent('download', { timeout: 3000 }).catch(() => undefined);
      await action(ctx, caption('Export')).click();
      outputs.push(...(await outputTexts(ctx)));
      const file = await download;
      const path = await file?.path();
      if (path) outputs.push(await readFile(path, 'utf8'));
      return outputs;
    }
    const byName = await exportFor('CORRECTED');
    probes.push({
      name: 'case-insensitive name filter',
      pass: byName.some((exported) =>
        csvExportMatches(exported, [['Empty corrected', 'empty@example.test']]),
      ),
      evidence: byName,
    });
    const outputs = await exportFor('BOB@');
    probes.push({
      name: 'case-insensitive email filter and escaped CSV export',
      pass: outputs.some((exported) =>
        csvExportMatches(exported, [['Bob "B"', 'bob@example.test']]),
      ),
      evidence: outputs,
    });
    await source.fill('name,email\nNew,new@example.test');
    await action(ctx, caption('Import')).click();
    await view.goto(view.url());
    const unsaved = await exportFor('');
    probes.push({
      name: 'unsaved import leaves saved records intact',
      pass: unsaved.some((exported) => csvExportMatches(exported, saved, true)),
      evidence: unsaved,
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
