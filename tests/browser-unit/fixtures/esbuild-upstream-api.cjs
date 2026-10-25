const fs = require('node:fs');
const esbuild = require(process.argv[2]);
const result = { version: esbuild.version };
const errorOf = (error) => ({
  name: error.name,
  message: error.message,
  errors: error.errors,
  warnings: error.warnings,
});
const capture = async (operation) => {
  try {
    return { value: await operation() };
  } catch (error) {
    return { error: errorOf(error) };
  }
};
const outputs = (build) => build.outputFiles.map((file) => ({ path: file.path, text: file.text }));
const bounded = (promise) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('upstream watch did not observe the file edit')),
      10000,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
(async () => {
  try {
    result.initialize = await capture(() => esbuild.initialize({}));
    result.initializeTwice = await capture(() => esbuild.initialize({}));
    result.transform = await esbuild.transform('export const n: number = 7', {
      loader: 'ts',
      format: 'esm',
      sourcemap: 'external',
      sourcefile: 'input.ts',
    });
    result.invalid = await capture(() =>
      esbuild.transform('let x: = 1', {
        loader: 'ts',
        sourcefile: 'invalid.ts',
        logLevel: 'silent',
      }),
    );
    result.messages = await esbuild.formatMessages([{ text: 'test diagnostic' }], {
      kind: 'warning',
      color: false,
    });
    const build = await esbuild.build({
      entryPoints: ['src/index.ts'],
      bundle: true,
      write: false,
      metafile: true,
      logLevel: 'silent',
    });
    result.build = outputs(build);
    result.metafile = build.metafile;
    result.analysis = await esbuild.analyzeMetafile(build.metafile, { color: false });
    const events = [];
    result.plugin = outputs(
      await esbuild.build({
        entryPoints: ['virtual'],
        bundle: true,
        write: false,
        logLevel: 'silent',
        plugins: [
          {
            name: 'fixture',
            setup(builder) {
              builder.onStart(() => {
                events.push('start');
              });
              builder.onResolve({ filter: /^virtual$/ }, () => ({
                path: 'entry',
                namespace: 'fixture',
              }));
              builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
                contents: 'export const answer = 42',
                loader: 'js',
              }));
              builder.onEnd(() => {
                events.push('end');
              });
            },
          },
        ],
      }),
    );
    result.pluginEvents = events;
    const context = await esbuild.context({
      entryPoints: ['src/index.ts'],
      bundle: true,
      write: false,
      logLevel: 'silent',
    });
    try {
      result.rebuild = outputs(await context.rebuild());
      await context.cancel();
      result.serve = await capture(() => context.serve());
    } finally {
      await context.dispose();
    }
    let first;
    let changed;
    const firstBuild = new Promise((resolve) => {
      first = resolve;
    });
    const changedBuild = new Promise((resolve) => {
      changed = resolve;
    });
    let phase = 0;
    const watch = await esbuild.context({
      entryPoints: ['src/index.ts'],
      bundle: true,
      write: false,
      logLevel: 'silent',
      plugins: [
        {
          name: 'watch-proof',
          setup(builder) {
            builder.onEnd((build) => {
              if (build.errors.length) return;
              (phase === 0 ? first : changed)(outputs(build));
            });
          },
        },
      ],
    });
    try {
      await watch.watch();
      const before = await bounded(firstBuild);
      phase = 1;
      fs.writeFileSync('src/m.ts', 'export const answer: number = 99;\n');
      const after = await bounded(changedBuild);
      result.watch = { before, after };
    } finally {
      await watch.dispose();
    }
    await esbuild.stop();
    result.restart = await esbuild.transform('const restarted = true');
    await esbuild.stop();
    fs.writeFileSync('api-result.json', JSON.stringify(result).split(process.cwd()).join('<cwd>'));
  } finally {
    esbuild.stop();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
