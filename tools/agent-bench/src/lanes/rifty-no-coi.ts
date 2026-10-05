import type { NoCoiPage } from '../no-coi-page.ts';
import { coreObservation } from './core-observation.ts';
import type { Input, Prepared } from './types.ts';
export async function prepareNoCoi(input: Input): Promise<Prepared> {
  if (input.task.node) throw new Error('node-endpoint is unsupported in rifty-no-coi');
  const context = await input.browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(input.noCoiUrl!);
    await page.waitForFunction(() => Reflect.has(globalThis, 'bench'));
    const before = await page.evaluate(
      ({ files, settings }) =>
        (Reflect.get(globalThis, 'bench') as NoCoiPage).boot(files, settings),
      {
        files: input.task.files,
        settings: {
          endpoint: input.endpoint,
          policies: input.config.noCoiPolicies,
          apiKey: input.key,
          ...input.config.limits,
        },
      },
    );
    const requests: unknown[] = [];
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().startsWith(input.endpoint.baseUrl))
        requests.push(request.postDataJSON());
    });
    let after: typeof before | undefined;
    return {
      context,
      page,
      before,
      apply: (files) =>
        page.evaluate(
          (files) => (Reflect.get(globalThis, 'bench') as NoCoiPage).apply(files),
          files,
        ),
      async command(line) {
        const receipt = await page.evaluate(
          (line) => (Reflect.get(globalThis, 'bench') as NoCoiPage).command(line),
          line,
        );
        if (receipt.status !== 'exited')
          throw new Error(`Command did not complete: ${JSON.stringify(receipt)}`);
        return { exitCode: receipt.exitCode, stdout: receipt.stdout, stderr: receipt.stderr };
      },
      async run() {
        const { trace, events } = await page.evaluate(
          (prompt) => (Reflect.get(globalThis, 'bench') as NoCoiPage).run(prompt),
          input.task.prompt,
        );
        after = await page.evaluate(() =>
          (Reflect.get(globalThis, 'bench') as NoCoiPage).snapshot(),
        );
        return coreObservation(trace, requests, events);
      },
      async preview() {
        const url = await page.evaluate(() =>
          (Reflect.get(globalThis, 'bench') as NoCoiPage).preview(),
        );
        await page.waitForFunction(
          (url) =>
            (document.querySelector('iframe')?.contentWindow?.location.href ?? 'about:blank') ===
            new URL(url, location.href).href,
          url,
        );
        const handle = await page.locator('iframe').elementHandle();
        const view = await handle?.contentFrame();
        if (!view) throw new Error('Packed no-COI preview frame missing');
        await view.locator('body').waitFor();
        return { view, previewUrl: view.url() };
      },
      snapshot: async () =>
        after ??
        (await page.evaluate(() => (Reflect.get(globalThis, 'bench') as NoCoiPage).snapshot())),
      async close() {
        try {
          await page.evaluate(() => (Reflect.get(globalThis, 'bench') as NoCoiPage).close());
        } finally {
          await context.close();
        }
      },
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}
