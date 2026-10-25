import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    engine: { type: 'string', default: 'chromium' },
    url: { type: 'string', default: 'http://127.0.0.1:5411/browser-support.html' },
    runner: { type: 'string' },
    output: { type: 'string', default: 'floor-result.json' },
    'executable-path': { type: 'string' },
    current: { type: 'boolean', default: false },
  },
});
const pins = {
  chromium: { version: '1.28.1', browser: 'chromium', expected: /^108\./ },
  firefox: { version: '1.34.3', browser: 'firefox-beta', expected: /^114\./ },
  webkit: { version: '1.55.1', browser: 'webkit', expected: /^26\.0(?:\.|$)/ },
};
const pin = pins[values.engine];
if (!pin) throw new Error('--engine must be chromium, firefox or webkit');
const result = {
  run: `floor-${values.engine}-${new Date().toISOString()}`,
  revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  worktreeDirty:
    execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0,
  platform: `${process.platform}/${process.arch}`,
  runner: values.current ? 'current' : pin.version,
  engine: values.engine,
  requestedBuild: values.current ? 'current' : pin.expected.source,
  result: 'unknown',
  steps: [],
  pageErrors: [],
};
let context;
let directory;
let phase = 'harness-install';
try {
  let packagePath = values.runner;
  if (!packagePath && !values.current) {
    directory = await mkdtemp(join(tmpdir(), 'rifty-floor-runner-'));
    execFileSync(
      'npm',
      [
        'install',
        '--prefix',
        directory,
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        `playwright@${pin.version}`,
      ],
      { stdio: 'inherit', timeout: 180000 },
    );
    packagePath = join(directory, 'node_modules/playwright');
    process.env.PLAYWRIGHT_BROWSERS_PATH = join(directory, 'browsers');
    execFileSync(
      'npm',
      [
        'exec',
        '--yes',
        '--package=node@18.20.8',
        '--',
        'node',
        join(packagePath, 'cli.js'),
        'install',
        pin.browser,
      ],
      {
        stdio: 'inherit',
        timeout: 180000,
      },
    );
  }
  const rootRequire = createRequire(new URL('../../package.json', import.meta.url));
  const localRequire = packagePath
    ? createRequire(join(resolve(packagePath), 'package.json'))
    : rootRequire;
  const playwright = packagePath
    ? localRequire(resolve(packagePath))
    : createRequire(rootRequire.resolve('@playwright/test'))('playwright');
  let executablePath = values['executable-path'];
  if (values.engine === 'firefox' && !values.current && !executablePath) {
    // Pinned 1.34.3 registry: stable is 113; its explicitly published beta is 114.0b3.
    const core = dirname(localRequire.resolve('playwright-core/package.json'));
    const { registry } = localRequire(join(core, 'lib/server/registry/index.js'));
    executablePath = registry.findExecutable('firefox-beta').executablePath();
    result.channel = '114.0b3 beta; not a stable-release claim';
  }
  phase = 'harness-launch';
  const profile = await mkdtemp(join(tmpdir(), 'rifty-floor-profile-'));
  context = await playwright[values.engine].launchPersistentContext(profile, {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const browser = context.browser();
  const page = context.pages()[0] ?? (await context.newPage());
  result.userAgent = await page.evaluate(() => navigator.userAgent);
  result.build =
    browser?.version() ??
    result.userAgent.match(
      values.engine === 'firefox'
        ? /Firefox\/([\d.]+)/
        : /(?:HeadlessChrome|Chrome|Version)\/([\d.]+)/,
    )?.[1];
  if (!values.current && !values['executable-path'] && !pin.expected.test(result.build ?? ''))
    throw new Error(`Wrong build: ${result.build}; expected ${pin.expected}`);
  page.on('pageerror', (error) =>
    result.pageErrors.push({ message: error.message, stack: error.stack }),
  );
  phase = 'harness-navigation';
  const response = await page.goto(values.url, { timeout: 60000 });
  if (!response?.ok()) throw new Error(`Host HTTP ${response?.status()}`);
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.harness === 'ready' ||
      document.documentElement.dataset.result === 'fail',
    null,
    { timeout: 60000 },
  );
  if (await page.evaluate(() => document.documentElement.dataset.result === 'fail')) {
    result.report = JSON.parse(await page.locator('#report').inputValue());
    result.result = 'fail';
    result.failingStep = 'sdk-import';
    phase = 'sdk-import';
    throw new Error('SDK module failed before boot; see report and pageErrors');
  }
  phase = 'boot';
  await page.locator('#start').click();
  try {
    await page.waitForFunction(
      () => ['pass', 'fail'].includes(document.documentElement.dataset.result),
      null,
      { timeout: 300000 },
    );
  } catch (error) {
    result.reason = `Run did not settle: ${error.message}`;
  }
  const reportText = await page.locator('#report').inputValue();
  if (reportText) {
    result.report = JSON.parse(reportText);
    result.steps = result.report.steps;
    result.result = ['pass', 'fail'].includes(result.report.result)
      ? result.report.result
      : 'unknown';
    result.failingStep = result.steps.find((step) => step.status !== 'pass')?.step;
  }
} catch (error) {
  result.reason = `${phase}: ${error.name}: ${error.message}`;
} finally {
  await context?.close();
  await writeFile(values.output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    JSON.stringify({
      run: result.run,
      build: result.build,
      result: result.result,
      failingStep: result.failingStep,
      reason: result.reason,
      output: values.output,
    }),
  );
}
// Record-only lane. Artifact distinguishes a product red from an unavailable harness.
