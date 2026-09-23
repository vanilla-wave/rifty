import { type Page, expect, test } from '@playwright/test';
import {
  bootShell,
  openShellTerminal,
  runTerminalLineSettled,
  terminalBuffer,
  terminalHistoryExitCode,
} from './helpers/playground.ts';

// Acceptance of goal vitest-run-in-browser (docs/backlog/runtime-js/vitest-run-acceptance.md).
// Expected lines/counts/exit codes = real-Node oracle (Node v24.16.0, npm 11.17.0) in
// docs/backlog/runtime-js/reference/vitest-run-acceptance-evidence.md. Timing/ANSI not claimed (I4).

const MANIFEST = {
  type: 'module',
  scripts: { test: 'vitest run' },
  devDependencies: { vitest: '4.1.11' },
  overrides: { vite: '8.0.16' },
};

const CONFIG = [
  "import { defineConfig } from 'vitest/config';",
  "export default defineConfig({ test: { include: ['src/**/*.test.ts'] } })",
];

const SUM = ['export const sum = (a: number,', '  b: number): number => a + b'];

// Multi-line on purpose: the failure location (9:21) crosses the vm/source-map path.
function sumTest(secondExpected: number): string[] {
  return [
    "import { expect, test } from 'vitest';",
    "import { sum } from './sum';",
    '',
    "test('first sum', () => {",
    '  expect(sum(1, 2)).toBe(3);',
    '});',
    '',
    "test('second sum', () => {",
    `  expect(sum(1, 2)).toBe(${String(secondExpected)});`,
    '});',
  ];
}

// vitest's default include collects this; the config's `include` must not.
const DECOY = [
  "import { test } from 'vitest';",
  "test('DECOY-COLLECTED', () => {",
  "  throw new Error('DECOY-COLLECTED: include glob ignored');",
  '});',
];

/** `printf` FORMAT writing `lines` verbatim (no `%`/`\` in these sources). */
function writeFile(path: string, lines: readonly string[]): string {
  const body = `${lines.join('\\n')}\\n`;
  return `printf '${body.replaceAll("'", "'\\''")}' > ${path}`;
}

function seedLine(manifest: object, secondExpected = 4): string {
  return [
    // The starter ships node_modules/vite@7.3.6; the scenario starts clean.
    'rm -rf node_modules package-lock.json',
    'mkdir -p src test',
    writeFile('package.json', [JSON.stringify(manifest)]),
    writeFile('vitest.config.ts', CONFIG),
    writeFile('src/sum.ts', SUM),
    writeFile('src/sum.test.ts', sumTest(secondExpected)),
    writeFile('test/decoy.test.ts', DECOY),
  ].join(' && ');
}

// Every `vite` dir anywhere under node_modules + the lock's vite entries.
const TREE_PROBE = `node -e '${[
  'const fs=require("fs"),path=require("path");const found=[];',
  'const walk=(dir)=>{for(const e of fs.readdirSync(dir,{withFileTypes:true})){if(!e.isDirectory())continue;',
  'const p=path.join(dir,e.name);if(e.name.startsWith("@")){walk(p);continue;}',
  'if(e.name==="vite"&&fs.existsSync(path.join(p,"package.json")))found.push(p+"@"+JSON.parse(fs.readFileSync(path.join(p,"package.json"),"utf8")).version);',
  'const nm=path.join(p,"node_modules");if(fs.existsSync(nm))walk(nm);}};walk("node_modules");',
  'console.log("VITE-DIRS="+JSON.stringify(found));',
  'const lock=JSON.parse(fs.readFileSync("package-lock.json","utf8"));',
  'console.log("LOCK-VITE="+JSON.stringify(Object.keys(lock.packages).filter((k)=>/(^|\\/)node_modules\\/vite$/.test(k)).map((k)=>k+"@"+lock.packages[k].version)));',
  'console.log("VITEST="+JSON.parse(fs.readFileSync("node_modules/vitest/package.json","utf8")).version);',
  'console.log("WASM32="+fs.existsSync("node_modules/@rolldown/binding-wasm32-wasi/package.json"));',
].join('')}'`;

interface CommandResult {
  readonly output: string;
  readonly exitCode: number;
}

/** Exit code only — long lines soft-wrap, so their echo is not sliced. */
async function exitOf(page: Page, line: string, timeout: number): Promise<number> {
  await runTerminalLineSettled(page, line, timeout);
  return terminalHistoryExitCode(page, line);
}

async function run(page: Page, line: string, timeout: number): Promise<CommandResult> {
  await runTerminalLineSettled(page, line, timeout);
  const buffer = await terminalBuffer(page);
  const start = buffer.lastIndexOf(`> ${line}`);
  if (start < 0) throw new Error(`terminal command echo missing for ${line}`);
  return {
    output: buffer.slice(start + line.length + 2),
    exitCode: await terminalHistoryExitCode(page, line),
  };
}

async function bootScenario(page: Page, manifest: object): Promise<void> {
  await bootShell(page);
  await openShellTerminal(page);
  expect(await exitOf(page, seedLine(manifest), 30_000)).toBe(0);
}

async function install(page: Page): Promise<string> {
  const result = await run(page, 'npm install', 300_000);
  expect(result.exitCode, result.output).toBe(0);
  return result.output;
}

// A wall on the claimed path (I6) or a startup error printed before exit.
const CLAIMED_PATH_WALL = /Startup Error|ModuleLoadError|SyntaxError|Not implemented:/u;

// Reporter lines common to TTY and non-TTY Node runs (evidence §Oracle).
function expectFailingRun(output: string, verbose: boolean): void {
  expect(output).toMatch(/RUN\s+v4\.1\.11 /u);
  if (verbose) {
    expect(output).toMatch(/✓ src\/sum\.test\.ts > first sum/u);
    expect(output).toMatch(/× src\/sum\.test\.ts > second sum/u);
    expect(output).toMatch(/→ expected 3 to be 4 \/\/ Object\.is equality/u);
  } else {
    expect(output).toMatch(/❯ src\/sum\.test\.ts \(2 tests \| 1 failed\)/u);
    expect(output).toMatch(/✓ first sum/u);
    expect(output).toMatch(/× second sum/u);
  }
  expect(output).toMatch(/FAIL\s+src\/sum\.test\.ts > second sum/u);
  expect(output).toContain('AssertionError: expected 3 to be 4 // Object.is equality');
  expect(output).toMatch(/^- Expected\s*$/mu);
  expect(output).toMatch(/^\+ Received\s*$/mu);
  expect(output).toMatch(/^- 4\s*$/mu);
  expect(output).toMatch(/^\+ 3\s*$/mu);
  expect(output).toMatch(/❯ src\/sum\.test\.ts:9:21/u);
  expect(output).toMatch(/ 9\| {3}expect\(sum\(1, 2\)\)\.toBe\(4\);/u);
  expect(output).toMatch(/Test Files\s+1 failed \(1\)/u);
  expect(output).toMatch(/Tests\s+1 failed \| 1 passed \(2\)/u);
  expect(output).not.toContain('DECOY-COLLECTED');
  expect(output).not.toMatch(CLAIMED_PATH_WALL);
}

function expectPassingRun(output: string, verbose: boolean): void {
  expect(output).toMatch(/RUN\s+v4\.1\.11 /u);
  if (verbose) {
    expect(output).toMatch(/✓ src\/sum\.test\.ts > first sum/u);
    expect(output).toMatch(/✓ src\/sum\.test\.ts > second sum/u);
  } else {
    expect(output).toMatch(/✓ src\/sum\.test\.ts \(2 tests\)/u);
  }
  expect(output).toMatch(/Test Files\s+1 passed \(1\)/u);
  expect(output).toMatch(/Tests\s+2 passed \(2\)/u);
  expect(output).not.toMatch(/FAIL|failed/u);
  expect(output).not.toContain('DECOY-COLLECTED');
  expect(output).not.toMatch(CLAIMED_PATH_WALL);
}

const RUNS = [
  { line: 'vitest run', verbose: false },
  { line: 'npm test', verbose: false },
  { line: 'vitest run --reporter=verbose', verbose: true },
  { line: 'vitest run --pool=forks', verbose: false },
  { line: 'vitest run --pool=threads', verbose: false },
  { line: 'vitest run --pool=threads --reporter=verbose', verbose: true },
] as const;

test.describe('vitest 4.1.11 on vite 8.0.16 in the browser shell', () => {
  test('npm install + vitest run report Node results and exit codes on both pools', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(900_000);

    await bootScenario(page, MANIFEST);
    const installed = await install(page);
    expect(installed).toContain('lightningcss-wasm@1.32.0');
    expect(installed).toContain('substituted from shadow registry');
    expect(await exitOf(page, TREE_PROBE, 60_000)).toBe(0);
    const buffer = await terminalBuffer(page);
    const tree = buffer.slice(buffer.lastIndexOf('VITE-DIRS='));
    expect(tree).toContain('VITE-DIRS=["node_modules/vite@8.0.16"]');
    expect(tree).toContain('LOCK-VITE=["node_modules/vite@8.0.16"]');
    expect(tree).toContain('VITEST=4.1.11');
    expect(tree).toContain('WASM32=true');

    for (const { line, verbose } of RUNS) {
      const result = await run(page, line, 180_000);
      expect(result.exitCode, `${line}\n${result.output}`).toBe(1);
      expectFailingRun(result.output, verbose);
      if (line === 'npm test') expect(result.output).toContain('> vitest run');
    }

    expect(await exitOf(page, writeFile('src/sum.test.ts', sumTest(3)), 30_000)).toBe(0);
    for (const { line, verbose } of RUNS) {
      const result = await run(page, line, 180_000);
      expect(result.exitCode, `${line}\n${result.output}`).toBe(0);
      expectPassingRun(result.output, verbose);
      if (line === 'npm test') expect(result.output).toContain('> vitest run');
    }

    // Watch-mode ⚠️ boundary: shell stdin is not a TTY, so bare `vitest` runs once
    // (Node `vitest < /dev/null`, evidence §Oracle — outside the claim).
    const once = await run(page, 'vitest', 180_000);
    expect(once.exitCode, `vitest\n${once.output}`).toBe(0);
    expectPassingRun(once.output, false);
  });

  test('unclaimed modes fail loudly with a named ceiling, never a silent pass', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'workspace owner is COI/SAB-gated — chromium only');
    test.setTimeout(900_000);

    // Manifest precondition: without the pin, vitest's `vite` edge resolves latest
    // Vite, whose lightningcss range the shadow recipe refuses loudly.
    const { overrides: _pin, ...organic } = MANIFEST;
    await bootScenario(page, organic);
    const unpinned = await run(page, 'npm install', 300_000);
    expect(unpinned.exitCode, unpinned.output).toBe(1);
    expect(unpinned.output).toContain('Not implemented: lightningcss.version');

    const ceilingManifest = {
      ...MANIFEST,
      devDependencies: {
        ...MANIFEST.devDependencies,
        jsdom: '30.0.1',
        'happy-dom': '20.0.0',
        '@vitest/coverage-v8': '4.1.11',
        '@vitest/browser-playwright': '4.1.11',
        playwright: '1.60.0',
      },
    };
    // Passing tests: exit 1 below can only come from the mode's ceiling.
    expect(await exitOf(page, seedLine(ceilingManifest, 3), 30_000)).toBe(0);
    await install(page);

    async function expectCeiling(line: string, ...named: readonly (string | RegExp)[]) {
      const result = await run(page, line, 180_000);
      expect(result.exitCode, `${line}\n${result.output}`).toBe(1);
      for (const part of named) {
        if (typeof part === 'string') expect(result.output).toContain(part);
        else expect(result.output).toMatch(part);
      }
      expect(result.output).not.toMatch(/Tests\s+2 passed/u);
    }

    // Name bound to the throw's own line (serialize joins soft-wrapped rows).
    await expectCeiling(
      'vitest run --environment=jsdom',
      /Not implemented: [^\n]*DONT_CONTEXTIFY/u,
    );
    await expectCeiling(
      'vitest run --environment=happy-dom',
      'Not implemented: module-loader.esm-global-function-assignment',
    );
    await expectCeiling(
      'vitest run --coverage',
      "Built-in 'node:inspector/promises' is not implemented",
    );
    await expectCeiling(
      'vitest run --pool=vmThreads',
      /Not implemented: [^\n]*experimental-vm-modules/u,
    );
    await expectCeiling(
      'vitest run --pool=vmForks',
      /Not implemented: [^\n]*experimental-vm-modules/u,
    );

    const browserConfig = writeFile('vitest.config.ts', [
      "import { defineConfig } from 'vitest/config';",
      "import { playwright } from '@vitest/browser-playwright';",
      "export default defineConfig({ test: { include: ['src/**/*.test.ts'], browser: { enabled: true, provider: playwright(), instances: [{ browser: 'chromium' }] } } })",
    ]);
    expect(await exitOf(page, browserConfig, 30_000)).toBe(0);
    await expectCeiling('vitest run', /Not implemented: node:https?\.Agent/u);
  });
});
