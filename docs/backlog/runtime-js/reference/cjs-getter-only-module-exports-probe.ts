import { readFile } from 'node:fs/promises';
import Module from 'node:module';
import { extractTarGz } from '../../../../packages/npm-client/src/unpacker.ts';
import { createModuleLoader } from '../../../../packages/runtime-js/src/module-loader/index.ts';
import { MemoryFsSync } from '../../../../packages/vfs/src/internal/index.ts';

// Original ansi-styles archive. No installer/alias path involved.
const archive = await readFile(
  new URL(
    '../../../../packages/npm-client/src/_test-fixtures/npm-alias/ansi-styles-4.3.0.tgz',
    import.meta.url,
  ),
);
const files = await extractTarGz(archive);
const native = new Module('/native/ansi-styles/index.js');
native._compile(new TextDecoder().decode(files['index.js']!), '/native/ansi-styles/index.js');
const nativeExports = native.exports as { green: { open: string } };
console.log(JSON.stringify({ node: process.version, nativeGreen: nativeExports.green.open }));
const fs = new MemoryFsSync();
fs.loadFixture(
  Object.fromEntries(
    Object.entries(files).map(([path, bytes]) => [
      `/project/node_modules/ansi-styles/${path}`,
      new TextDecoder().decode(bytes),
    ]),
  ),
);
const loader = createModuleLoader(fs, { cwd: '/project' });
loader.require('ansi-styles', '/project/main.cjs');
