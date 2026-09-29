import { checkSandboxSupport } from '@riftydev/workbench';
import workerUrl from '@riftydev/workbench/no-coi-toolchain-worker?worker&url';
import { createSandbox } from '../../packages/rifty/src/index.ts';

const pendingKey = 'rifty-browser-support-pending-v1';
const savedKey = 'rifty-browser-support-saved-v1';
const root = '/floor-proof';
const marker = 'rifty-floor-proof';
const source = `document.body.textContent = '${marker}';\n`;
const status = document.querySelector('#status');
const reportField = document.querySelector('#report');
let report;
let sandbox;
let running = false;

function render() {
  reportField.value = JSON.stringify(report, null, 2);
  document.documentElement.dataset.result = report.result;
}
function describe(error) {
  return { name: error?.name ?? 'Error', message: error?.message ?? String(error) };
}
async function step(name, run) {
  status.textContent = name;
  const started = performance.now();
  const row = { step: name, status: 'running' };
  report.steps.push(row);
  render();
  try {
    const value = await run();
    Object.assign(row, { status: 'pass', ms: Math.round(performance.now() - started), value });
    return value;
  } catch (error) {
    Object.assign(row, {
      status: 'fail',
      ms: Math.round(performance.now() - started),
      error: describe(error),
    });
    throw error;
  } finally {
    render();
  }
}
async function observations() {
  try {
    report.storage = await navigator.storage.estimate();
  } catch (error) {
    report.storage = { unknown: describe(error) };
  }
  // A non-COI page has no portable process-memory API. Do not equate JS heap with total memory.
  report.memory = {
    status: 'unknown',
    reason: 'No portable total-memory API on this non-COI page; attach OS observation manually.',
  };
  report.eviction = {
    status: 'unknown',
    reason:
      'Requires revisit on the same browser profile after seven days; survival is not an eviction guarantee.',
  };
}
async function boot() {
  sandbox = await createSandbox({
    requireCrossOriginIsolation: false,
    skipServiceWorker: true,
    storage: { persistence: 'required', namespace: report.namespace },
    toolchain: { workerUrl },
  });
  return { vfs: sandbox.vfs };
}
async function build() {
  const result = await sandbox.toolchain.runBin({
    cwd: root,
    binPath: `${root}/node_modules/.bin/vite`,
    args: ['build'],
  });
  if (result.exitCode !== 0) throw new Error(`Vite build exit ${result.exitCode}`);
  const html = await sandbox.fs.readFile(`${root}/dist/index.html`, 'utf8');
  if (!html.includes(`<title>${marker}</title>`)) throw new Error('Built HTML marker missing');
  return { exitCode: result.exitCode, html };
}
async function finish() {
  await observations();
  report.result = report.steps.some((row) => row.status === 'fail') ? 'fail' : 'pass';
  localStorage.setItem(savedKey, JSON.stringify(report));
  status.textContent = `${report.result === 'pass' ? 'Complete' : 'Completed with failures'} — copy report`;
  render();
}
async function execute(resume, revisit = false) {
  if (running) return;
  running = true;
  try {
    if (!resume) {
      report = {
        schemaVersion: 1,
        date: new Date().toISOString(),
        userAgent: navigator.userAgent,
        coi: crossOriginIsolated,
        namespace: `browser-floor-${crypto.randomUUID()}`,
        result: 'running',
        steps: [],
      };
      const support = await step('support', async () =>
        checkSandboxSupport({
          probeBaseUrl: new URL('/browser-support-probes/', location.href),
          persistence: 'required',
        }),
      );
      if (support.modes.nonCoi.conclusion !== 'supported') {
        Object.assign(report.steps[0], {
          status: 'fail',
          error: {
            name: 'SupportProbeFailure',
            message: `non-COI ${support.modes.nonCoi.conclusion}: ${support.modes.nonCoi.unmet.join(', ')}`,
          },
        });
      }
      await step('boot', boot);
      await step('seed', async () => {
        const files = {
          'package.json': JSON.stringify({
            name: 'browser-floor-proof',
            version: '1.0.0',
            type: 'module',
            dependencies: { vite: '7.3.6' },
          }),
          'index.html': `<!doctype html><title>${marker}</title><script type="module" src="/main.js"></script>`,
          'main.js': source,
          'vite.config.js': 'export default { build: { minify: false, sourcemap: false } };\n',
        };
        for (const [path, text] of Object.entries(files))
          await sandbox.fs.writeFile(`${root}/${path}`, text);
      });
      await step('install', () =>
        sandbox.toolchain.install({ cwd: root, registryUrl: '/npm-registry' }),
      );
      report.built = await step('build', build);
      await step('flush', () => sandbox.fs.flush());
      await observations();
      report.reloadOrigin = performance.timeOrigin;
      sessionStorage.setItem(pendingKey, JSON.stringify(report));
      sandbox.dispose();
      location.reload();
      return;
    }
    report = resume;
    report.result = 'running';
    if (!revisit)
      await step('reload', async () => {
        if (report.reloadOrigin === performance.timeOrigin) throw new Error('Page did not reload');
        return { previous: report.reloadOrigin, current: performance.timeOrigin };
      });
    await step(revisit ? 'revisit-boot' : 'reopen-boot', boot);
    await step(revisit ? 'revisit-saved-bytes' : 'reopen-saved-bytes', async () => {
      const actual = await sandbox.fs.readFile(`${root}/main.js`, 'utf8');
      const html = await sandbox.fs.readFile(`${root}/dist/index.html`, 'utf8');
      if (actual !== source || html !== report.built.html)
        throw new Error('Saved source or build differs');
      return { exactSource: true, exactBuiltHtml: true };
    });
    await step('reopen', () => sandbox.toolchain.open({ cwd: root, registryUrl: '/npm-registry' }));
    await step('rebuild', build);
    if (revisit)
      report.revisit = {
        date: new Date().toISOString(),
        elapsedDays: (Date.now() - Date.parse(report.date)) / 86400000,
      };
    await finish();
  } catch (error) {
    if (!report) report = { date: new Date().toISOString(), steps: [] };
    report.result = 'fail';
    report.error = describe(error);
    await observations();
    status.textContent = 'Failed — copy report';
    render();
  } finally {
    sandbox?.dispose();
    running = false;
  }
}
document.querySelector('#start').addEventListener('click', () => execute());
document.querySelector('#revisit').addEventListener('click', () => {
  const saved = localStorage.getItem(savedKey);
  if (saved) execute(JSON.parse(saved), true);
  else status.textContent = 'No saved run in this browser profile';
});
document.documentElement.dataset.harness = 'ready';
const pending = sessionStorage.getItem(pendingKey);
if (pending) {
  sessionStorage.removeItem(pendingKey);
  execute(JSON.parse(pending));
}
