import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const probePath = fileURLToPath(import.meta.url);
const execFileAsync = promisify(execFile);
const activeProcessGroups = new Set();

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileIdentity(projectRoot, path) {
  const bytes = await readFile(path);
  return {
    path: relative(projectRoot, path),
    bytes: bytes.byteLength,
    sha256: sha256(bytes),
  };
}

async function oracleEnvironment(projectRoot) {
  const lock = JSON.parse(await readFile(join(projectRoot, 'package-lock.json'), 'utf8'));
  const packageIdentity = async (name) => {
    const manifestPath = join(projectRoot, 'node_modules', name, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const lockEntry = lock.packages?.[`node_modules/${name}`];
    if (
      manifest.name !== name ||
      manifest.version !== '1.100.0' ||
      lockEntry?.version !== '1.100.0' ||
      typeof lockEntry.integrity !== 'string'
    ) {
      throw new Error(`${name} exact lock identity is missing`);
    }
    return { name, version: manifest.version, integrity: lockEntry.integrity };
  };

  const nodeModules = join(projectRoot, 'node_modules');
  const platformCandidates = (await readdir(nodeModules, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith('sass-embedded-') &&
        entry.name !== 'sass-embedded',
    )
    .map(({ name }) => name);
  if (platformCandidates.length !== 1) {
    throw new Error(
      `expected one installed Sass platform package, got ${platformCandidates.length}`,
    );
  }
  const platformPackage = await packageIdentity(platformCandidates[0]);
  const embeddedRequire = createRequire(
    join(projectRoot, 'node_modules', 'sass-embedded', 'package.json'),
  );
  const compilerPathModule = embeddedRequire('./dist/lib/src/compiler-path.js');
  const compilerCommand = compilerPathModule.compilerCommand;
  if (!Array.isArray(compilerCommand) || compilerCommand.length !== 2) {
    throw new Error('sass-embedded must select the platform Dart command plus snapshot');
  }
  const platformRoot = join(nodeModules, platformPackage.name);
  for (const path of compilerCommand) {
    if (typeof path !== 'string' || relative(platformRoot, path).startsWith('..')) {
      throw new Error('sass-embedded compiler command escaped the exact platform package');
    }
  }
  return {
    packages: await Promise.all([packageIdentity('sass'), packageIdentity('sass-embedded')]),
    platformPackage,
    compilerCommand: await Promise.all(
      compilerCommand.map((path) => fileIdentity(projectRoot, path)),
    ),
    compilerExecutable: compilerCommand[0],
  };
}

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

async function publishOutcome(outcome) {
  if (typeof process.send !== 'function') return;
  await new Promise((resolveSend, reject) => {
    process.send({ kind: 'sass-constructor-outcome', outcome }, (error) => {
      if (error) reject(error);
      else resolveSend();
    });
  });
  process.disconnect();
}

async function childRun(projectRoot, packageName, moduleKind, operation) {
  const sass = await loadPackage(projectRoot, packageName, moduleKind);
  if (operation === 'ImportOnly') {
    await publishOutcome({ outcome: 'imported' });
    return;
  }
  try {
    Reflect.construct(sass[operation], []);
    await publishOutcome({ outcome: 'returned' });
    process.exitCode = 2;
  } catch (error) {
    await publishOutcome({
      outcome: 'throw',
      name: typeof error?.name === 'string' ? error.name : null,
      message: typeof error?.message === 'string' ? error.message : null,
      toString: String(error),
    });
  }
}

function killProcessGroup(processGroupId) {
  try {
    process.kill(-processGroupId, 'SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function cleanupActiveProcessGroups() {
  for (const processGroupId of activeProcessGroups) killProcessGroup(processGroupId);
}

function installParentCleanup() {
  process.once('exit', cleanupActiveProcessGroups);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const relay = () => {
      cleanupActiveProcessGroups();
      process.removeListener(signal, relay);
      process.kill(process.pid, signal);
    };
    process.once(signal, relay);
  }
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    throw error;
  }
}

async function waitForProcessGroupExit(processGroupId) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (!processGroupExists(processGroupId)) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  return !processGroupExists(processGroupId);
}

async function processGroupMembers(processGroupId) {
  const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pid=,ppid=,pgid=,comm='], {
    timeout: 250,
  });
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(line);
    if (match === null || Number(match[3]) !== processGroupId) return [];
    return [
      {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        command: match[4],
      },
    ];
  });
}

function exactCompilerProcessGroup(members, processGroupId, projectRoot, compilerExecutable) {
  const leader = members.find(({ pid }) => pid === processGroupId);
  const compilerChild = members.find(
    ({ parentPid, command }) => parentPid === processGroupId && command === compilerExecutable,
  );
  if (
    members.length !== 2 ||
    leader === undefined ||
    basename(leader.command) !== basename(process.execPath) ||
    compilerChild === undefined
  ) {
    return undefined;
  }
  return {
    memberCount: members.length,
    leaderCommand: basename(leader.command),
    compilerChildCommand: relative(projectRoot, compilerChild.command),
    compilerChildParent: 'leader',
  };
}

async function inspectCompilerProcessGroup(processGroupId, projectRoot, compilerExecutable, retry) {
  let members = [];
  const expiresAt = Date.now() + (retry ? 750 : 0);
  let inspectAgain = true;
  while (inspectAgain) {
    members = await processGroupMembers(processGroupId);
    const exact = exactCompilerProcessGroup(
      members,
      processGroupId,
      projectRoot,
      compilerExecutable,
    );
    if (exact !== undefined) return exact;
    inspectAgain = retry && Date.now() < expiresAt;
    if (inspectAgain) await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`unexpected Sass compiler process group: ${JSON.stringify(members)}`);
}

async function isolatedRun(
  projectRoot,
  packageName,
  moduleKind,
  constructorName,
  startupTimeoutMs,
  postOutcomeTimeoutMs,
  compilerExecutable,
) {
  const child = spawn(
    process.execPath,
    [probePath, '--child', projectRoot, packageName, moduleKind, constructorName],
    { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  );
  if (child.pid === undefined) throw new Error('Sass constructor probe did not receive a pid');
  const processGroupId = child.pid;
  activeProcessGroups.add(processGroupId);
  let outcome;
  let startupTimedOut = false;
  let postOutcomeTimedOut = false;
  let timerFailure;
  let processGroupInspection;
  let deadlineProcessGroup;
  let deadlineInspectionPromise;
  let postOutcomeTimer;

  child.once('message', (message) => {
    if (
      message === null ||
      typeof message !== 'object' ||
      message.kind !== 'sass-constructor-outcome' ||
      message.outcome === null ||
      typeof message.outcome !== 'object'
    ) {
      timerFailure = new Error('Sass constructor child sent a malformed outcome');
      killProcessGroup(processGroupId);
      return;
    }
    outcome = message.outcome;
    clearTimeout(startupTimer);
    if (packageName === 'sass-embedded' && constructorName !== 'ImportOnly') {
      processGroupInspection = inspectCompilerProcessGroup(
        processGroupId,
        projectRoot,
        compilerExecutable,
        true,
      ).catch((error) => {
        timerFailure = error;
        try {
          killProcessGroup(processGroupId);
        } catch {
          child.kill('SIGKILL');
        }
        return undefined;
      });
    }
    postOutcomeTimer = setTimeout(() => {
      postOutcomeTimedOut = true;
      deadlineInspectionPromise = (async () => {
        try {
          if (packageName === 'sass-embedded' && constructorName !== 'ImportOnly') {
            deadlineProcessGroup = await inspectCompilerProcessGroup(
              processGroupId,
              projectRoot,
              compilerExecutable,
              false,
            );
          }
          killProcessGroup(processGroupId);
        } catch (error) {
          timerFailure = error;
          try {
            killProcessGroup(processGroupId);
          } catch {
            child.kill('SIGKILL');
          }
        }
      })();
    }, postOutcomeTimeoutMs);
  });

  const startupTimer = setTimeout(() => {
    startupTimedOut = true;
    try {
      killProcessGroup(processGroupId);
    } catch (error) {
      timerFailure = error;
      child.kill('SIGKILL');
    }
  }, startupTimeoutMs);
  const exitPromise = new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (exitCode, signal) => resolveExit({ exitCode, signal }));
  });
  let result;
  let runFailure;
  let processGroup;
  let processGroupGone = false;
  let cleanupForced = false;
  try {
    result = await exitPromise;
    if (deadlineInspectionPromise !== undefined) await deadlineInspectionPromise;
    if (processGroupInspection !== undefined) processGroup = await processGroupInspection;
    if (outcome === undefined) throw new Error('Sass constructor child exited without an outcome');
    if (timerFailure !== undefined) throw timerFailure;
  } catch (error) {
    runFailure = error;
  } finally {
    clearTimeout(startupTimer);
    clearTimeout(postOutcomeTimer);
    processGroupGone = await waitForProcessGroupExit(processGroupId);
    cleanupForced = !processGroupGone;
    if (cleanupForced) {
      killProcessGroup(processGroupId);
      processGroupGone = await waitForProcessGroupExit(processGroupId);
    }
    activeProcessGroups.delete(processGroupId);
  }
  if (!processGroupGone) throw new Error(`Sass probe process group ${processGroupId} survived`);
  if (runFailure !== undefined) throw runFailure;
  return {
    outcomeChannel: 'ipc',
    outcome,
    startupTimedOut,
    postOutcomeTimedOut,
    cleanupForced,
    processGroupGone,
    processGroup,
    deadlineProcessGroup,
    ...result,
  };
}

async function parentRun(mode, requestedRoot) {
  if (process.version !== 'v24.16.0') {
    throw new Error(`Sass constructor oracle requires Node v24.16.0, got ${process.version}`);
  }
  const projectRoot = await realpath(requestedRoot);
  const environment = await oracleEnvironment(projectRoot);
  const startupTimeoutMs = 5_000;
  const postOutcomeTimeoutMs = 1_500;
  const attempts = 2;
  const runs = {};
  for (const packageName of ['sass', 'sass-embedded']) {
    runs[packageName] = {};
    for (const moduleKind of ['cjs', 'esm']) {
      runs[packageName][moduleKind] = {};
      for (const constructorName of ['ImportOnly', 'Compiler', 'AsyncCompiler']) {
        const constructorRuns = [];
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          constructorRuns.push(
            await isolatedRun(
              projectRoot,
              packageName,
              moduleKind,
              constructorName,
              startupTimeoutMs,
              postOutcomeTimeoutMs,
              environment.compilerExecutable,
            ),
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
    startupTimeoutMs,
    postOutcomeTimeoutMs,
    attempts,
    environment: {
      packages: environment.packages,
      platformPackage: environment.platformPackage,
      compilerCommand: environment.compilerCommand,
    },
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
  installParentCleanup();
  await parentRun(process.argv[2], resolve(projectRoot));
}
