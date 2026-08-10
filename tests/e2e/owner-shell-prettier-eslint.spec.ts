import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

async function runToolingLine(page: Page, line: string, timeout: number): Promise<string> {
  await runTerminalLineSettled(page, line, timeout);
  const buffer = await terminalBuffer(page);
  const commandStart = buffer.lastIndexOf(`> ${line}`);
  if (commandStart < 0) throw new Error(`Terminal command echo missing for ${line}`);
  return buffer.slice(commandStart + line.length + 2);
}

test.describe('owner shell runs real Prettier and ESLint package tooling', () => {
  test('npm install -> npm run format/lint executes real installed CLIs', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(420_000);
    await bootShell(page);
    await openShellTerminal(page);

    const setupLine = [
      'mkdir -p src',
      'rm -f package-lock.json',
      `echo '{"name":"tooling-demo","version":"0.0.0","private":true,"type":"module","scripts":{"format":"prettier --write src/bad.ts","format:check":"prettier --check src/bad.ts","lint":"eslint src/lint.js","lint:ts":"eslint src/typed.ts"},"dependencies":{"prettier":"3.8.3","eslint":"10.4.1","typescript":"6.0.3","typescript-eslint":"8.61.0"}}' > package.json`,
      `echo 'const   label : string = "ok"; const   answer : number =  42' > src/bad.ts`,
      `echo 'var answer = 1' > src/lint.js`,
      `echo 'async function returnsPromise(): Promise<void> {} returnsPromise(); const value: any = 1; void value;' > src/typed.ts`,
      `echo 'export default { singleQuote: true };' > prettier.config.mjs`,
      `echo '{"compilerOptions":{"strict":true,"target":"ES2022","module":"ESNext","moduleResolution":"Bundler"},"include":["src/**/*.ts"]}' > tsconfig.json`,
      `echo 'import tseslint from "typescript-eslint"; const root = new URL(".", import.meta.url).pathname; export default tseslint.config({ files: ["src/**/*.js"], rules: { "no-var": "error" } }, { files: ["src/**/*.ts"], extends: [tseslint.configs.recommendedTypeChecked], languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: root } }, rules: { "@typescript-eslint/no-explicit-any": "error", "@typescript-eslint/no-floating-promises": "error" } });' > eslint.config.mjs`,
    ].join(' && ');
    await runTerminalLineSettled(page, setupLine, 30_000);
    expect(await terminalHistoryExitCode(page, setupLine)).toBe(0);

    const installOutput = await runToolingLine(page, 'npm install', 180_000);
    expect(installOutput).toMatch(/npm: installed \d+ package\(s\)/);
    expect(installOutput).toContain('npm: + prettier@3.8.3');
    expect(installOutput).toContain('npm: + eslint@10.4.1');
    expect(installOutput).toContain('npm: + typescript@6.0.3');
    expect(installOutput).toContain('npm: + typescript-eslint@8.61.0');
    expect(await terminalHistoryExitCode(page, 'npm install')).toBe(0);

    const versionLine = 'prettier --version';
    expect(await runToolingLine(page, versionLine, 60_000)).toContain('3.8.3');
    expect(await terminalHistoryExitCode(page, versionLine)).toBe(0);

    const prettierJsLine = 'prettier --write src/lint.js';
    expect(await runToolingLine(page, prettierJsLine, 60_000)).toContain('src/lint.js');
    expect(await terminalHistoryExitCode(page, prettierJsLine)).toBe(0);

    const formatLine = 'npm run format';
    await runToolingLine(page, formatLine, 60_000);
    expect(await terminalHistoryExitCode(page, formatLine)).toBe(0);
    const formatted = await runToolingLine(page, 'cat src/bad.ts', 30_000);
    expect(formatted).toContain("const label: string = 'ok';");
    expect(formatted).toContain('const answer: number = 42;');

    const formatCheckLine = 'npm run format:check';
    expect(await runToolingLine(page, formatCheckLine, 60_000)).toMatch(
      /All matched files use Prettier code style!/,
    );
    expect(await terminalHistoryExitCode(page, formatCheckLine)).toBe(0);

    const lintLine = 'npm run lint';
    const lintOutput = await runToolingLine(page, lintLine, 120_000);
    expect(lintOutput).toMatch(/\bsrc\/lint\.js/);
    expect(lintOutput).toMatch(/\bno-var\b/);
    expect(await terminalHistoryExitCode(page, lintLine)).toBe(1);

    const typedLintLine = 'npm run lint:ts';
    const typedLintOutput = await runToolingLine(page, typedLintLine, 180_000);
    expect(typedLintOutput).toMatch(/@typescript-eslint\/no-floating-promises/);
    expect(typedLintOutput).toMatch(/@typescript-eslint\/no-explicit-any/);
    expect(await terminalHistoryExitCode(page, typedLintLine)).toBe(1);
    expect(typedLintOutput).toMatch(/\bsrc\/typed\.ts/);
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

    const fixLine = 'npm run lint -- --fix';
    await runToolingLine(page, fixLine, 120_000);
    expect(await terminalHistoryExitCode(page, fixLine)).toBe(0);
    expect(await runToolingLine(page, 'cat src/lint.js', 30_000)).toContain('let answer = 1');

    const cleanLintOutput = await runToolingLine(page, lintLine, 120_000);
    expect(await terminalHistoryExitCode(page, lintLine)).toBe(0);
    expect(cleanLintOutput).not.toMatch(/\bno-var\b/);
  });
});
