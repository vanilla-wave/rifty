import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, version } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

export async function measureClientBundles() {
  const rows = [];
  const compilerInputs = new Map();
  async function isCompilerInput(input) {
    if (input.endsWith('/typescript/lib/typescript.js')) return true;
    if (!input.includes('/@riftydev/runtime-js/dist/') || !input.endsWith('.js')) return false;
    if (!compilerInputs.has(input)) {
      const map = JSON.parse(await readFile(resolve(root, `${input}.map`), 'utf8'));
      compilerInputs.set(
        input,
        map.sources.some((source) =>
          source.endsWith('/module-loader/generated/typescript-browser.js'),
        ),
      );
    }
    return compilerInputs.get(input);
  }
  for (const [name, contents] of Object.entries({
    toolchainHost: "export { spawnToolchainRuntime } from '@riftydev/runtime-js/internal'",
    ioProbe:
      "export { Buffer, EventEmitter, Stream, Readable, Writable, Duplex, Transform, PassThrough } from '@riftydev/io'",
    runtimeHost: "export { spawnRuntime } from '@riftydev/runtime-js'",
    main: "export { createSandbox } from '@riftydev/sdk'",
    sw: "import '@riftydev/service-worker/sw'",
    generic: "import '@riftydev/runtime-js/worker'",
    toolchain: "import '@riftydev/workbench/no-coi-toolchain-worker'",
    eval: "import './src/compiler-probe.ts'",
  })) {
    const result = await build({
      absWorkingDir: root,
      stdin: { contents, resolveDir: root },
      outdir: resolve(root, 'measure', name),
      bundle: true,
      splitting: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      target: 'chrome148',
      metafile: true,
      write: false,
    });
    const outputs = new Map(result.outputFiles.map((file) => [file.path, file.contents]));
    const entry = Object.entries(result.metafile.outputs).find(
      ([, output]) => output.entryPoint === '<stdin>',
    )?.[0];
    if (entry === undefined) throw new Error(`Missing ${name} entry output`);
    const roots = [entry];
    // This import() runs before toolchain-ready. It is boot, not first-use code.
    if (name === 'toolchain') {
      roots.push(
        ...Object.entries(result.metafile.outputs)
          .filter(
            ([, output]) =>
              output.entryPoint === 'node_modules/@riftydev/runtime-js/dist/worker.js',
          )
          .map(([path]) => path),
      );
      if (roots.length !== 2) throw new Error('Missing automatic runtime-worker boot output');
    }
    const eager = new Set();
    const pending = [...roots];
    while (pending.length > 0) {
      const path = pending.pop();
      if (eager.has(path)) continue;
      eager.add(path);
      const output = result.metafile.outputs[path];
      if (output === undefined) throw new Error(`Unresolved output edge: ${path}`);
      pending.push(
        ...output.imports
          .filter((edge) => !edge.external && edge.kind !== 'dynamic-import')
          .map((edge) => edge.path),
      );
    }
    let min = 0;
    let gzip = 0;
    const inputs = {};
    for (const path of eager) {
      const bytes = outputs.get(resolve(root, path));
      if (bytes === undefined) throw new Error(`Missing emitted bytes: ${path}`);
      min += bytes.length;
      gzip += gzipSync(bytes).length;
      for (const [input, info] of Object.entries(result.metafile.outputs[path].inputs)) {
        inputs[input] = (inputs[input] ?? 0) + info.bytesInOutput;
      }
    }
    const servedPath = (path) => `/${relative(root, resolve(root, path)).replaceAll('\\', '/')}`;
    const compilerSourceInputs = new Set();
    for (const input of Object.keys(result.metafile.inputs)) {
      if (await isCompilerInput(input)) compilerSourceInputs.add(input);
    }
    const compiler = Object.entries(result.metafile.outputs)
      .filter(([, output]) =>
        Object.entries(output.inputs).some(
          ([input, info]) => compilerSourceInputs.has(input) && info.bytesInOutput > 0,
        ),
      )
      .map(([path]) => servedPath(path));
    if (['generic', 'toolchain', 'eval'].includes(name) && compiler.length === 0) {
      throw new Error(`${name}: compiler provenance missing from packed source maps`);
    }
    const compilerLoads = {};
    for (const [operation, stem] of [
      ['eval', 'node-eval-typescript'],
      ['preload', 'tsconfig-paths'],
    ]) {
      const entry = Object.entries(result.metafile.outputs).find(([, output]) =>
        output.entryPoint?.includes(`/@riftydev/runtime-js/dist/${stem}-`),
      );
      if (entry) compilerLoads[operation] = servedPath(entry[0]);
      else if (name === 'eval') throw new Error(`Missing ${operation} lazy compiler entry`);
    }
    const backendEntry = Object.entries(result.metafile.outputs).find(
      ([, output]) => output.entryPoint === 'node_modules/@riftydev/vfs/dist/index.js',
    );
    const installSourceInputs = new Set();
    for (const input of Object.keys(result.metafile.inputs)) {
      let install =
        input.includes('/@riftydev/npm-client/') ||
        input.includes('/@riftydev/shadow-registry/') ||
        input.endsWith('/shadow-substitution-catalog.json');
      if (input.includes('/@riftydev/workbench/dist/') && input.endsWith('.js')) {
        const map = JSON.parse(await readFile(resolve(root, `${input}.map`), 'utf8'));
        install ||= map.sources.some((source) => source.endsWith('/generated/esbuild-runtime.js'));
      }
      if (install) installSourceInputs.add(input);
    }
    const install = Object.entries(result.metafile.outputs)
      .filter(([, output]) =>
        Object.entries(output.inputs).some(
          ([input, info]) => installSourceInputs.has(input) && info.bytesInOutput > 0,
        ),
      )
      .map(([path]) => servedPath(path));
    const installEntry = Object.entries(result.metafile.outputs).find(([, output]) =>
      output.entryPoint?.includes('/@riftydev/workbench/dist/no-coi-toolchain-install-'),
    );
    if (name === 'toolchain' && install.length === 0)
      throw new Error('Missing install machinery provenance');
    rows.push({
      install,
      installLoad: installEntry ? servedPath(installEntry[0]) : null,
      name,
      min,
      gzip,
      inputs,
      entry: servedPath(entry),
      eager: [...eager].map(servedPath),
      compiler,
      compilerLoads,
      backendLoad: backendEntry ? servedPath(backendEntry[0]) : null,
    });
    for (const file of result.outputFiles) {
      await mkdir(dirname(file.path), { recursive: true });
      await writeFile(file.path, file.contents);
    }
    await writeFile(
      resolve(root, 'measure', name, 'metafile.json'),
      JSON.stringify(result.metafile, null, 2),
    );
  }
  const report = { node: process.version, esbuild: version, rows };
  await writeFile(resolve(root, 'measure', 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}
