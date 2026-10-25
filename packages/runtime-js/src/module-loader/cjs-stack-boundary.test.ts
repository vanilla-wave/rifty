import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';

// A guest may make Error's slot non-configurable: each run owns its realm.
function compare(source: string, dependency = 'module.exports = 42;'): void {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'rifty-cjs-boundary-')));
  const entry = join(root, 'entry.cjs');
  const dep = join(root, 'dep.cjs');
  const loader = pathToFileURL(resolve('packages/runtime-js/src/module-loader/loader.ts')).href;
  const vfs = pathToFileURL(resolve('packages/vfs/src/internal/index.ts')).href;
  try {
    writeFileSync(entry, source);
    writeFileSync(dep, dependency);
    const emit = 'console.log(JSON.stringify(value)); process.exit(0);';
    const native = execFileSync(
      process.execPath,
      ['-e', `const value = require(${JSON.stringify(entry)}); ${emit}`],
      { encoding: 'utf8' },
    );
    const guest = execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        '--input-type=module',
        '-e',
        `
      import { createModuleLoader } from ${JSON.stringify(loader)};
      import { MemoryFsSync } from ${JSON.stringify(vfs)};
      const fs = new MemoryFsSync();
      fs.loadFixture(${JSON.stringify({ [entry]: source, [dep]: dependency })});
      const value = createModuleLoader(fs, { cwd: ${JSON.stringify(root)} }).require(${JSON.stringify(entry)});
      ${emit}
    `,
      ],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(guest)).toEqual(JSON.parse(native));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

it('requiring another module preserves a frozen guest stack hook', () => {
  compare(`Object.defineProperty(Error, 'prepareStackTrace', { value: () => 'owned', configurable: false, writable: true });
module.exports = require('./dep.cjs');`);
});

it('already compiled strict CJS keeps raw filenames and positions after the guest freezes its hook', () => {
  compare(`"use strict";
function capture() { return new Error('position').stack; }
Object.defineProperty(Error, 'prepareStackTrace', { configurable: false, writable: true,
  value: (_, sites) => ({ file: sites[0].getScriptNameOrSourceURL(), line: sites[0].getLineNumber(), column: sites[0].getColumnNumber() }) });
module.exports = capture();`);
});

it('a strict body cannot escape the compiler wrapper and execute during compilation', () => {
  compare(
    `try { require('./dep.cjs'); } catch { }
module.exports = typeof globalThis.__riftyCompileEscape;`,
    `"use strict";
}); __riftyCompileEscape = true; (function(){`,
  );
});

it('a same-filename dynamic function keeps its own native offsets', () => {
  compare(`"use strict";
Error.prepareStackTrace = (_, sites) => [sites[0].getScriptNameOrSourceURL(), sites[0].getLineNumber(), sites[0].getColumnNumber()];
const capture = Function('"use strict";\\nreturn new Error("dynamic").stack;\\n//# sourceURL=' + __filename);
module.exports = capture();`);
});
