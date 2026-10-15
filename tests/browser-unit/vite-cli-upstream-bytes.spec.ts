import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import {
  bootOwner,
  closeOwner,
  execLine,
  gotoHarness,
  readOwnerFile,
  writeOwnerFile,
} from './fixtures.ts';

// Goal honest-guest-package-adaptations I2: installed Vite `dist/node/cli.js` is
// the upstream tarball member, no rifty keepalive hook exists in the realm, and
// Vite's own action handles keep `vite build` alive.
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

const VITE7_UPSTREAM_CLI = execFileSync(
  'tar',
  [
    '-xOzf',
    fileURLToPath(
      new URL(
        '../integration/fixtures/registry/rollup-companions/packages/vite-7.3.6.tgz',
        import.meta.url,
      ),
    ),
    'package/dist/node/cli.js',
  ],
  { encoding: 'utf8' },
);
// `npm pack vite@8.0.16` → `tar -xOzf vite-8.0.16.tgz package/dist/node/cli.js | shasum -a 256`.
const VITE8_UPSTREAM_CLI_SHA256 =
  '369e1007819411176548d14afe9635e02d31d59941c91fb0a8a34f48ef0a2c41';

const HOOK_PROBE = "console.log('HOOK=' + typeof globalThis.__riftyTrackCliPromise);\n";

for (const variant of [
  { template: 'vite', upstreamSha256: sha256(VITE7_UPSTREAM_CLI) },
  { template: 'vite8', upstreamSha256: VITE8_UPSTREAM_CLI_SHA256 },
] as const) {
  test(`${variant.template}: installed cli.js is upstream bytes and vite build needs no hook`, async ({
    page,
  }) => {
    test.setTimeout(240_000);
    await gotoHarness(page);
    await bootOwner(page, {
      workspaceId: `bu-vite-cli-upstream-${variant.template}`,
      template: variant.template,
      setup: 'instant',
      persistence: 'ephemeral',
    });
    try {
      const cli = await readOwnerFile(page, '/scratch/node_modules/vite/dist/node/cli.js');
      expect(cli.ok, cli.error).toBe(true);
      expect(sha256(cli.text)).toBe(variant.upstreamSha256);
      expect(cli.text).not.toContain('__riftyTrackCliPromise');

      const config = await readOwnerFile(page, '/scratch/vite.config.js');
      expect(config.ok, config.error).toBe(true);
      await writeOwnerFile(page, '/scratch/vite.config.js', `${HOOK_PROBE}${config.text}`);
      const build = await execLine(page, 'vite build');
      expect(build.out).toContain('HOOK=undefined');
      expect(build.out).toMatch(/✓ built in/u);
      expect(build.exit, build.out).toBe(0);
      const assets = await execLine(page, 'ls dist/assets');
      expect(assets.out).toMatch(/\.js/u);
    } finally {
      await closeOwner(page);
    }
  });
}

// Real Node 24.16.0 + vite 7.3.6 (`npm install vite@7.3.6`, `node node_modules/vite/bin/vite.js build`
// with a throwing vite.config.js, 2026-10-16): exit 1, stderr
// "failed to load config from <root>/vite.config.js" / "error during build:" / "Error: rifty-config-boom".
test('vite build with a throwing config prints the error and exits 1, as in Node', async ({
  page,
}) => {
  test.setTimeout(240_000);
  await gotoHarness(page);
  await bootOwner(page, {
    workspaceId: 'bu-vite-cli-failing-config',
    template: 'vite',
    setup: 'instant',
    persistence: 'ephemeral',
  });
  try {
    await writeOwnerFile(
      page,
      '/scratch/vite.config.js',
      "throw new Error('rifty-config-boom');\n",
    );
    const build = await execLine(page, 'vite build');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the terminal colors Vite's logger (TTY).
    const lines = build.out
      .replaceAll('\r', '')
      .replace(/\u001b\[[0-9;]*m/gu, '')
      .split('\n');
    const first = lines.findIndex((line) => line.startsWith('failed to load config from '));
    expect(first, build.out).toBeGreaterThanOrEqual(0);
    expect(lines[first]).toMatch(/^failed to load config from \S*\/vite\.config\.js$/u);
    expect(lines.slice(first + 1, first + 3)).toEqual([
      'error during build:',
      'Error: rifty-config-boom',
    ]);
    expect(build.exit, build.out).toBe(1);
  } finally {
    await closeOwner(page);
  }
});
