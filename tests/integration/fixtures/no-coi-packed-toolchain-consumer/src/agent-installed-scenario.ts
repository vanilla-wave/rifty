import type { ToolchainSandbox } from '@riftydev/sdk';

export async function agentInstalledBuildScenario(sandbox: ToolchainSandbox, registryUrl: string) {
  const project = sandbox.project({ root: '/agent-build', readonlyPaths: ['locked'] });
  await project.fs.writeFile(
    'package.json',
    JSON.stringify({
      name: 'packed-agent-build',
      version: '1.0.0',
      type: 'module',
      dependencies: { vite: '7.3.6' },
      scripts: { build: 'vite build' },
    }),
  );
  await project.fs.writeFile(
    'index.html',
    '<div id="app"></div><script type="module" src="/src/main.js"></script>',
  );
  await project.fs.writeFile(
    'src/main.js',
    "document.querySelector('#app').textContent = 'agent-first-build';",
  );
  await project.fs.writeFile(
    'vite.config.js',
    'export default { build: { minify: false, sourcemap: false } };',
  );
  await sandbox.fs.writeFile('/agent-build/locked/keep.txt', 'keep');
  await sandbox.toolchain.install({ cwd: '/agent-build', registryUrl });
  const installed = JSON.parse(await project.fs.readFile('node_modules/vite/package.json', 'utf8'));
  const first = await project.run('vite build').completion;
  if (first.exitCode !== 0)
    throw new Error(`installed vite build failed: ${JSON.stringify(first)}`);
  const readBuild = async () => {
    const files = await project.fs.readdir('dist/assets');
    return await Promise.all(
      files
        .filter((entry) => entry.name.endsWith('.js'))
        .map((entry) => project.fs.readFile(`dist/assets/${entry.name}`, 'utf8')),
    );
  };
  const firstOutput = await readBuild();
  await project.fs.writeFile(
    'src/main.js',
    "document.querySelector('#app').textContent = 'agent-edited-build';",
  );
  const rebuild = await project.run('npm run build').completion;
  if (rebuild.exitCode !== 0)
    throw new Error(`installed npm build failed: ${JSON.stringify(rebuild)}`);
  const output = await readBuild();
  const forbidden = await project.run('vite build --outDir locked').completion;
  const retained = await project.fs.readFile('locked/keep.txt', 'utf8');
  const next = await project.run('pwd && echo after-build').completion;
  return {
    version: installed.version,
    first,
    firstOutput,
    rebuild,
    output,
    forbidden,
    retained,
    next,
  };
}
