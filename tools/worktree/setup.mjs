#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Resolve from the script, including when invoked outside the checkout root.
process.chdir(fileURLToPath(new URL('../../', import.meta.url)));

function pnpm(...args) {
  console.log(`\n[worktree] pnpm ${args.join(' ')}`);
  const result = spawnSync('pnpm', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error(`Node >=24 required; running ${process.version}.`);
  }

  console.log(`[worktree] ${process.cwd()} (Node ${process.version})`);
  pnpm('--version');
  pnpm('install', '--frozen-lockfile');

  // Root postinstall tolerates download errors; setup must prove availability.
  pnpm('exec', 'playwright', 'install', '--with-deps', 'chromium', 'firefox', 'webkit');
  const { chromium, firefox, webkit } = await import('@playwright/test');
  for (const engine of [chromium, firefox, webkit]) {
    const browser = await engine.launch();
    try {
      const page = await browser.newPage();
      if ((await page.evaluate(() => 6 * 7)) !== 42) {
        throw new Error(`${engine.name()} failed its JavaScript smoke check.`);
      }
      console.log(`[worktree] ${engine.name()} launch + JavaScript OK`);
    } finally {
      await browser.close();
    }
  }

  // Even docs-only pr:check reads emitted assets (esbuild retirement gate).
  pnpm('build:libs');
  console.log('\n[worktree] Ready: dependencies, browsers and library dist built.');
}

main().catch((error) => {
  console.error('[worktree] Setup failed:', error);
  process.exitCode = 1;
});
