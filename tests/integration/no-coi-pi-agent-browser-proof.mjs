import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { withClientServer } from './client-bundle-browser-proof.mjs';

export async function provePackedNoCoiPiAgent(root) {
  const entry = (await readdir(resolve(root, 'dist/assets'))).find((name) =>
    /^noCoiAgent-.*\.js$/u.test(name),
  );
  assert(entry, 'missing packed no-COI Pi agent entry');
  const metadata = JSON.parse(
    await readFile(resolve(root, 'dist/producer-vite-snapshot.json'), 'utf8'),
  );
  await withClientServer(root, async (browser, base) => {
    const context = await browser.newContext();
    const acquisition = [];
    context.on('request', (request) => {
      if (/npm-registry|registry\.npmjs|eddy/iu.test(request.url()))
        acquisition.push(request.url());
    });
    try {
      const page = await context.newPage();
      await page.goto(base);
      await page.evaluate((entry) => import(entry), `/dist/assets/${entry}`);
      const observed = await page.evaluate(
        (snapshot) => globalThis.packedSandboxAgent.run(snapshot),
        {
          assetUrl: `${base}/dist/producer-vite-snapshot.tar.gz`,
          snapshotId: metadata.snapshotId,
          templateId: metadata.templateId,
        },
      );
      assert.equal(observed.coi, false);
      const result = observed.result;
      assert.equal(result.firstStatus, 'done');
      assert.equal(result.trace.status, 'done');
      assert.equal(result.firstPreview, 'agent-first');
      assert.equal(result.repairedPreview, 'agent-repaired');
      assert.equal(result.exited.resident, null);
      assert.equal(result.finalExit.resident, null);
      assert.match(result.deniedFile, /resident-concurrency/u);
      assert.match(JSON.stringify(result.deniedCommand), /resident-concurrency/u);
      const commands = result.trace.transcript.filter(
        (entry) => entry.role === 'toolResult' && entry.toolName === 'shell',
      );
      assert.deepEqual(
        commands.map((entry) => entry.isError),
        [false, true, false],
      );
      const offered = (index) =>
        result.requests[index].body.tools.map((tool) => tool.function.name);
      assert(offered(3).includes('preview_fetch'));
      assert(!offered(3).includes('shell'));
      assert(offered(5).includes('shell'));
      assert(!offered(5).includes('preview_fetch'));
      assert.deepEqual(
        acquisition,
        [],
        'packed agent snapshot cycle attempted registry acquisition',
      );
      console.log(
        'Packed no-COI Pi agent: edit/build/preview/exit/failed build/repair/preview; zero registry requests',
      );
    } finally {
      await context.close();
    }
  });
}
