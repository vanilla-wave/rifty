import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildProjectPackageJson } from '../../apps/playground/src/templates/project-spec.ts';
import { WEBPACK_DEV_SERVER_TEMPLATE } from '../../apps/playground/src/templates/webpack-dev-server.ts';

// RIFTY_RUN_WEBPACK_NODE_ORACLE=1 pnpm exec tsx tests/diagnostics/webpack-dev-server-node24-oracle.ts
const OPT_IN_ENV = 'RIFTY_RUN_WEBPACK_NODE_ORACLE';
const COMMAND_TIMEOUT_MS = 180_000;
const COMPILE_TIMEOUT_MS = 60_000;
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

async function runCommand(
  args: readonly string[],
  cwd: string,
  timeoutMs = COMMAND_TIMEOUT_MS,
): Promise<CommandResult> {
  const child = spawn(npmCommand, args, { cwd, env: process.env, stdio: 'pipe' });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });

  const result = await new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${npmCommand} ${args.join(' ')} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else {
        reject(
          new Error(
            `${npmCommand} ${args.join(' ')} exited code=${String(code)} signal=${String(signal)}\n${stdout}${stderr}`,
          ),
        );
      }
    });
  });
  return result;
}

async function randomLocalPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Failed to allocate a random local TCP port');
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  return address.port;
}

async function materializeTemplate(root: string): Promise<void> {
  const packageJson = buildProjectPackageJson(WEBPACK_DEV_SERVER_TEMPLATE).json;
  const files = new Map<string, string>([
    ['package.json', packageJson],
    [WEBPACK_DEV_SERVER_TEMPLATE.entry.relativePath, WEBPACK_DEV_SERVER_TEMPLATE.entry.content],
    ...Object.entries(WEBPACK_DEV_SERVER_TEMPLATE.extraFiles),
  ]);
  for (const [relativePath, content] of files) {
    const destination = join(root, relativePath.replace(/^\/+/, ''));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, content, 'utf8');
  }
}

function compilationCount(output: string): number {
  return output.match(/compiled successfully/g)?.length ?? 0;
}

async function waitForCompilation(
  child: ChildProcessWithoutNullStreams,
  readOutput: () => string,
  minimumCount: number,
): Promise<void> {
  const deadline = Date.now() + COMPILE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const output = readOutput();
    if (compilationCount(output) >= minimumCount) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`npm run dev exited before compilation ${minimumCount}\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Compilation ${minimumCount} timed out\n${readOutput()}`);
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store' });
  const body = await response.text();
  if (!response.ok) throw new Error(`GET ${url} returned ${response.status}\n${body}`);
  return body;
}

async function stopDevServer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => resolve());
    if (child.exitCode !== null || child.signalCode !== null) resolve();
  });
  const signal = (name: NodeJS.Signals): void => {
    try {
      if (process.platform === 'win32' || child.pid === undefined) child.kill(name);
      else process.kill(-child.pid, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    }
  };
  signal('SIGTERM');
  const stopped = await Promise.race([
    closed.then(() => true),
    new Promise<false>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);
  if (stopped) return;
  signal('SIGKILL');
  await closed;
}

function assertIncludes(actual: string, expected: string, subject: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${subject} did not include ${JSON.stringify(expected)}`);
  }
}

async function main(): Promise<void> {
  if (process.versions.node.split('.')[0] !== '24') {
    throw new Error(`Node 24 required, got ${process.version}`);
  }

  const root = await mkdtemp(join(tmpdir(), 'rifty-webpack-node24-oracle-'));
  let devServer: ChildProcessWithoutNullStreams | undefined;
  try {
    await materializeTemplate(root);
    const install = await runCommand(['install'], root);
    process.stdout.write(install.stdout);
    process.stderr.write(install.stderr);

    const dependencyTree = await runCommand(['ls', '--depth=0', '--json'], root);
    const exactDependencies = JSON.parse(dependencyTree.stdout) as {
      dependencies?: Record<string, { version?: string }>;
    };
    const packageNames = Object.keys(WEBPACK_DEV_SERVER_TEMPLATE.devDependencies ?? {});
    const versions = Object.fromEntries(
      packageNames.map((name) => [name, exactDependencies.dependencies?.[name]?.version ?? null]),
    );
    if (Object.values(versions).some((version) => version === null)) {
      throw new Error(`npm ls omitted a template dependency: ${JSON.stringify(versions)}`);
    }

    const port = await randomLocalPort();
    let devOutput = '';
    devServer = spawn(npmCommand, ['run', 'dev'], {
      cwd: root,
      detached: process.platform !== 'win32',
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
    devServer.stdout.setEncoding('utf8');
    devServer.stderr.setEncoding('utf8');
    devServer.stdout.on('data', (chunk: string) => {
      devOutput += chunk;
    });
    devServer.stderr.on('data', (chunk: string) => {
      devOutput += chunk;
    });

    await waitForCompilation(devServer, () => devOutput, 1);
    const baseUrl = `http://localhost:${port}`;
    const initialHtml = await fetchText(`${baseUrl}/`);
    const initialBundle = await fetchText(`${baseUrl}/main.js`);
    assertIncludes(initialHtml, '<div id="app"></div>', 'initial / response');
    assertIncludes(initialBundle, 'Create App style project', 'initial /main.js response');
    assertIncludes(initialBundle, '#101218', 'initial CSS bundle');

    const entryMarker = 'Node 24 oracle entry rebuild';
    const cssMarker = '--node-oracle-rebuild: 1';
    const changedEntry = WEBPACK_DEV_SERVER_TEMPLATE.entry.content.replace(
      'Create App style project',
      entryMarker,
    );
    const cssRelativePath = '/src/styles.css';
    const originalCss = WEBPACK_DEV_SERVER_TEMPLATE.extraFiles[cssRelativePath];
    if (originalCss === undefined) throw new Error(`Template omitted ${cssRelativePath}`);
    await Promise.all([
      writeFile(
        join(root, WEBPACK_DEV_SERVER_TEMPLATE.entry.relativePath.replace(/^\/+/, '')),
        changedEntry,
        'utf8',
      ),
      writeFile(
        join(root, cssRelativePath.replace(/^\/+/, '')),
        `${originalCss}\n:root { ${cssMarker}; }\n`,
        'utf8',
      ),
    ]);

    await waitForCompilation(devServer, () => devOutput, 2);
    const rebuiltBundle = await fetchText(`${baseUrl}/main.js?oracle=${Date.now()}`);
    assertIncludes(rebuiltBundle, entryMarker, 'rebuilt /main.js response');
    assertIncludes(rebuiltBundle, cssMarker, 'rebuilt CSS bundle');

    console.log(
      JSON.stringify(
        {
          result: 'PASS',
          node: process.versions.node,
          npm: (await runCommand(['--version'], root)).stdout.trim(),
          command: 'npm run dev',
          port,
          compilations: compilationCount(devOutput),
          versions,
        },
        null,
        2,
      ),
    );
    process.stdout.write(`\n--- npm run dev output ---\n${devOutput}`);
  } finally {
    if (devServer !== undefined) await stopDevServer(devServer);
    await rm(root, { recursive: true, force: true });
  }
}

if (process.env[OPT_IN_ENV] !== '1') {
  throw new Error(`Opt in with ${OPT_IN_ENV}=1`);
}

await main();
