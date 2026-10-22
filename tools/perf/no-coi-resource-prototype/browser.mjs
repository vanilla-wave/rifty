// THROWAWAY: real SDK, npm packages, native children, OPFS. No runtime fakes.
import { childFsScenario } from '../child-fs/scenario.mjs';

export async function prepare(root, variant) {
  if (crossOriginIsolated || typeof SharedArrayBuffer !== 'undefined') {
    throw new Error('Benchmark must run without COI/SAB');
  }
  Reflect.set(
    globalThis,
    Symbol.for('rifty.prototype.no-coi-resources.v1'),
    variant === 'prototype',
  );
  const { createSandbox } = await import(`/@fs${root}/packages/rifty/src/index.ts`);
  const sandbox = await createSandbox({
    requireCrossOriginIsolation: false,
    serviceWorkerUrl: '/sw.js',
    storage: { namespace: 'resource-prototype', persistence: 'required' },
    startupTimeoutMs: 60_000,
    toolchain: {
      workerUrl: `/@fs${root}/packages/workbench/src/workers/no-coi-resource-prototype-worker.ts?prototype=${variant === 'prototype' ? 1 : 0}`,
      registryUrl: '/npm-registry',
    },
  });
  globalThis.resourceSandbox = sandbox;
  const fixture = childFsScenario();
  const manifest = JSON.parse(fixture.files['/package.json']);
  manifest.overrides.esbuild = '0.28.0';
  const files = {
    ...fixture.files,
    '/package.json': JSON.stringify(manifest),
    '/vite.config.js': fixture.files['/vite.config.js'].replace('minify: false', 'minify: true'),
    '/read-child.cjs': `const fs=require('node:fs'); const crypto=require('node:crypto');
const path='/project/node_modules/esbuild-wasm/esbuild.wasm';
const samples=[]; let hash; let bytes;
for(let i=0;i<3;i++){const start=performance.now();const body=fs.readFileSync(path);samples.push(performance.now()-start);bytes=body.length;hash=crypto.createHash('sha256').update(body).digest('hex');}
console.log(JSON.stringify({kind:'real-wasm-read',samples,bytes,hash}));`,
    '/read-parent.cjs': `const cp=require('node:child_process');
const child=cp.spawn(process.execPath,['/project/read-child.cjs'],{stdio:['ignore','pipe','pipe']});
child.stdout.on('data',chunk=>process.stdout.write(chunk));child.stderr.on('data',chunk=>process.stderr.write(chunk));
child.on('error',error=>{throw error});child.on('exit',code=>{process.exitCode=code});`,
  };
  for (const [path, text] of Object.entries(files))
    await sandbox.fs.writeFile(`/project${path}`, text);
  await sandbox.toolchain.install({ cwd: '/project', registryUrl: '/npm-registry' });
  globalThis.resourceProject = sandbox.project({ root: '/project' });
  return { vfs: sandbox.vfs, crossOriginIsolated, manifest };
}

export async function command(source) {
  const start = performance.now();
  const outcome = await globalThis.resourceProject.run(source).completion;
  const elapsedMs = performance.now() - start;
  if (outcome.exitCode !== 0 || outcome.status !== 'exited') {
    throw new Error(`Command failed: ${source}\n${JSON.stringify(outcome)}`);
  }
  return { elapsedMs, stdout: outcome.stdout, stderr: outcome.stderr };
}

export async function inventory(root) {
  const worker = globalThis.resourceSandbox;
  const output = [];
  const off = worker.runtime.on((event) => {
    if (event.type === 'stdout' && event.chunk) output.push(event.chunk);
  });
  const result = await worker.runtime.eval(`(()=>{
    const fs=require('node:fs'); const crypto=require('node:crypto');
    const files=[]; const dist=[]; let bytes=0; let cacheBytes=0;
    function walk(dir){for(const name of fs.readdirSync(dir)){const path=dir==='/'?'/'+name:dir+'/'+name;
      const stat=fs.statSync(path);if(stat.isDirectory()){walk(path);continue;}
      bytes+=stat.size;files.push(path);if(!path.startsWith('/project/'))cacheBytes+=stat.size;
      if(path.startsWith('/project/dist/')){const body=fs.readFileSync(path);dist.push({path:path.slice('/project/dist/'.length),bytes:body.length,sha256:crypto.createHash('sha256').update(body).digest('hex')});}
    }}walk('/');
    const wasm=fs.readFileSync('/project/node_modules/esbuild-wasm/esbuild.wasm');
    console.log('__RESOURCE_INVENTORY__'+JSON.stringify({files:files.length,bytes,cacheBytes,dist,wasm:{bytes:wasm.length,sha256:crypto.createHash('sha256').update(wasm).digest('hex')}}));
  })()`);
  off();
  if (!result.ok) throw new Error(`inventory failed: ${JSON.stringify(result)}`);
  const marker = output
    .join('')
    .split('\n')
    .find((line) => line.startsWith('__RESOURCE_INVENTORY__'));
  if (!marker) throw new Error('inventory output missing');
  const lockText = await worker.fs.readFile('/project/package-lock.json', 'utf8');
  const lock = JSON.parse(lockText);
  const versions = {};
  for (const name of Object.keys(childFsScenario().dependencies)) {
    versions[name] = JSON.parse(
      await worker.fs.readFile(`/project/node_modules/${name}/package.json`, 'utf8'),
    ).version;
  }
  return { ...JSON.parse(marker.slice('__RESOURCE_INVENTORY__'.length)), versions, lock };
}

export async function exportDist() {
  const entries = [];
  const fs = globalThis.resourceSandbox.fs;
  async function walk(dir) {
    for (const entry of await fs.readdir(dir)) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory) await walk(path);
      else {
        const bytes = await fs.readFile(path);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        entries.push({ path: path.slice('/project/dist/'.length), base64: btoa(binary) });
      }
    }
  }
  await walk('/project/dist');
  return entries;
}
