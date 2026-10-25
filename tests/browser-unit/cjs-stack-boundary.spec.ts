import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { gotoHarness } from './fixtures.ts';

const cases = [
  {
    name: 'frozen hook and nested require',
    source: `"use strict";
Object.defineProperty(Error, 'prepareStackTrace', { value: () => 'owned', configurable: false });
module.exports = require('./dep.cjs');`,
    dep: '"use strict";\nmodule.exports = 42;',
  },
  {
    name: 'raw strict frame after hook replacement',
    source: `"use strict";
function origin() { return new Error('position').stack; }
Object.defineProperty(Error, 'prepareStackTrace', { configurable: false,
value: (_, sites) => ({ file: sites[0].getScriptNameOrSourceURL(), line: sites[0].getLineNumber(), column: sites[0].getColumnNumber() }) });
module.exports = origin();`,
    dep: '',
  },
  {
    name: 'body cannot escape compilation',
    source: `try { require('./dep.cjs'); } catch {}
module.exports = typeof globalThis.__compileEscape;`,
    dep: '"use strict";\n}); __compileEscape = true; (function(){',
  },
  {
    name: 'same-filename dynamic function',
    source: `"use strict";
Error.prepareStackTrace = (_, sites) => [sites[0].getScriptNameOrSourceURL(), sites[0].getLineNumber(), sites[0].getColumnNumber()];
const capture = Function('"use strict";\\nreturn new Error("dynamic").stack;\\n//# sourceURL=' + __filename);
module.exports = capture();`,
    dep: '',
  },
];
for (const sample of cases) {
  test(`CJS ${sample.name}: Chromium matches Node`, async ({ page }) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'rifty-cjs-browser-')));
    const entry = join(root, 'entry.cjs');
    try {
      writeFileSync(entry, sample.source);
      writeFileSync(join(root, 'dep.cjs'), sample.dep);
      const expected = JSON.parse(
        execFileSync(
          process.execPath,
          ['-e', `console.log(JSON.stringify(require(${JSON.stringify(entry)})))`],
          { encoding: 'utf8' },
        ),
      );
      await gotoHarness(page);
      const actual = await page.evaluate(
        async ({ entry, source, dep, url }) => {
          const { default: workerUrl } = await import(/* @vite-ignore */ url);
          const worker = new Worker(workerUrl, { type: 'module' });
          try {
            return await new Promise((resolve, reject) => {
              worker.onmessage = (event) => resolve(event.data);
              worker.onerror = (event) => reject(new Error(event.message));
              worker.postMessage({ entry, source, dep });
            });
          } finally {
            worker.terminate();
          }
        },
        {
          entry,
          ...sample,
          url: `/@fs${process.cwd()}/tests/browser-unit/fixtures/cjs-stack-worker.ts?worker&url`,
        },
      );
      expect(actual).toEqual({ value: expected });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
