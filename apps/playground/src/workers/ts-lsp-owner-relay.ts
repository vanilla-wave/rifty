import { isTsRequestMessage, isTsResponseMessage } from '@riftydev/ts-language-service/protocol';
import { normalizePath } from '@riftydev/vfs';
import type { ProjectSpec } from '@riftydev/workbench';
import { stampTsLspOwner, tsLspOwnerMatches } from '../glue/ts-lsp-owner-scope.ts';

const TYPESCRIPT_ENTRY_RELATIVE_PATH = 'node_modules/typescript/lib/typescript.js';
const TYPESCRIPT_READY_TIMEOUT_MS = 60_000;
const TYPESCRIPT_READY_POLL_MS = 50;

interface ChildStream {
  on(event: 'data', listener: (chunk: unknown) => void): unknown;
}

interface TsLspChild {
  readonly kind: string;
  send(message: unknown): unknown;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code?: unknown) => void): unknown;
  stdout(): ChildStream;
  stderr(): ChildStream;
}

interface TsLspSpawnSpec {
  readonly entry: { readonly kind: 'url'; readonly url: string };
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly serve: true;
}

interface TsLspOwnerRelayOptions {
  readonly workerUrl: string;
  readonly root: string;
  readonly ownerBridgeKey: string | number;
  readonly initialTemplateId: string;
  readonly resolveProjectSpec: (id: string) => ProjectSpec;
  readonly waitForActiveProjectReady: () => Promise<void>;
  readonly existsSync: (path: string) => boolean;
  readonly spawnWorker: (name: string, spec: TsLspSpawnSpec, ppid: number) => TsLspChild;
  readonly onOwnerMessage: (listener: (message: unknown) => void) => undefined | (() => void);
  readonly sendOwnerMessage: (message: unknown) => void;
  readonly log: (line: string) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly pollMs?: number;
}

export interface TsLspOwnerRelay {
  dispose(): void;
}

function isDevConfigMessage(message: unknown): message is {
  readonly frame: { readonly type: 'pty:dev-config'; readonly templateId: string };
} {
  if (!message || typeof message !== 'object') return false;
  const envelope = message as { readonly type?: unknown; readonly frame?: unknown };
  if (envelope.type !== 'rifty:pty' || !envelope.frame || typeof envelope.frame !== 'object') {
    return false;
  }
  const frame = envelope.frame as { readonly type?: unknown; readonly templateId?: unknown };
  return frame.type === 'pty:dev-config' && typeof frame.templateId === 'string';
}

function requestsWorkspaceTypeScript(spec: ProjectSpec): boolean {
  return spec.install.typescript !== undefined || spec.devDependencies?.typescript !== undefined;
}

function decodeChunk(chunk: unknown): string {
  const decoder = new TextDecoder();
  if (chunk instanceof Uint8Array) return decoder.decode(chunk);
  if (chunk instanceof ArrayBuffer) return decoder.decode(new Uint8Array(chunk));
  if (ArrayBuffer.isView(chunk)) {
    return decoder.decode(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }
  return typeof chunk === 'string' ? chunk : '';
}

export function createTsLspOwnerRelay(options: TsLspOwnerRelayOptions): TsLspOwnerRelay {
  const now = options.now ?? (() => performance.now());
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? TYPESCRIPT_READY_TIMEOUT_MS;
  const pollMs = options.pollMs ?? TYPESCRIPT_READY_POLL_MS;
  let activeTemplateId = options.initialTemplateId;
  let child: TsLspChild | null = null;
  let disposed = false;

  async function waitForDependencies(): Promise<void> {
    await options.waitForActiveProjectReady();
    const spec = options.resolveProjectSpec(activeTemplateId);
    if (!requestsWorkspaceTypeScript(spec)) return;
    const path = normalizePath(`${options.root}/${TYPESCRIPT_ENTRY_RELATIVE_PATH}`);
    const started = now();
    while (!options.existsSync(path)) {
      if (now() - started >= timeoutMs) {
        throw new Error(`workspace TypeScript not ready at ${path}`);
      }
      await sleep(pollMs);
    }
  }

  function spawnChild(): TsLspChild {
    const spawned = options.spawnWorker(
      'ts-lsp',
      {
        entry: { kind: 'url', url: options.workerUrl },
        argv: ['rifty', 'ts-lsp'],
        env: { RIFTY_REMOTE_FS: '1', RIFTY_RFV_ROOT: options.root },
        cwd: options.root,
        serve: true,
      },
      1,
    );
    if (spawned.kind !== 'worker') {
      throw new Error(`ts-lsp child: expected worker handle, got ${spawned.kind}`);
    }
    spawned.on('message', (response) => {
      if (!disposed && isTsResponseMessage(response)) {
        options.sendOwnerMessage(stampTsLspOwner(response, options.ownerBridgeKey));
      }
    });
    spawned.on('exit', (code) => {
      options.log(`[shell-owner/worker] ts-lsp child exited (code ${String(code)})\n`);
      if (child === spawned) child = null;
    });
    spawned.stdout().on('data', (chunk) => options.log(decodeChunk(chunk)));
    spawned.stderr().on('data', (chunk) => options.log(decodeChunk(chunk)));
    return spawned;
  }

  function relay(message: unknown): void {
    if (child === null) child = spawnChild();
    child.send(message);
  }

  const unsubscribe = options.onOwnerMessage((message) => {
    if (isDevConfigMessage(message)) {
      activeTemplateId = message.frame.templateId;
      return;
    }
    if (!isTsRequestMessage(message) || !tsLspOwnerMatches(message, options.ownerBridgeKey)) return;
    void waitForDependencies()
      .then(() => {
        if (!disposed) relay(message);
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        const error = reason instanceof Error ? reason : new Error(String(reason));
        options.sendOwnerMessage(
          stampTsLspOwner(
            {
              type: 'rifty:ts-lsp',
              response: {
                id: message.request.id,
                ok: false,
                kind: 'error',
                error: { name: error.name, message: error.message },
              },
            },
            options.ownerBridgeKey,
          ),
        );
      });
  });

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (typeof unsubscribe === 'function') unsubscribe();
      child = null;
    },
  };
}
