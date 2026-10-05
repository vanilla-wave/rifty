import { readFile } from 'node:fs/promises';
import type { JudgeContext } from '../../../src/judge/context.ts';
import { verdict } from '../../../src/judge/context.ts';
export async function judge({ view }: JudgeContext) {
  const probes = [];
  try {
    const source = view.getByRole('textbox', { name: /CSV data/i });
    await source.fill(
      'name,email\r\n"Alice, A",alice@example.test\r\nBob,broken\r\nCara,cara@example.test\r\n',
    );
    await view.getByRole('button', { name: /^Import$/i }).click();
    const emails = view.getByRole('textbox', { name: /^Email\b/i });
    probes.push({
      name: 'invalid imported row retained/editable',
      pass: (await emails.count()) === 3,
      evidence: await Promise.all((await emails.all()).map((input) => input.inputValue())),
    });
    const save = view.getByRole('button', { name: /^Save$/i });
    probes.push({
      name: 'save blocked for invalid rows',
      pass: await save.isDisabled(),
      evidence: await save.isDisabled(),
    });
    for (let i = 0; i < (await emails.count()); i++)
      if ((await emails.nth(i).inputValue()) === 'broken')
        await emails.nth(i).fill('bob@example.test');
    await save.click();
    await view.goto(view.url());
    const restored = await Promise.all(
      (await view.getByRole('textbox', { name: /^Email\b/i }).all()).map((input) =>
        input.inputValue(),
      ),
    );
    probes.push({
      name: 'corrected contacts persist',
      pass: restored.length === 3 && restored.includes('bob@example.test'),
      evidence: restored,
    });
    await view.getByRole('textbox', { name: /^Filter$/i }).fill('ALICE');
    const page = 'page' in view ? view.page() : view;
    const download = page.waitForEvent('download', { timeout: 3000 }).catch(() => undefined);
    await view.getByRole('button', { name: /^Export$/i }).click();
    const output = view.getByRole('textbox', { name: /Export/i });
    let exported: string;
    if (await output.count()) exported = await output.inputValue();
    else {
      const file = await download;
      const path = await file?.path();
      exported = path ? await readFile(path, 'utf8') : '';
    }
    probes.push({
      name: 'filtered escaped CSV export',
      pass:
        exported.includes('"Alice, A",alice@example.test') &&
        !exported.includes('bob@example.test') &&
        !exported.includes('cara@example.test'),
      evidence: exported,
    });
    await source.fill('name,email\nNew,new@example.test');
    await view.getByRole('button', { name: /^Import$/i }).click();
    await view.goto(view.url());
    const unsaved = await Promise.all(
      (await view.getByRole('textbox', { name: /^Email\b/i }).all()).map((input) =>
        input.inputValue(),
      ),
    );
    probes.push({
      name: 'unsaved import leaves saved records intact',
      pass: unsaved.length === 3 && unsaved.includes('bob@example.test'),
      evidence: unsaved,
    });
  } catch (error) {
    probes.push({ name: 'workflow completed', pass: false, evidence: String(error) });
  }
  return verdict(probes);
}
