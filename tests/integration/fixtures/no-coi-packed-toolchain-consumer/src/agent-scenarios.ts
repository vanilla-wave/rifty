// Shared source/packed consumer scenarios; only public SDK methods.
interface Receipt {
  applied: 'yes' | 'no' | 'unknown';
  persistence: 'flushed' | 'memory' | 'failed' | 'unknown';
}
interface Files {
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  writeFile(path: string, value: string): Promise<void>;
  readdir(path: string): Promise<readonly { name: string; isDirectory: boolean }[]>;
  stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size?: number }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<Receipt>;
  rename(sourcePath: string, targetPath: string): Promise<Receipt>;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<Receipt>;
  flush(): Promise<Receipt>;
}
interface Outcome {
  status: 'exited' | 'cancelled' | 'failed';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  effects: Receipt;
  worker: 'retained' | 'replaced' | 'terminated';
  error?: { name: string; message: string };
}
interface Run {
  completion: Promise<Outcome>;
  stop(): Promise<Outcome>;
  onOutput(listener: (event: { stream: 'stdout' | 'stderr'; chunk: string }) => void): () => void;
}
interface Project {
  fs: Files;
  run(command: string, options?: { cwd?: string; env?: Record<string, string> }): Run;
}
export interface AgentSandbox {
  fs: Files;
  project(options: {
    root: string;
    readonlyPaths?: readonly string[];
    allowedCommands?: readonly string[];
  }): Project;
  runtime: { eval(source: string): Promise<{ ok: boolean; value?: unknown }> };
}

async function errorOf(call: () => Promise<unknown>) {
  try {
    await call();
    return null;
  } catch (error) {
    const detail = error as Error & { code?: string; effects?: Receipt };
    return {
      name: detail.name,
      code: detail.code,
      message: detail.message,
      effects: detail.effects,
    };
  }
}

export async function agentFilesScenario(sandbox: AgentSandbox) {
  await sandbox.fs.writeFile('/agent/locked/keep.txt', 'keep');
  const project = sandbox.project({ root: '/agent', readonlyPaths: ['locked'] });
  const mkdir = await project.fs.mkdir('src/deep', { recursive: true });
  await project.fs.writeFile('src/deep/a.txt', 'hello');
  const stat = await project.fs.stat('src/deep/a.txt');
  const list = await project.fs.readdir('src/deep');
  const rename = await project.fs.rename('src/deep/a.txt', 'src/deep/b.txt');
  const content = await project.fs.readFile('src/deep/b.txt', 'utf8');
  const raw = await sandbox.fs.readFile('/agent/src/deep/b.txt', 'utf8');
  const denied = await errorOf(() => project.fs.writeFile('locked/keep.txt', 'changed'));
  const deniedMove = await errorOf(() => project.fs.rename('locked', 'moved'));
  const missing = await errorOf(() => project.fs.stat('absent'));
  const rm = await project.fs.rm('src', { recursive: true });
  const removed = await errorOf(() => project.fs.readFile('src/deep/b.txt', 'utf8'));
  const retained = await project.fs.readFile('locked/keep.txt', 'utf8');
  await sandbox.runtime.eval("process.chdir('/agent'); 42");
  await sandbox.fs.writeFile('raw-root.txt', 'root');
  const rawAnchored = await sandbox.fs.readFile('/raw-root.txt', 'utf8');
  return {
    mkdir,
    stat,
    list,
    rename,
    content,
    raw,
    denied,
    deniedMove,
    missing,
    rm,
    removed,
    retained,
    rawAnchored,
  };
}

export async function agentCommandsScenario(sandbox: AgentSandbox) {
  await sandbox.fs.writeFile('/commands/src/seed.txt', 'seed');
  await sandbox.fs.writeFile('/commands/locked/keep.txt', 'keep');
  await sandbox.fs.writeFile(
    '/commands/edit.cjs',
    "require('node:fs').writeFileSync('/commands/locked/keep.txt', 'bad')",
  );
  await sandbox.fs.writeFile(
    '/commands/out.cjs',
    "process.stdout.write('A'); process.stderr.write('B'); setTimeout(() => process.stdout.write('C'), 20)",
  );
  await sandbox.fs.writeFile(
    '/commands/package.json',
    '{"name":"agent","scripts":{"build":"echo built > build.txt"}}',
  );
  const project = sandbox.project({ root: '/commands', readonlyPaths: ['locked'] });
  const first = await project.run('cd src && pwd && echo saved > effect.txt', {
    env: { RUN_VALUE: 'first' },
  }).completion;
  const next = await project.run('pwd && echo "$RUN_VALUE"').completion;
  const failed = await project.run('cd src && missing-command').completion;
  const afterFailed = await project.run('pwd').completion;
  const events: string[] = [];
  const streamed = project.run('node out.cjs');
  streamed.onOutput(({ stream, chunk }) => events.push(`${stream}:${chunk}`));
  const output = await streamed.completion;
  events.push('complete');
  const guestDenied = await project.run('node edit.cjs').completion;
  const redirectDenied = await project.run('echo bad > locked/keep.txt').completion;
  const background = await project.run('echo escaped > background.txt &').completion;
  const backgroundFile = await errorOf(() => project.fs.readFile('background.txt', 'utf8'));
  const restricted = sandbox.project({ root: '/commands', allowedCommands: ['echo'] });
  const executionDenied = await restricted.run('echo before && touch forbidden.txt').completion;
  const forbidden = await errorOf(() => project.fs.readFile('forbidden.txt', 'utf8'));
  const npm = await project.run('npm run build').completion;
  const built = await project.fs.readFile('build.txt', 'utf8');
  const retained = await project.fs.readFile('locked/keep.txt', 'utf8');
  const effect = await project.fs.readFile('src/effect.txt', 'utf8');
  return {
    first,
    next,
    failed,
    afterFailed,
    output,
    events,
    guestDenied,
    redirectDenied,
    background,
    backgroundFile,
    executionDenied,
    forbidden,
    npm,
    built,
    retained,
    effect,
  };
}

export async function agentStopScenario(sandbox: AgentSandbox) {
  await sandbox.fs.writeFile('/stop/src/seed.txt', 'seed');
  await sandbox.fs.writeFile('/stop/spin.cjs', "console.log('entered'); while (true) {}");
  const project = sandbox.project({ root: '/stop' });
  const slow = project.run('cd src && echo applied > applied.txt && echo entered && sleep 20');
  let entered!: () => void;
  const entrance = new Promise<void>((resolve) => {
    entered = resolve;
  });
  slow.onOutput(({ chunk }) => {
    if (chunk.includes('entered')) entered();
  });
  await entrance;
  const overlap = await project.run('echo intruder').completion;
  const stopped = await slow.stop();
  const same = stopped === (await slow.completion);
  const effect = await project.fs.readFile('src/applied.txt', 'utf8');
  const next = await project.run('pwd && echo next').completion;
  await project.fs.writeFile(
    'old.cjs',
    "process.once('SIGINT', () => { process.stdout.write('OLD-OUTPUT'); require('node:fs').writeFileSync('/stop/old-effect', 'leaked'); })",
  );
  await project.fs.writeFile(
    'current.cjs',
    "const timer = setInterval(() => {}, 1000); process.once('SIGINT', () => { clearInterval(timer); console.log('current-stopped'); }); console.log('current-entered');",
  );
  const old = await project.run('node old.cjs').completion;
  const current = project.run('node current.cjs');
  await new Promise<void>((resolve) => {
    current.onOutput(({ chunk }) => {
      if (chunk.includes('current-entered')) resolve();
    });
  });
  const currentStopped = await current.stop();
  const oldEffect = await errorOf(() => project.fs.readFile('old-effect', 'utf8'));
  const hard = project.run('node spin.cjs');
  let spinning!: () => void;
  const entranceHard = new Promise<void>((resolve) => {
    spinning = resolve;
  });
  hard.onOutput(({ chunk }) => {
    if (chunk.includes('entered')) spinning();
  });
  await entranceHard;
  const terminated = await hard.stop();
  const afterHard = await project.run('echo after-hard').completion;
  return {
    overlap,
    stopped,
    same,
    effect,
    next,
    old,
    currentStopped,
    oldEffect,
    terminated,
    afterHard,
  };
}
