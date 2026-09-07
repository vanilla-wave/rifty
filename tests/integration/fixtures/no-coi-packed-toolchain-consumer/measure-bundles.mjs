import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build, version } from 'esbuild';

const root = dirname(fileURLToPath(import.meta.url));

export async function measureClientBundles() {
  const rows = [];
  for (const [name, contents] of Object.entries({
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
    const compiler = Object.entries(result.metafile.outputs)
      .filter(([, output]) =>
        Object.keys(output.inputs).some((input) =>
          /(?:typescript\/lib\/typescript|node-eval-typescript(?:-[^/]+)?)\.js$/u.test(input),
        ),
      )
      .map(([path]) => servedPath(path));
    rows.push({
      name,
      min,
      gzip,
      inputs,
      entry: servedPath(entry),
      eager: [...eager].map(servedPath),
      compiler,
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
