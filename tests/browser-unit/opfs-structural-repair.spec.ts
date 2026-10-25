import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

for (const layout of ['files', 'replica'] as const) {
  for (const scenario of ['rm', 'rm-mkdir-fails', 'rename', 'late-rm'] as const) {
    test(`${layout} ${scenario}: entry existence cannot certify an unproven subtree`, async ({
      page,
    }) => {
      await gotoHarness(page);
      const result = await page.evaluate(
        async ({ url, layout, scenario }) => {
          const module = await import(/* @vite-ignore */ url);
          const worker = new Worker(module.default, { type: 'module' });
          try {
            return await new Promise<{
              failed: number;
              stillUnproven: boolean;
              afterLate: number;
              repaired: number;
              live: string[];
              native: string[];
              reopened: string[];
            }>((resolve, reject) => {
              worker.onmessage = ({ data }) =>
                data.error ? reject(new Error(data.error)) : resolve(data.result);
              worker.onerror = (event) => reject(new Error(event.message));
              worker.postMessage({ layout, scenario });
            });
          } finally {
            worker.terminate();
          }
        },
        {
          url: `/@fs${process.cwd()}/tests/browser-unit/fixtures/opfs-structural-repair-worker.ts?worker&url`,
          layout,
          scenario,
        },
      );
      expect(result.failed).toBeGreaterThan(0);
      expect(result.stillUnproven).toBe(true);
      if (scenario === 'late-rm') expect(result.afterLate).toBe(0);
      expect(result.repaired).toBe(0);
      expect(result.live).toEqual(['new']);
      expect(result.native).toEqual(result.live);
      expect(result.reopened).toEqual(result.live);
    });
  }
}
