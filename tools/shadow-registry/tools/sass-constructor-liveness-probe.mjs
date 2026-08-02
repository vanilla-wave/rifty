import { spawn } from 'node:child_process';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const probePath = fileURLToPath(import.meta.url);

async function loadPackage(projectRoot, packageName, moduleKind) {
  const packageRoot = join(projectRoot, 'node_modules', packageName);
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== packageName || manifest.version !== '1.100.0') {
    throw new Error(`${packageName} must resolve to exact 1.100.0`);
  }
  if (moduleKind === 'cjs') {
    return createRequire(join(projectRoot, 'package.json'))(packageName);
  }
  const entry =
    packageName === 'sass' ? manifest.exports?.node?.default : manifest.exports?.import?.default;
  if (typeof entry !== 'string') throw new Error(`${packageName} ESM entry is missing`);
  return import(pathToFileURL(join(packageRoot, entry)).href);
}

async function childRun(projectRoot, packageName, moduleKind, constructorName) {
  const sass = await loadPackage(projectRoot, packageName, moduleKind);
  try {
    new sass[constructorName]();
    console.log(JSON.stringify({ outcome: 'returned' }));
    process.exitCode = 2;
  } catch (error) {
    console.log(
      JSON.stringify({
        outcome: 'throw',
        name: typeof error?.name === 'string' ? error.name : null,
        message: typeof error?.message === 'string' ? error.message : null,
        toString: String(error),
      }),
    );
  }
}

async function isolatedRun(projectRoot, packageName, moduleKind, constructorName, timeoutMs) {
  const child = spawn(
    process.execPath,
    [probePath, '--child', projectRoot, packageName, moduleKind, constructorName],
    { detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (child.pid === undefined) return;
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }, timeoutMs);
  const result = await new Promise((resolveClose, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolveClose({ exitCode, signal }));
  });
  clearTimeout(timer);
  return { timedOut, ...result, stdout, stderr };
}

async function parentRun(mode, requestedRoot) {
  if (process.version !== 'v24.16.0') {
    throw new Error(`Sass constructor oracle requires Node v24.16.0, got ${process.version}`);
  }
  const projectRoot = await realpath(requestedRoot);
  const timeoutMs = 1_500;
  const attempts = 2;
  const runs = {};
  for (const packageName of ['sass', 'sass-embedded']) {
    runs[packageName] = {};
    for (const moduleKind of ['cjs', 'esm']) {
      runs[packageName][moduleKind] = {};
      for (const constructorName of ['Compiler', 'AsyncCompiler']) {
        const constructorRuns = [];
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          constructorRuns.push(
            await isolatedRun(projectRoot, packageName, moduleKind, constructorName, timeoutMs),
          );
        }
        runs[packageName][moduleKind][constructorName] = constructorRuns;
      }
    }
  }
  const evidence = {
    schema: 1,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    timeoutMs,
    attempts,
    runs,
  };
  const output = new URL('../src/fixtures/sass-1.100.0-constructor-liveness.json', import.meta.url);
  const expected = `${JSON.stringify(evidence, null, 2)}\n`;
  if (mode === '--write') await writeFile(output, expected);
  else if (mode === '--check') {
    if ((await readFile(output, 'utf8')) !== expected) {
      throw new Error('Sass constructor liveness evidence drifted');
    }
  } else {
    throw new Error('usage: sass-constructor-liveness-probe.mjs --write|--check <oracle-project>');
  }
}

if (process.argv[2] === '--child') {
  await childRun(process.argv[3], process.argv[4], process.argv[5], process.argv[6]);
} else {
  const projectRoot = process.argv[3];
  if (projectRoot === undefined) {
    throw new Error('usage: sass-constructor-liveness-probe.mjs --write|--check <oracle-project>');
  }
  await parentRun(process.argv[2], resolve(projectRoot));
}
