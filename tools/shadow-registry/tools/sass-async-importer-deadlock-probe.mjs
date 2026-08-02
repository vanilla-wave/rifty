import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const probePath = fileURLToPath(import.meta.url);

function childRun(projectRoot, name) {
  const require = createRequire(`${resolve(projectRoot)}/package.json`);
  const sass = require(name);
  const importer = {
    canonicalize() {
      return Promise.resolve(new URL('contract:tokens'));
    },
    load() {
      return Promise.resolve({ contents: '$accent: #123456;', syntax: 'scss' });
    },
  };
  try {
    sass.compileString("@use 'tokens';", { importers: [importer] });
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

async function isolatedRun(projectRoot, name, timeoutMs) {
  const child = spawn(process.execPath, [probePath, '--child', projectRoot, name], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
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

async function parentRun(mode, projectRoot) {
  if (process.version !== 'v24.16.0') {
    throw new Error(`Sass deadlock oracle requires Node v24.16.0, got ${process.version}`);
  }
  const timeoutMs = 2_000;
  const attempts = 2;
  const runs = { sass: [], sassEmbedded: [] };
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    runs.sass.push(await isolatedRun(projectRoot, 'sass', timeoutMs));
    runs.sassEmbedded.push(await isolatedRun(projectRoot, 'sass-embedded', timeoutMs));
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
  const output = new URL(
    '../src/fixtures/sass-1.100.0-async-importer-deadlock.json',
    import.meta.url,
  );
  const expected = `${JSON.stringify(evidence, null, 2)}\n`;
  if (mode === '--write') await writeFile(output, expected);
  else if (mode === '--check') {
    if ((await readFile(output, 'utf8')) !== expected) {
      throw new Error('Sass async-importer deadlock evidence drifted');
    }
  } else {
    throw new Error(
      'usage: sass-async-importer-deadlock-probe.mjs --write|--check <oracle-project>',
    );
  }
}

if (process.argv[2] === '--child') {
  childRun(process.argv[3], process.argv[4]);
} else {
  const mode = process.argv[2];
  const projectRoot = process.argv[3];
  if (projectRoot === undefined) {
    throw new Error(
      'usage: sass-async-importer-deadlock-probe.mjs --write|--check <oracle-project>',
    );
  }
  await parentRun(mode, resolve(projectRoot));
}
