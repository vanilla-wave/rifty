const FEATURE = 'playground.vite-config-temp-cache';

const backingRewrites = [
  {
    needle: 'await fsp.mkdir(path.resolve(nodeModulesDir, ".vite-temp/"), { recursive: true });',
    replacement:
      'await __riftyViteConfigTempFs.mkdir(path.resolve(nodeModulesDir, ".vite-temp/"), { recursive: true });',
  },
  {
    needle: 'await fsp.writeFile(tempFileName, bundledCode);',
    replacement: 'await __riftyViteConfigTempFs.writeFile(tempFileName, bundledCode);',
  },
  {
    needle: 'fs.unlink(tempFileName, () => {});',
    replacement: '__riftyViteConfigTempFs.unlink(tempFileName, () => {});',
  },
] as const;

const vite7ConfigLoader = `async function loadConfigFromBundledFile(fileName, bundledCode, isESM) {
\tif (isESM) {
\t\tlet nodeModulesDir = typeof process.versions.deno === "string" ? void 0 : findNearestNodeModules(path.dirname(fileName));
\t\tif (nodeModulesDir) try {
\t\t\tawait fsp.mkdir(path.resolve(nodeModulesDir, ".vite-temp/"), { recursive: true });
\t\t} catch (e$1) {
\t\t\tif (e$1.code === "EACCES") nodeModulesDir = void 0;
\t\t\telse throw e$1;
\t\t}
\t\tconst hash$1 = \`timestamp-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;
\t\tconst tempFileName = nodeModulesDir ? path.resolve(nodeModulesDir, \`.vite-temp/\${path.basename(fileName)}.\${hash$1}.mjs\`) : \`\${fileName}.\${hash$1}.mjs\`;
\t\tawait fsp.writeFile(tempFileName, bundledCode);
\t\ttry {
\t\t\treturn (await import(pathToFileURL(tempFileName).href)).default;
\t\t} finally {
\t\t\tfs.unlink(tempFileName, () => {});
\t\t}
\t} else {
\t\tconst extension$1 = path.extname(fileName);
\t\tconst realFileName = await promisifiedRealpath(fileName);
\t\tconst loaderExt = extension$1 in _require.extensions ? extension$1 : ".js";
\t\tconst defaultLoader = _require.extensions[loaderExt];
\t\t_require.extensions[loaderExt] = (module$1, filename) => {
\t\t\tif (filename === realFileName) module$1._compile(bundledCode, filename);
\t\t\telse defaultLoader(module$1, filename);
\t\t};
\t\tdelete _require.cache[_require.resolve(fileName)];
\t\tconst raw = _require(fileName);
\t\t_require.extensions[loaderExt] = defaultLoader;
\t\treturn raw.__esModule ? raw.default : raw;
\t}
}`;

const vite8ConfigLoader = `async function loadConfigFromBundledFile(fileName, bundledCode, isESM) {
\tif (isESM) {
\t\tlet nodeModulesDir = typeof process.versions.deno === "string" ? void 0 : findNearestNodeModules(path.dirname(fileName));
\t\tif (nodeModulesDir) try {
\t\t\tawait fsp.mkdir(path.resolve(nodeModulesDir, ".vite-temp/"), { recursive: true });
\t\t} catch (e) {
\t\t\tif (e.code === "EACCES") nodeModulesDir = void 0;
\t\t\telse throw e;
\t\t}
\t\tconst hash = \`timestamp-\${Date.now()}-\${Math.random().toString(16).slice(2)}\`;
\t\tconst tempFileName = nodeModulesDir ? path.resolve(nodeModulesDir, \`.vite-temp/\${path.basename(fileName)}.\${hash}.mjs\`) : \`\${fileName}.\${hash}.mjs\`;
\t\tawait fsp.writeFile(tempFileName, bundledCode);
\t\ttry {
\t\t\treturn (await import(pathToFileURL(tempFileName).href)).default;
\t\t} finally {
\t\t\tfs.unlink(tempFileName, () => {});
\t\t}
\t} else {
\t\tconst extension = path.extname(fileName);
\t\tconst realFileName = await promisifiedRealpath(fileName);
\t\tconst loaderExt = extension in _require.extensions ? extension : ".js";
\t\tconst defaultLoader = _require.extensions[loaderExt];
\t\t_require.extensions[loaderExt] = (module, filename) => {
\t\t\tif (filename === realFileName) module._compile(bundledCode, filename);
\t\t\telse defaultLoader(module, filename);
\t\t};
\t\tdelete _require.cache[_require.resolve(fileName)];
\t\tconst raw = _require(fileName);
\t\t_require.extensions[loaderExt] = defaultLoader;
\t\treturn raw.__esModule ? raw.default : raw;
\t}
}`;

function occurrences(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

function redirectedBacking(source: string): string {
  let prepared = source;
  for (const rewrite of backingRewrites) {
    if (occurrences(prepared, rewrite.needle) !== 1) {
      throw new Error(`malformed Vite config-temp policy anchor: ${rewrite.needle}`);
    }
    prepared = prepared.replace(rewrite.needle, rewrite.replacement);
  }
  return prepared;
}

/** JSON-safe exact installed-tree transform; every leaf joins installArtifactIdentity. */
export const viteConfigTempPatchPolicy = {
  schema: 1,
  feature: FEATURE,
  bindingIdentifier: '__riftyViteConfigTempFs',
  backingRewrites,
  sources: [
    {
      version: '7.3.6',
      relativeSourcePath: 'dist/node/chunks/config.js',
      upstreamBlock: vite7ConfigLoader,
      preparedBlock: redirectedBacking(vite7ConfigLoader),
    },
    {
      version: '8.0.16',
      relativeSourcePath: 'dist/node/chunks/node.js',
      upstreamBlock: vite8ConfigLoader,
      preparedBlock: redirectedBacking(vite8ConfigLoader),
    },
  ],
} as const;

export type ViteConfigTempPatchSource = (typeof viteConfigTempPatchPolicy.sources)[number];
