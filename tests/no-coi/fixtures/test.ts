import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Browser, BrowserContext, Page, Request, Route } from '@playwright/test';

// WebKit's ephemeral contexts reject getDirectory(); each test owns a disk profile.
export const test = base.extend({
  context: async (
    { context, browserName, playwright, contextOptions, baseURL, viewport, userAgent },
    use,
    testInfo,
  ) => {
    if (browserName !== 'webkit') {
      await use(context);
      return;
    }
    const profile = await mkdtemp(join(tmpdir(), 'rifty-no-coi-webkit-'));
    try {
      const persistent = await playwright.webkit.launchPersistentContext(profile, {
        ...contextOptions,
        baseURL,
        viewport,
        userAgent,
      });
      testInfo.annotations.push({
        type: 'storage-context',
        description: 'persistent WebKit profile',
      });
      try {
        await use(persistent);
      } finally {
        await persistent.close();
      }
    } finally {
      await rm(profile, { recursive: true, force: true });
    }
  },
});

export async function waitForBoundary<T>(promise: Promise<T>, missing: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Missing test boundary: ${missing}`)), 30_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
