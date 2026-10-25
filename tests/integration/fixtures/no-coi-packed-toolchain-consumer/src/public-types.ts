import type {
  RuntimeEffects,
  RuntimeFs,
  RuntimeFsDirent,
  RuntimeFsStat,
  SandboxCommandOptions,
  SandboxCommandOutcome,
  SandboxCommandOutput,
  SandboxCommandRun,
  SandboxPreviewTarget,
  SandboxProject,
  SandboxProjectOptions,
  SandboxResidentBin,
  SandboxRestartOptions,
  SandboxRestartReport,
  SandboxStartBinInput,
  SandboxToolchain,
  ToolchainSandbox,
} from '@riftydev/sdk';

// @ts-expect-error raw toolchain type stays off the runtime root
type RootRuntimeToolchain = import('@riftydev/runtime-js').RuntimeToolchain;
// @ts-expect-error raw toolchain protocol stays off the runtime root
type RootToolchainProtocol = import('@riftydev/runtime-js').ToolchainRequest;
// @ts-expect-error bounded gap projection stays off the packed runtime root
type RootDeclaredGapCause = typeof import('@riftydev/runtime-js')['declaredGapCause'];

declare const toolchain: SandboxToolchain;
declare const sandbox: ToolchainSandbox;

const projectOptions: SandboxProjectOptions = {
  root: '/project',
  readonlyPaths: ['locked'],
  allowedCommands: ['node', 'npm'],
};
const project: SandboxProject = sandbox.project(projectOptions);
const files: RuntimeFs = project.fs;
const entries: Promise<readonly RuntimeFsDirent[]> = files.readdir('.');
const metadata: Promise<RuntimeFsStat> = files.stat('package.json');
const write: Promise<void> = files.writeFile('src/main.js', 'console.log(42)');
const mutations: Promise<RuntimeEffects>[] = [
  files.mkdir('src', { recursive: true }),
  files.rename('a', 'b'),
  files.rm('b', { force: true, recursive: true }),
  files.flush(),
];
const commandOptions: SandboxCommandOptions = { cwd: 'src', env: { MODE: 'test' } };
const invocation: SandboxCommandRun = project.run('node main.js', commandOptions);
const completion: Promise<SandboxCommandOutcome> = invocation.completion;
const stop: Promise<SandboxCommandOutcome> = invocation.stop();
const unsubscribe: () => void = invocation.onOutput((output: SandboxCommandOutput) => {
  const stream: 'stdout' | 'stderr' = output.stream;
  const chunk: string = output.chunk;
  void [stream, chunk];
});
void [entries, metadata, write, mutations, completion, stop, unsubscribe];
// @ts-expect-error root is required
sandbox.project({});
// @ts-expect-error policy is a string array
sandbox.project({ root: '/project', readonlyPaths: 'locked' });
// @ts-expect-error command is a string
project.run(['node', 'main.js']);
// @ts-expect-error command cwd is a string
project.run('node main.js', { cwd: 1 });
// @ts-expect-error environment values are strings
project.run('node main.js', { env: { MODE: 1 } });
// @ts-expect-error no persistent shell or background option
project.run('node main.js', { background: true });
// @ts-expect-error writeFile preserves its Promise<void> result
const writeReceipt: Promise<RuntimeEffects> = files.writeFile('a', 'b');
void writeReceipt;

void toolchain.install({ cwd: '/project', registryUrl: 'https://registry.invalid' });
void toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: ['--version'],
});
const startInput: SandboxStartBinInput = {
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: ['--port', '5174'],
  port: 5174,
};
const resident: Promise<SandboxResidentBin> = toolchain.startBin(startInput);
void resident;
// @ts-expect-error port is required
void toolchain.startBin({ cwd: '/project', binPath: startInput.binPath, args: [] });
void toolchain.startBin({
  ...startInput,
  // @ts-expect-error port is numeric
  port: '5174',
});

const preview: SandboxPreviewTarget = { src: '' };
const restartOptions: SandboxRestartOptions = { preview };
const restart: Promise<SandboxRestartReport> = sandbox.restart(restartOptions);
void restart;
const restartFields: Promise<readonly [boolean, SandboxResidentBin | null]> = restart.then(
  (report) => [report.unflushedWrites, report.resident] as const,
);
void restartFields;
// @ts-expect-error preview is required
void sandbox.restart({});

// @ts-expect-error registryUrl is required
void toolchain.install({ cwd: '/project' });
// @ts-expect-error install rejects extra fields
void toolchain.install({ cwd: '/project', registryUrl: 'https://registry.invalid', retry: true });
// @ts-expect-error cwd is a string
void toolchain.install({ cwd: 1, registryUrl: 'https://registry.invalid' });
// @ts-expect-error registryUrl is a string
void toolchain.install({ cwd: '/project', registryUrl: 1 });

// @ts-expect-error binPath is required
void toolchain.runBin({ cwd: '/project', args: [] });
void toolchain.runBin({
  cwd: '/project',
  binPath: '/project/node_modules/.bin/arbitrary-tool',
  args: [],
  // @ts-expect-error runBin rejects the exact extra queue field
  queue: true,
});
// @ts-expect-error args is a readonly string array
void toolchain.runBin({ cwd: '/project', binPath: '/project/node_modules/.bin/tool', args: 'x' });
// @ts-expect-error runBin cwd is a string
void toolchain.runBin({ cwd: 1, binPath: '/project/node_modules/.bin/tool', args: [] });
// @ts-expect-error binPath is a string
void toolchain.runBin({ cwd: '/project', binPath: 1, args: [] });

type InstallResult = Awaited<ReturnType<SandboxToolchain['install']>>;
const installResult: InstallResult = undefined;
void installResult;
// @ts-expect-error install resolves void, never a result object
const wrongInstallResult: InstallResult = { installed: true };
void wrongInstallResult;

type RunResult = Awaited<ReturnType<SandboxToolchain['runBin']>>;
const result: RunResult = { exitCode: 0 };
void result;
// @ts-expect-error exitCode is numeric
const wrongResult: RunResult = { exitCode: '0' };
void wrongResult;

// @ts-expect-error runBin is required
const missingRunBin: SandboxToolchain = { install: async () => {} };
void missingRunBin;
// @ts-expect-error install is required
const missingInstall: SandboxToolchain = { runBin: async () => ({ exitCode: 0 }) };
void missingInstall;
const extraMethod: SandboxToolchain = {
  install: async () => {},
  runBin: async () => ({ exitCode: 0 }),
  startBin: async () => ({ port: 5174, previewUrl: '/preview/5174/' }),
  // @ts-expect-error SandboxToolchain rejects the exact extra reconnect method
  reconnect: async () => {},
};
void extraMethod;

void (null as RootRuntimeToolchain | RootToolchainProtocol | RootDeclaredGapCause | null);
