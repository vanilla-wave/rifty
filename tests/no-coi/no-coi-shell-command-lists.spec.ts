import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The agent's no-COI command path runs frozen bash 3.2.57 cases
// (packages/shell/fixtures/bash, ADR-0093): multi-line lists match bash;
// heredoc/here-string/compound syntax fails loudly with nothing applied.

const root = process.cwd().replaceAll('\\', '/');
const fixture = JSON.parse(
  readFileSync(`${root}/packages/shell/fixtures/bash/command-lists-bash-3.2.57.json`, 'utf8'),
) as {
  readonly cases: ReadonlyArray<{
    readonly id: string;
    readonly command: string;
    readonly setup: Readonly<Record<string, string>>;
    readonly bash: {
      readonly stdout: string;
      readonly exit: number;
      readonly files: Readonly<Record<string, string>>;
    };
  }>;
};

const CASES: ReadonlyArray<readonly [id: string, gap: string | null]> = [
  ['newline-redirects', null],
  ['assign-path-later-line', null],
  ['comment-lines', null],
  ['heredoc-quoted', 'shell.heredoc'],
  ['heredoc-literal-body', 'shell.heredoc'],
  ['here-string-after-side-effect', 'shell.here-string'],
  ['compound-if-multiline', 'shell.compound-command'],
];

for (const [id, gap] of CASES) {
  const testCase = fixture.cases.find((c) => c.id === id);
  if (testCase === undefined) throw new Error(`missing fixture case ${id}`);

  test(`no-COI project command vs bash: ${id}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/no-coi-harness.html');
    const observed = await page.evaluate(
      async ({ root, command, setup }) => {
        const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
        const sandbox = await createSandbox({
          requireCrossOriginIsolation: false,
          skipServiceWorker: true,
          toolchain: {
            workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-toolchain-worker.ts`,
          },
        });
        const base = '/command-lists';
        const files = async (rel = ''): Promise<Record<string, string>> => {
          const out: Record<string, string> = {};
          const entries = [...(await sandbox.fs.readdir(rel ? `${base}/${rel}` : base))];
          entries.sort((a, b) => (a.name < b.name ? -1 : 1));
          for (const entry of entries) {
            const path = rel ? `${rel}/${entry.name}` : entry.name;
            if (entry.isDirectory) {
              out[`${path}/`] = '';
              Object.assign(out, await files(path));
            } else out[path] = await sandbox.fs.readFile(`${base}/${path}`, 'utf8');
          }
          return out;
        };
        try {
          await sandbox.fs.mkdir(base, { recursive: true });
          for (const [path, body] of Object.entries(setup)) {
            await sandbox.fs.writeFile(`${base}/${path}`, body);
          }
          const before = await files();
          const outcome = await sandbox.project({ root: base }).run(command).completion;
          return {
            status: outcome.status,
            exitCode: outcome.exitCode,
            stdout: outcome.stdout,
            feature: outcome.error?.feature ?? null,
            applied: outcome.effects.applied,
            before,
            files: await files(),
          };
        } finally {
          sandbox.dispose();
        }
      },
      { root, command: testCase.command, setup: testCase.setup },
    );

    if (gap === null) {
      expect(observed).toMatchObject({
        status: 'exited',
        exitCode: testCase.bash.exit,
        stdout: testCase.bash.stdout,
        files: testCase.bash.files,
      });
      return;
    }
    expect(observed).toMatchObject({
      status: 'failed',
      stdout: '',
      feature: gap,
      applied: 'no',
      files: observed.before,
    });
  });
}
