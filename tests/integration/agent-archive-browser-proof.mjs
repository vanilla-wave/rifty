import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function provePackedArchive(browser, base, liveModel) {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${base}/?archive-proof`);
    for (const kind of ['sdk', 'workbench']) {
      const marker = `auth-${randomUUID()}`;
      const saved = await page.evaluate(
        async ({ kind, marker }) =>
          (await window.__RIFTY_PACKED_ARCHIVE__).run(kind, 'save', marker),
        { kind, marker },
      );
      assert(
        saved.files.some((file) => file.text.includes(marker)),
        `${kind}: real archive files after source deletion`,
      );
      await page.reload();
      const recall = await page.evaluate(
        async (kind) => (await window.__RIFTY_PACKED_ARCHIVE__).run(kind, 'recall'),
        kind,
      );
      const results = recall.trace.transcript.filter((message) => message.role === 'toolResult');
      assert(results.some((message) => message.toolName === 'archive_search' && !message.isError));
      assert(
        results.some(
          (message) =>
            message.toolName === 'archive_read' &&
            !message.isError &&
            JSON.stringify(message).includes(marker),
        ),
        `${kind}: original decision reached model through archive_read`,
      );
      const original = JSON.parse(
        JSON.parse(saved.files.find((file) => file.text.includes(marker)).text).payload,
      );
      assert.equal(original.project.id, `${kind}-shop`);
      assert(
        original.messages.some(
          (message) => message.role === 'toolResult' && message.toolName === 'write_file',
        ),
      );
      console.log(
        `Packed archive ${kind}: source deleted, reload, discovered and read original decision`,
      );
      if (liveModel) {
        await page.reload();
        const live = await page.evaluate(
          async ({ kind, model }) =>
            (await window.__RIFTY_PACKED_ARCHIVE__).run(kind, 'recall', undefined, model),
          { kind, model: liveModel },
        );
        const answer = live.trace.transcript.at(-1);
        assert.equal(answer.role, 'assistant');
        assert(
          answer.content.some((part) => part.type === 'text' && part.text.includes(marker)),
          `${kind}: real model recalled the unknown phrase`,
        );
        for (const name of ['archive_search', 'archive_read'])
          assert(
            live.trace.transcript.some(
              (message) =>
                message.role === 'toolResult' && message.toolName === name && !message.isError,
            ),
          );
        console.log(
          `Packed archive real-model ${liveModel.model}/${kind}: exact phrase recalled through search/read after reload`,
        );
        console.log(
          `ARCHIVE_LIVE_TRACE ${JSON.stringify({ kind, model: liveModel.model, marker, trace: live.trace })}`,
        );
      }
    }
    const lifecycle = await page.evaluate(async () =>
      (await window.__RIFTY_PACKED_ARCHIVE__).lifecycle(),
    );
    assert(lifecycle.renamed && lifecycle.deleted);
    console.log('Packed archive project rename/export/import/delete: original bytes retained');
  } finally {
    await context.close();
  }
}
