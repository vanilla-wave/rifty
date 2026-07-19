import type { Page } from '@playwright/test';

const ESBUILD_VERSION = '0.28.0';

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Finite Vite-7 oracle: preserve real public metadata selection while npm's
 * moving packument gains patch versions outside the one proven shadow recipe.
 */
export async function pinPublicEsbuild0280(page: Page): Promise<readonly string[]> {
  const requests: string[] = [];
  await page.route('**/npm-registry/esbuild', async (route) => {
    requests.push(route.request().url());
    const response = await route.fetch();
    if (!response.ok()) {
      throw new Error(`public esbuild packument failed with ${String(response.status())}`);
    }
    const packument = record(await response.json(), 'public esbuild packument');
    const versions = record(packument.versions, 'public esbuild versions');
    const exact = record(versions[ESBUILD_VERSION], `public esbuild@${ESBUILD_VERSION}`);
    if (exact.name !== 'esbuild' || exact.version !== ESBUILD_VERSION) {
      throw new Error(`public esbuild@${ESBUILD_VERSION} metadata drifted`);
    }
    const dist = record(exact.dist, `public esbuild@${ESBUILD_VERSION} dist`);
    if (
      typeof dist.tarball !== 'string' ||
      !dist.tarball.endsWith(`/esbuild-${ESBUILD_VERSION}.tgz`) ||
      typeof dist.integrity !== 'string' ||
      !dist.integrity.startsWith('sha512-')
    ) {
      throw new Error(`public esbuild@${ESBUILD_VERSION} provenance drifted`);
    }
    const tags = record(packument['dist-tags'], 'public esbuild dist-tags');
    await route.fulfill({
      response,
      json: {
        ...packument,
        'dist-tags': { ...tags, latest: ESBUILD_VERSION },
        versions: { [ESBUILD_VERSION]: exact },
      },
    });
  });
  return requests;
}
