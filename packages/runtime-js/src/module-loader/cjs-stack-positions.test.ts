import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { afterEach, expect, it } from 'vitest';
import { createModuleLoader } from './loader.ts';

const hook = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
afterEach(() => {
  if (hook) Object.defineProperty(Error, 'prepareStackTrace', hook);
  else Reflect.deleteProperty(Error, 'prepareStackTrace');
});

const source = `function origin() {
  return new Error('position');
}
module.exports = () => {
  const text = origin().stack.split('\\n')[1].match(/:(\\d+):(\\d+)\\)?$/).slice(1).map(Number);
  const previous = Error.prepareStackTrace;
  try {
    Error.prepareStackTrace = (_, sites) => [sites[0].getLineNumber(), sites[0].getColumnNumber()];
    return { text, hook: origin().stack };
  } finally { Error.prepareStackTrace = previous; }
};
`;

for (const timing of ['during require', 'after require'] as const) {
  it(`CJS error positions ${timing} match real Node, including guest stack hooks`, () => {
    const root = mkdtempSync(join(tmpdir(), 'rifty-cjs-positions-'));
    const entry =
      timing === 'during require'
        ? "module.exports = require('./origin.cjs')();"
        : "module.exports = require('./origin.cjs');";
    try {
      writeFileSync(join(root, 'origin.cjs'), source);
      writeFileSync(join(root, 'entry.cjs'), entry);
      const invoke = timing === 'during require' ? '' : '()';
      const expected = JSON.parse(
        execFileSync(
          process.execPath,
          ['-e', `console.log(JSON.stringify(require('./entry.cjs')${invoke}))`],
          { cwd: root, encoding: 'utf8' },
        ),
      );
      const fs = new MemoryFsSync();
      fs.loadFixture({ '/app/origin.cjs': source, '/app/entry.cjs': entry });
      const loaded = createModuleLoader(fs, { cwd: '/app' }).require('./entry.cjs');
      const actual = timing === 'during require' ? loaded : (loaded as () => unknown)();
      expect(actual).toEqual(expected);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
