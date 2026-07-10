import { getKernelDispatcher } from '@riftydev/kernel';
import { installRuntimeJsFsHandlers } from '@riftydev/runtime-js';
import { fork, spawn } from '@riftydev/runtime-js/builtins/child_process';
import { createMemoryFs, setSyncMirror } from '@riftydev/vfs/internal';

interface ChildProbeResult {
  readonly spawnCode: number | null;
  readonly spawnTarget: string;
  readonly spawnStderr: string;
  readonly spawnStdioShape: string;
  readonly spawnIpcShape: string;
  readonly stdinCode: number | null;
  readonly stdinOutput: string;
  readonly stdinStderr: string;
  readonly forkCode: number | null;
  readonly forkReply: unknown;
  readonly forkStdioShape: string;
  readonly forkIpcShape: string;
}

function chunkText(chunk: unknown): string {
  return typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk as Uint8Array);
}

function stdioShape(child: ReturnType<typeof spawn>): string {
  return [child.stdin, child.stdout, child.stderr]
    .map((stream) => (stream === null ? 'null' : 'pipe'))
    .join(',');
}

function ipcShape(child: ReturnType<typeof spawn>): string {
  const candidate = child as ReturnType<typeof spawn> & {
    readonly connected?: unknown;
    readonly channel?: unknown;
    readonly send?: unknown;
    readonly disconnect?: unknown;
  };
  return [
    typeof candidate.send,
    typeof candidate.disconnect,
    String(candidate.connected),
    typeof candidate.channel,
  ].join(',');
}

function waitForClose(child: ReturnType<typeof spawn>, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child close timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code as number | null);
    });
  });
}

/** Real Chromium Worker probe used only by the browser-unit harness. */
export async function runRemoteFsChildProcessProbe(): Promise<ChildProbeResult> {
  const { vfs, fsSync } = createMemoryFs();
  setSyncMirror(fsSync, { async: vfs });
  installRuntimeJsFsHandlers(getKernelDispatcher(), () => fsSync);

  const enc = new TextEncoder();
  fsSync.mkdirSync('/project', { recursive: true });
  fsSync.writeFileSync('/project/data.txt', enc.encode('parent-vfs-bytes'));
  fsSync.writeFileSync(
    '/project/child.mjs',
    enc.encode(
      `import fs from 'node:fs';\nprocess.stdout.write('DATA=' + fs.readFileSync('/project/data.txt', 'utf8') + ';ENV=' + process.env.PROBE_FLAG + ';CWD=' + process.cwd() + '\\n');\n`,
    ),
  );

  let spawnTarget = '';
  let spawnStderr = '';
  const spawned = spawn('node', ['/project/child.mjs'], {
    cwd: '/project',
    env: { PROBE_FLAG: 'worker-env' },
    stdio: [
      'pipe',
      {
        write(chunk: unknown): void {
          spawnTarget += chunkText(chunk);
        },
      },
      {
        write(chunk: unknown): void {
          spawnStderr += chunkText(chunk);
        },
      },
    ],
  });
  const spawnStdioShape = stdioShape(spawned);
  const spawnIpcShape = ipcShape(spawned);
  const spawnCode = await waitForClose(spawned);

  fsSync.writeFileSync(
    '/project/stdin.mjs',
    enc.encode(
      `process.stdin.setEncoding('utf8');\nlet input = '';\nprocess.stdin.on('data', (chunk) => { input += chunk; });\nprocess.stdin.on('end', () => process.stdout.write('STDIN=' + input + ';SEND=' + typeof process.send + ';DISCONNECT=' + typeof process.disconnect + ';CONNECTED=' + String(process.connected) + ';CHANNEL=' + typeof process.channel + '\\n'));\n`,
    ),
  );
  let stdinOutput = '';
  let stdinStderr = '';
  const stdinChild = spawn('node', ['/project/stdin.mjs'], { cwd: '/project' });
  stdinChild.stdout?.on('data', (chunk) => {
    stdinOutput += chunkText(chunk);
  });
  stdinChild.stderr?.on('data', (chunk) => {
    stdinStderr += chunkText(chunk);
  });
  stdinChild.stdin?.write('hello');
  stdinChild.stdin?.end();
  const stdinCode = await waitForClose(stdinChild);

  fsSync.writeFileSync(
    '/project/ipc.mjs',
    enc.encode(
      `process.on('message', (message) => process.send({ echo: message, data: 'ipc-ok' }));\nawait new Promise((resolve) => setTimeout(resolve, 250));\n`,
    ),
  );
  const forked = fork('/project/ipc.mjs', [], { cwd: '/project' });
  const forkStdioShape = stdioShape(forked);
  const forkIpcShape = ipcShape(forked);
  const forkReply = await new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('fork IPC reply timed out')), 10_000);
    forked.on('message', (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    setTimeout(() => forked.send({ from: 'parent' }), 25);
  });
  const forkCode = await waitForClose(forked);

  return {
    spawnCode,
    spawnTarget,
    spawnStderr,
    spawnStdioShape,
    spawnIpcShape,
    stdinCode,
    stdinOutput,
    stdinStderr,
    forkCode,
    forkReply,
    forkStdioShape,
    forkIpcShape,
  };
}
