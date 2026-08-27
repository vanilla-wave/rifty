import { expect, test } from '@playwright/test';
import { gotoHarness, sealedWorkbenchFixtureUrl } from './fixtures.ts';

test('real owner→kernel-child fs errors retain Node errno/syscall identity', async ({ page }) => {
  test.setTimeout(180_000);
  await gotoHarness(page);
  const observed = await page.evaluate(async (fixtureUrl) => {
    const fixture = await import(/* @vite-ignore */ fixtureUrl);
    let opened = false;
    try {
      await fixture.openSealedWorkbenchFixture({
        workspaceId: 'child-fs-transport-errors',
        template: 'hidden-empty',
        persistence: 'ephemeral',
      });
      opened = true;
      await fixture.writeProjectText(
        '/scratch/errors.cjs',
        [
          "const fs = require('node:fs');",
          "const paths = ['/missing.txt', '/dir', '/plain.txt/child'];",
          'const errors = paths.map((path) => {',
          '  try {',
          '    fs.readFileSync(path);',
          "    return { path, unexpected: 'success' };",
          '  } catch (error) {',
          '    return {',
          '      input: path,',
          '      name: error.name,',
          '      code: error.code,',
          '      errno: error.errno,',
          '      syscall: error.syscall,',
          "      path: Object.hasOwn(error, 'path') ? error.path : null,",
          '      message: error.message,',
          '    };',
          '  }',
          '});',
          "console.log('RIFTY_FS_ERRORS ' + JSON.stringify(errors));",
          '',
        ].join('\n'),
      );
      await fixture.writeProjectText('/scratch/plain.txt', 'plain\n');
      await fixture.writeProjectText('/scratch/dir/keep.txt', 'keep\n');
      const outcome = await fixture.executeProjectLineOutcome('node errors.cjs');
      const line = outcome.out
        .split(/\r?\n/u)
        .find((candidate: string) => candidate.startsWith('RIFTY_FS_ERRORS '));
      if (line === undefined) throw new Error(`missing fs error proof in ${outcome.out}`);
      return {
        errors: JSON.parse(line.slice('RIFTY_FS_ERRORS '.length)),
        exitCode: outcome.exitCode,
        exit: outcome.exit,
        closeExit: outcome.closeExit,
        closeShared: outcome.closeShared,
        settlements: outcome.settlements,
      };
    } finally {
      if (opened) await fixture.closeSealedWorkbenchFixture();
    }
  }, sealedWorkbenchFixtureUrl);

  expect(observed).toEqual({
    errors: [
      {
        input: '/missing.txt',
        name: 'Error',
        code: 'ENOENT',
        errno: -2,
        syscall: 'open',
        path: '/missing.txt',
        message: "ENOENT: no such file or directory, open '/missing.txt'",
      },
      {
        input: '/dir',
        name: 'Error',
        code: 'EISDIR',
        errno: -21,
        syscall: 'read',
        path: null,
        message: 'EISDIR: illegal operation on a directory, read',
      },
      {
        input: '/plain.txt/child',
        name: 'Error',
        code: 'ENOTDIR',
        errno: -20,
        syscall: 'open',
        path: '/plain.txt/child',
        message: "ENOTDIR: not a directory, open '/plain.txt/child'",
      },
    ],
    exitCode: 0,
    exit: { code: 0, signal: null },
    closeExit: { code: 0, signal: null },
    closeShared: true,
    settlements: 1,
  });
});
