import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { run } from '../src/runner.ts';
import { catalogEndpoint } from './catalog-endpoint.ts';
import { lifecycleTask } from './lifecycle-task.ts';

const [output, phase, signal = 'SIGINT'] = process.argv.slice(2) as [
  string,
  string,
  NodeJS.Signals?,
];
const task = lifecycleTask();
task.files['src/main.js'] = `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(output, 'workspace-path'))}, process.cwd());
${task.files['src/main.js']}`;
if (phase === 'setup') {
  task.files['package.json'] = JSON.stringify({
    name: 'lifecycle-control',
    private: true,
    type: 'module',
    scripts: { postinstall: 'node setup.js' },
  });
  task.files['setup.js'] = `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(join(output, 'workspace-path'))}, process.cwd());
writeFileSync(${JSON.stringify(join(output, 'ready'))}, 'setup');
setInterval(() => {}, 1000);`;
} else if (phase === 'judge') {
  task.judge = async ({ view }) => {
    await writeFile(join(output, 'ready'), 'judge');
    await view.waitForTimeout(60000);
    return { pass: true, probes: [] };
  };
} else {
  const launch = chromium.launch.bind(chromium);
  chromium.launch = async (...args) => {
    const browser = await launch(...args);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async (...contextArgs) => {
      const context = await newContext(...contextArgs);
      const close = context.close.bind(context);
      context.close = async (...closeArgs) => {
        process.kill(process.pid, signal);
        await new Promise((resolve) => setTimeout(resolve, 20));
        await close(...closeArgs);
      };
      return context;
    };
    return browser;
  };
}
await run(
  {
    endpoint: catalogEndpoint('http://127.0.0.1:1/v1'),
    limits: { maxToolCalls: 1, runTimeoutMs: 60000 },
    runsPerTask: 1,
    playgroundPort: 5289,
  },
  [task],
  ['local-reference'],
  output,
  'reference',
);
