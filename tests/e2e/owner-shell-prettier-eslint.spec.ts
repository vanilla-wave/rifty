import { expect, test } from '@playwright/test';
import {
  expectTerminalContains,
  openShellTerminal,
  runTerminalLine,
  terminalBuffer,
} from './helpers/playground.ts';

test.describe('owner shell runs real Prettier and ESLint package tooling', () => {
  test('npm install -> npm run format/lint executes real installed CLIs', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(300_000);
    await page.goto('/');
    await openShellTerminal(page);

    await runTerminalLine(
      page,
      [
        'mkdir -p src',
        `echo '{"name":"tooling-demo","version":"0.0.0","private":true,"type":"module","scripts":{"format":"prettier --write src/bad.ts","format:check":"prettier --check src/bad.ts","lint":"eslint src/lint.js","lint:ts":"eslint src/typed.ts"},"dependencies":{"prettier":"3.8.3","eslint":"10.4.1","typescript":"6.0.3","typescript-eslint":"8.61.0"}}' > package.json`,
        `echo 'const   label : string = "ok"; const   answer : number =  42' > src/bad.ts`,
        `echo 'var answer = 1' > src/lint.js`,
        `echo 'async function returnsPromise(): Promise<void> {} returnsPromise(); const value: any = 1; void value;' > src/typed.ts`,
        `echo 'export default { singleQuote: true };' > prettier.config.mjs`,
        `echo '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"Bundler"},"include":["src/**/*.ts"]}' > tsconfig.json`,
        `echo 'import tseslint from "typescript-eslint"; const root = new URL(".", import.meta.url).pathname; export default tseslint.config({ files: ["src/**/*.js"], rules: { "no-var": "error" } }, { files: ["src/**/*.ts"], extends: [tseslint.configs.recommendedTypeChecked], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } }, rules: { "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/no-floating-promises": "error" } });' > eslint.config.mjs`,
        'echo SETUP_DONE',
      ].join(' && '),
    );
    await expectTerminalContains(page, 'SETUP_DONE', 20_000);

    await runTerminalLine(page, 'npm install');
    await expectTerminalContains(page, /npm: installed \d+ package\(s\)/, 180_000);
    expect(await terminalBuffer(page)).toContain('npm: + prettier@3.8.3');
    expect(await terminalBuffer(page)).toContain('npm: + eslint@10.4.1');
    expect(await terminalBuffer(page)).toContain('npm: + typescript@6.0.3');
    expect(await terminalBuffer(page)).toContain('npm: + typescript-eslint@8.61.0');

    await runTerminalLine(page, 'prettier --version && echo PRETTIER_VERSION_DONE');
    await expectTerminalContains(page, '3.8.3', 60_000);
    await expectTerminalContains(page, 'PRETTIER_VERSION_DONE', 60_000);

    await runTerminalLine(page, 'prettier --write src/lint.js && echo PRETTIER_JS_DONE');
    await expectTerminalContains(page, 'PRETTIER_JS_DONE', 60_000);

    await runTerminalLine(page, 'npm run format && cat src/bad.ts && echo FORMAT_DONE');
    await expectTerminalContains(page, "const label: string = 'ok';", 60_000);
    await expectTerminalContains(page, 'const answer: number = 42;', 60_000);
    await expectTerminalContains(page, 'FORMAT_DONE', 60_000);

    await runTerminalLine(page, 'npm run format:check');
    await expectTerminalContains(page, /All matched files use Prettier code style!/, 60_000);

    await runTerminalLine(page, 'npm run lint || echo ESLINT_EXPECTED_FAILURE');
    await expectTerminalContains(page, /no-var/, 60_000);
    await expectTerminalContains(page, 'ESLINT_EXPECTED_FAILURE', 60_000);

    await runTerminalLine(page, 'npm run lint:ts || echo TSLINT_EXPECTED_FAILURE');
    await expectTerminalContains(page, /@typescript-eslint\/no-floating-promises/, 60_000);
    await expectTerminalContains(page, /@typescript-eslint\/no-explicit-any/, 60_000);
    await expectTerminalContains(page, 'TSLINT_EXPECTED_FAILURE', 60_000);
    const typedLintOutput = await terminalBuffer(page);
    expect(typedLintOutput).toMatch(/(?:\/scratch\/)?src\/typed\.ts/);
    for (const crashMarker of [
      'Oops! Something went wrong!',
      'Parsing error',
      "don't have parserOptions",
      'is not a function',
    ]) {
      expect(typedLintOutput, `typed ESLint must not fail via ${crashMarker}`).not.toContain(
        crashMarker,
      );
    }

    await runTerminalLine(page, 'npm run lint -- --fix && cat src/lint.js && echo LINT_FIX_DONE');
    await expectTerminalContains(page, 'let answer = 1', 60_000);
    await expectTerminalContains(page, 'LINT_FIX_DONE', 60_000);

    await runTerminalLine(page, 'npm run lint && echo ESLINT_CLEAN');
    await expectTerminalContains(page, 'ESLINT_CLEAN', 60_000);
  });
});
