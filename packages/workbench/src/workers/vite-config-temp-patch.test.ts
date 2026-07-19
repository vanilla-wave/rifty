import { NotImplementedError } from '@riftydev/vfs';
import { createMemoryFs } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import {
  applyViteConfigTempPatch,
  readPreparedViteConfigSource,
  viteConfigTempPatchApplied,
} from './vite-config-temp-patch.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

function upstreamConfigLoader(version: '7.3.6' | '8.0.16'): string {
  const error = version === '7.3.6' ? 'e$1' : 'e';
  const hash = version === '7.3.6' ? 'hash$1' : 'hash';
  const extension = version === '7.3.6' ? 'extension$1' : 'extension';
  const module = version === '7.3.6' ? 'module$1' : 'module';
  return [
    'async function loadConfigFromBundledFile(fileName, bundledCode, isESM) {',
    '\tif (isESM) {',
    '\t\tlet nodeModulesDir = typeof process.versions.deno === "string" ? void 0 : findNearestNodeModules(path.dirname(fileName));',
    '\t\tif (nodeModulesDir) try {',
    '\t\t\tawait fsp.mkdir(path.resolve(nodeModulesDir, ".vite-temp/"), { recursive: true });',
    `\t\t} catch (${error}) {`,
    `\t\t\tif (${error}.code === "EACCES") nodeModulesDir = void 0;`,
    `\t\t\telse throw ${error};`,
    '\t\t}',
    `\t\tconst ${hash} = \`timestamp-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;`,
    `\t\tconst tempFileName = nodeModulesDir ? path.resolve(nodeModulesDir, \`.vite-temp/\${path.basename(fileName)}.\${${hash}}.mjs\`) : \`\${fileName}.\${${hash}}.mjs\`;`,
    '\t\tawait fsp.writeFile(tempFileName, bundledCode);',
    '\t\ttry {',
    '\t\t\treturn (await import(pathToFileURL(tempFileName).href)).default;',
    '\t\t} finally {',
    '\t\t\tfs.unlink(tempFileName, () => {});',
    '\t\t}',
    '\t} else {',
    `\t\tconst ${extension} = path.extname(fileName);`,
    '\t\tconst realFileName = await promisifiedRealpath(fileName);',
    `\t\tconst loaderExt = ${extension} in _require.extensions ? ${extension} : ".js";`,
    '\t\tconst defaultLoader = _require.extensions[loaderExt];',
    `\t\t_require.extensions[loaderExt] = (${module}, filename) => {`,
    `\t\t\tif (filename === realFileName) ${module}._compile(bundledCode, filename);`,
    `\t\t\telse defaultLoader(${module}, filename);`,
    '\t\t};',
    '\t\tdelete _require.cache[_require.resolve(fileName)];',
    '\t\tconst raw = _require(fileName);',
    '\t\t_require.extensions[loaderExt] = defaultLoader;',
    '\t\treturn raw.__esModule ? raw.default : raw;',
    '\t}',
    '}',
  ].join('\n');
}

function expectedPrepared(source: string): string {
  return source
    .replace('await fsp.mkdir(', 'await __riftyViteConfigTempFs.mkdir(')
    .replace('await fsp.writeFile(', 'await __riftyViteConfigTempFs.writeFile(')
    .replace(
      'fs.unlink(tempFileName, () => {});',
      '__riftyViteConfigTempFs.unlink(tempFileName, () => {});',
    );
}

function sourcePath(version: '7.3.6' | '8.0.16'): string {
  return version === '7.3.6'
    ? '/app/node_modules/vite/dist/node/chunks/config.js'
    : '/app/node_modules/vite/dist/node/chunks/node.js';
}

describe('Vite config temp backing acquisition patch', () => {
  it.each(['7.3.6', '8.0.16'] as const)(
    'redirects only the three backing calls in exact Vite %s source',
    (version) => {
      const upstream = `before\n${upstreamConfigLoader(version)}\nafter`;
      const prepared = applyViteConfigTempPatch(upstream, version);

      expect(prepared).toBe(expectedPrepared(upstream));
      expect(viteConfigTempPatchApplied(prepared, version)).toBe(true);
      expect(applyViteConfigTempPatch(prepared, version)).toBe(prepared);
      expect(prepared).toContain(
        'return (await import(pathToFileURL(tempFileName).href)).default;',
      );
      expect(prepared).toContain(
        'const tempFileName = nodeModulesDir ? path.resolve(nodeModulesDir, `.vite-temp/',
      );
    },
  );

  it.each([
    ['7.3.5', upstreamConfigLoader('7.3.6')],
    [
      '7.3.6',
      upstreamConfigLoader('7.3.6').replace('pathToFileURL(tempFileName).href', 'tempFileName'),
    ],
    ['8.0.16', `${upstreamConfigLoader('8.0.16')}\n${upstreamConfigLoader('8.0.16')}`],
  ])('loud-rejects unsupported or drifted source (%s)', (version, source) => {
    expect(() => applyViteConfigTempPatch(source, version)).toThrowError(
      expect.objectContaining({
        name: 'NotImplementedError',
        feature: 'playground.vite-config-temp-cache',
      }),
    );
  });
});

describe('readPreparedViteConfigSource', () => {
  it('returns null only when the project has no installed Vite package', () => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/app', { recursive: true });

    expect(readPreparedViteConfigSource(fsSync, '/app')).toBeNull();
  });

  it.each(['7.3.6', '8.0.16'] as const)(
    'returns a defensive byte copy from the exact prepared Vite %s path',
    (version) => {
      const { fsSync } = createMemoryFs();
      const path = sourcePath(version);
      fsSync.mkdirSync(path.slice(0, path.lastIndexOf('/')), { recursive: true });
      fsSync.writeFileSync(
        '/app/node_modules/vite/package.json',
        enc.encode(JSON.stringify({ name: 'vite', version })),
      );
      fsSync.writeFileSync(
        path,
        enc.encode(applyViteConfigTempPatch(upstreamConfigLoader(version), version)),
      );

      const prepared = readPreparedViteConfigSource(fsSync, '/app');
      expect(prepared?.relativeSourcePath).toBe(path.slice('/app/'.length));
      expect(dec.decode(prepared?.sourceBytes)).toBe(
        expectedPrepared(upstreamConfigLoader(version)),
      );
      prepared?.sourceBytes.fill(0);
      expect(dec.decode(fsSync.readFileBytesSync(path))).toContain(
        '__riftyViteConfigTempFs.writeFile',
      );
    },
  );

  it.each([
    ['unsupported version', '7.3.5', 'config.js', expectedPrepared(upstreamConfigLoader('7.3.6'))],
    ['wrong path', '8.0.16', 'config.js', expectedPrepared(upstreamConfigLoader('8.0.16'))],
    ['unprepared source', '8.0.16', 'node.js', upstreamConfigLoader('8.0.16')],
  ])('loud-rejects %s', (_label, version, chunk, source) => {
    const { fsSync } = createMemoryFs();
    fsSync.mkdirSync('/app/node_modules/vite/dist/node/chunks', { recursive: true });
    fsSync.writeFileSync(
      '/app/node_modules/vite/package.json',
      enc.encode(JSON.stringify({ name: 'vite', version })),
    );
    fsSync.writeFileSync(`/app/node_modules/vite/dist/node/chunks/${chunk}`, enc.encode(source));

    expect(() => readPreparedViteConfigSource(fsSync, '/app')).toThrow(NotImplementedError);
  });
});
