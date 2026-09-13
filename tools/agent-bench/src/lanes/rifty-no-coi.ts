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
          baseUrl: input.endpoint.baseUrl,
          model: input.endpoint.model,
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
      async run() {
        const trace = await page.evaluate(
          (prompt) => (Reflect.get(globalThis, 'bench') as NoCoiPage).run(prompt),
          input.task.prompt,
        );
        after = await page.evaluate(() =>
          (Reflect.get(globalThis, 'bench') as NoCoiPage).snapshot(),
        );
        return coreObservation(trace, requests);
      },
      async preview() {
        await page.evaluate(() => (Reflect.get(globalThis, 'bench') as NoCoiPage).preview());
        const handle = await page.locator('iframe').elementHandle();
        const view = await handle?.contentFrame();
        if (!view) throw new Error('Packed no-COI preview frame missing');
        await view.locator('#root').waitFor();
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
