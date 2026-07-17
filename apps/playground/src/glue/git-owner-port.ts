/**
 * Page ↔ owner git RPC bridge.
 *
 * The page snapshot deliberately excludes `.git`, so every GIT read/action must
 * call @riftydev/git in the owner realm. This bridge is playground-local glue:
 * request/reply frames are keyed by OwnerBridgeKey, correlated by request id,
 * Reads are bounded; admitted mutations retain their reply path until a
 * terminal owner outcome is known.
 */

import type {
  CheckoutInput,
  CheckoutResult,
  DiffEntry,
  DiffInput,
  GitIdentity,
  LogEntry,
  LogOptions,
  ResetInput,
  ShowObject,
  StatusEntry,
  makeGit,
} from '@riftydev/git';
import { EMPTY_COMMIT_MESSAGE_ERROR, commitRefusal } from '@riftydev/git';
import { NotImplementedError } from '@riftydev/io';
import { channelNameFor } from '@riftydev/net';
import { type VfsMutationIntent, normalizePath } from '@riftydev/vfs';
import { type OwnerBridgeKey, ownerBridgeChannelUrl } from './owner-bridge-key.ts';
import { createOwnerRequestSettlements } from './owner-request-settlements.ts';
import {
  type PackageMutationImpact,
  classifyVfsMutationIntentsPackageImpact,
} from './package-mutation-executor.ts';

type Git = ReturnType<typeof makeGit>;

export const GIT_OWNER_RPC_TYPE = 'rifty:git';

export type GitOwnerRequest =
  | { readonly id: string; readonly op: 'status' }
  | { readonly id: string; readonly op: 'diff'; readonly input?: DiffInput }
  | { readonly id: string; readonly op: 'show'; readonly rev: string }
  | { readonly id: string; readonly op: 'log'; readonly options?: LogOptions }
  | { readonly id: string; readonly op: 'currentBranch' }
  | { readonly id: string; readonly op: 'listBranches' }
  | { readonly id: string; readonly op: 'add'; readonly filepath: string }
  | { readonly id: string; readonly op: 'remove'; readonly filepath: string }
  | { readonly id: string; readonly op: 'unstage'; readonly filepath: string }
  | {
      readonly id: string;
      readonly op: 'commit';
      readonly message: string;
      readonly author: GitIdentity;
      readonly committer?: GitIdentity;
      readonly parents?: readonly string[];
      readonly amend?: boolean;
    }
  | {
      readonly id: string;
      readonly op: 'commitResolvedIdentity';
      readonly message: string;
      readonly amend?: boolean;
    }
  | {
      readonly id: string;
      readonly op: 'restore';
      readonly pathspecs: readonly string[];
      readonly source?: string;
    }
  | { readonly id: string; readonly op: 'reset'; readonly input: ResetInput };

export type GitOwnerResult =
  | readonly StatusEntry[]
  | readonly DiffEntry[]
  | ShowObject
  | readonly LogEntry[]
  | string
  | readonly string[]
  | CheckoutResult
  | undefined;

export interface GitOwnerRequestExecutor {
  execute(
    request: GitOwnerRequest,
    operation: () => Promise<GitOwnerResult>,
  ): Promise<GitOwnerResult>;
}

function pathspecMutationRoot(root: string, pathspec: string): string {
  const normalized = pathspec.replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '' || normalized === '.') return normalizePath(root);
  const wildcard = normalized.search(/[?*[]/);
  if (wildcard >= 0) {
    const prefix = normalized.slice(0, wildcard).replace(/\/$/, '');
    if (prefix === '') return normalizePath(root);
    return normalizePath(`${root}/${prefix}`);
  }
  return normalizePath(`${root}/${normalized}`);
}

/** Semantic mutation candidates for owner Git RPC; empty means read-only. */
export function gitOwnerMutationIntents(
  request: GitOwnerRequest,
  root: string,
): readonly VfsMutationIntent[] {
  const gitMetadata: VfsMutationIntent = {
    kind: 'write',
    path: normalizePath(`${root}/.git`),
  };
  switch (request.op) {
    case 'status':
    case 'diff':
    case 'show':
    case 'log':
    case 'currentBranch':
    case 'listBranches':
      return [];
    case 'restore':
      return [
        gitMetadata,
        ...request.pathspecs.map(
          (pathspec): VfsMutationIntent => ({
            kind: 'replace',
            path: pathspecMutationRoot(root, pathspec),
          }),
        ),
      ];
    case 'reset':
      return request.input.mode === 'hard'
        ? [gitMetadata, { kind: 'replace', path: normalizePath(root) }]
        : [gitMetadata];
    case 'add':
    case 'remove':
    case 'unstage':
    case 'commit':
    case 'commitResolvedIdentity':
      return [gitMetadata];
  }
}

export function classifyGitOwnerPackageImpact(
  request: GitOwnerRequest,
  root = '/workspace',
): PackageMutationImpact {
  return classifyVfsMutationIntentsPackageImpact(gitOwnerMutationIntents(request, root), root);
}

export function gitRequestMayEditPackageJson(request: GitOwnerRequest): boolean {
  return classifyGitOwnerPackageImpact(request) !== 'none';
}

export type GitOwnerRequestFrame = {
  readonly type: typeof GIT_OWNER_RPC_TYPE;
  readonly request: GitOwnerRequest;
};

export type GitOwnerResponse =
  | { readonly id: string; readonly ok: true; readonly result: GitOwnerResult }
  | {
      readonly id: string;
      readonly ok: false;
      readonly error: { readonly name: string; readonly message: string };
    };

export type GitOwnerResponseFrame = {
  readonly type: typeof GIT_OWNER_RPC_TYPE;
  readonly response: GitOwnerResponse;
};

type GitOwnerFrame = GitOwnerRequestFrame | GitOwnerResponseFrame;
type GitOwnerRequestPayload = GitOwnerRequest extends infer Request
  ? Request extends GitOwnerRequest
    ? Omit<Request, 'id'>
    : never
  : never;
type BlobShowObject = Extract<ShowObject, { readonly type: 'blob' }>;

export interface GitCommitInput {
  readonly message: string;
  readonly author: GitIdentity;
  readonly committer?: GitIdentity;
  readonly parents?: readonly string[];
  readonly amend?: boolean;
}

export interface GitResolvedCommitInput {
  readonly message: string;
  readonly amend?: boolean;
}

export interface GitOwnerClient {
  status(): Promise<readonly StatusEntry[]>;
  diff(input?: DiffInput): Promise<readonly DiffEntry[]>;
  show(rev: string): Promise<ShowObject>;
  log(options?: LogOptions): Promise<readonly LogEntry[]>;
  currentBranch(): Promise<string | undefined>;
  listBranches(): Promise<readonly string[]>;
  add(filepath: string): Promise<void>;
  remove(filepath: string): Promise<void>;
  unstage(filepath: string): Promise<void>;
  commit(input: GitCommitInput): Promise<string>;
  commitResolvedIdentity(input: GitResolvedCommitInput): Promise<string>;
  restore(pathspecs: readonly string[], source?: string): Promise<CheckoutResult>;
  reset(input: ResetInput): Promise<void>;
  dispose(): void;
}

let counter = 0;
function nextRequestId(): string {
  return `git${++counter}-${Math.random().toString(36).slice(2, 8)}`;
}

function gitOwnerChannelUrl(key: OwnerBridgeKey): string {
  return ownerBridgeChannelUrl('git-owner-rpc', key);
}

function errorToWire(err: unknown): { readonly name: string; readonly message: string } {
  if (err instanceof Error) return { name: err.name, message: err.message };
  return { name: 'Error', message: String(err) };
}

function errorFromWire(error: { readonly name: string; readonly message: string }): Error {
  const err = new Error(error.message);
  err.name = error.name;
  return err;
}

function isResponseFrame(frame: GitOwnerFrame): frame is GitOwnerResponseFrame {
  return 'response' in frame;
}

function cloneShowObject(object: ShowObject): ShowObject {
  if (object.type !== 'blob') return object;
  const content = new Uint8Array(object.content.byteLength);
  content.set(object.content);
  return { ...object, content };
}

function isBlobShowObject(result: GitOwnerResult): result is BlobShowObject {
  return (
    !!result &&
    typeof result === 'object' &&
    !Array.isArray(result) &&
    'type' in result &&
    result.type === 'blob'
  );
}

const DEFAULT_AUTHOR_NAME = 'rifty';
const DEFAULT_AUTHOR_EMAIL = 'rifty@localhost';

function ownerEnv(): Record<string, string> {
  if (typeof globalThis.process?.env !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(globalThis.process.env)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

async function identityFrom(git: Git, env: Record<string, string>): Promise<GitIdentity> {
  const name = env.GIT_AUTHOR_NAME ?? (await git.getConfig('user.name')) ?? DEFAULT_AUTHOR_NAME;
  const email = env.GIT_AUTHOR_EMAIL ?? (await git.getConfig('user.email')) ?? DEFAULT_AUTHOR_EMAIL;
  const date = env.GIT_AUTHOR_DATE;
  const timestamp =
    date !== undefined && /^\d+$/.test(date) ? Number(date) : Math.floor(Date.now() / 1000);
  return { name, email, timestamp, timezoneOffset: 0 };
}

/** Shared owner-realm identity resolution for semantic SCM and the legacy RPC adapter. */
export function resolveOwnerGitCommitIdentity(
  git: Git,
  env: Record<string, string> = ownerEnv(),
): Promise<GitIdentity> {
  return identityFrom(git, env);
}

function committerFrom(env: Record<string, string>, author: GitIdentity): GitIdentity {
  const name = env.GIT_COMMITTER_NAME ?? author.name;
  const email = env.GIT_COMMITTER_EMAIL ?? author.email;
  const date = env.GIT_COMMITTER_DATE;
  const timestamp = date !== undefined && /^\d+$/.test(date) ? Number(date) : author.timestamp;
  return { name, email, timestamp, timezoneOffset: 0 };
}

async function dispatchGitOwnerRequest(
  git: Git,
  request: GitOwnerRequest,
): Promise<GitOwnerResult> {
  switch (request.op) {
    case 'status':
      return git.status();
    case 'diff':
      return git.diff(request.input);
    case 'show':
      return cloneShowObject(await git.show(request.rev));
    case 'log':
      return git.log(request.options);
    case 'currentBranch':
      return git.currentBranch();
    case 'listBranches':
      return git.listBranches();
    case 'add':
      await git.add(request.filepath);
      return undefined;
    case 'remove':
      await git.remove(request.filepath);
      return undefined;
    case 'unstage':
      await git.unstage(request.filepath);
      return undefined;
    case 'commit':
      return git.commit({
        message: request.message,
        author: request.author,
        ...(request.committer ? { committer: request.committer } : {}),
        ...(request.parents ? { parents: [...request.parents] } : {}),
        ...(request.amend !== undefined ? { amend: request.amend } : {}),
      });
    case 'commitResolvedIdentity': {
      if (request.message === '') throw new Error(EMPTY_COMMIT_MESSAGE_ERROR);
      if (!request.amend) {
        const refusal = await commitRefusal(git);
        if (refusal !== null) throw new Error(refusal);
      }
      const env = ownerEnv();
      const author = await resolveOwnerGitCommitIdentity(git, env);
      return git.commit({
        message: request.message,
        author,
        committer: committerFrom(env, author),
        ...(request.amend !== undefined ? { amend: request.amend } : {}),
      });
    }
    case 'restore': {
      const input: CheckoutInput = {
        op: 'restore',
        pathspecs: [...request.pathspecs],
        ...(request.source !== undefined ? { source: request.source } : {}),
      };
      return git.checkout(input);
    }
    case 'reset':
      await git.reset(request.input);
      return undefined;
    default: {
      const op = (request as { readonly op?: unknown }).op;
      throw new NotImplementedError(`git.rpc.${String(op)}`, 'unsupported git owner RPC verb');
    }
  }
}

/**
 * Owner side. Serves git RPC requests against the live owner `makeGit` facade.
 * Returns an idempotent teardown.
 */
export function serveGitOwnerRpc(
  key: OwnerBridgeKey,
  git: Git,
  executor?: GitOwnerRequestExecutor,
): () => void {
  const channel = new BroadcastChannel(channelNameFor(gitOwnerChannelUrl(key)));

  const onMessage = (event: MessageEvent): void => {
    const frame = event.data as GitOwnerFrame;
    if (isResponseFrame(frame)) return;
    void (async (): Promise<void> => {
      try {
        const operation = (): Promise<GitOwnerResult> =>
          dispatchGitOwnerRequest(git, frame.request);
        channel.postMessage({
          type: GIT_OWNER_RPC_TYPE,
          response: {
            id: frame.request.id,
            ok: true,
            result: executor ? await executor.execute(frame.request, operation) : await operation(),
          },
        } satisfies GitOwnerResponseFrame);
      } catch (err) {
        channel.postMessage({
          type: GIT_OWNER_RPC_TYPE,
          response: { id: frame.request.id, ok: false, error: errorToWire(err) },
        } satisfies GitOwnerResponseFrame);
      }
    })();
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  let torn = false;
  return (): void => {
    if (torn) return;
    torn = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
}

/** Page side. Correlates replies without timing out admitted Git mutations. */
export function bridgeGitOwnerRpc(
  key: OwnerBridgeKey,
  opts: { readonly timeoutMs?: number; readonly ownerClosed?: Promise<unknown> } = {},
): GitOwnerClient {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const channel = new BroadcastChannel(channelNameFor(gitOwnerChannelUrl(key)));
  let onMessage: (event: MessageEvent) => void = () => {};
  let closed = false;
  const closeChannel = (): void => {
    if (closed) return;
    closed = true;
    channel.removeEventListener('message', onMessage as unknown as EventListener);
    channel.close();
  };
  const settlements = createOwnerRequestSettlements<GitOwnerResult>({
    readTimeout: {
      ms: timeoutMs,
      error: (id) => new Error(`git owner RPC request ${id} timeout after ${timeoutMs}ms`),
    },
    ownerClosed: opts.ownerClosed,
    ownerClosedError: () => new Error('workspace owner exited during Git request'),
    onDrained: closeChannel,
  });

  onMessage = (event: MessageEvent): void => {
    const frame = event.data as GitOwnerFrame;
    if (!isResponseFrame(frame)) return;
    if (!frame.response.ok) {
      settlements.reject(frame.response.id, errorFromWire(frame.response.error));
      return;
    }
    settlements.resolve(frame.response.id, cloneResult(frame.response.result));
  };

  channel.addEventListener('message', onMessage as unknown as EventListener);

  function request(frame: GitOwnerRequestPayload): Promise<GitOwnerResult> {
    const id = nextRequestId();
    const request = { ...frame, id } as GitOwnerRequest;
    return settlements.request(
      id,
      gitOwnerMutationIntents(request, '/').length === 0 ? 'read' : 'mutation',
      () =>
        channel.postMessage({
          type: GIT_OWNER_RPC_TYPE,
          request,
        } satisfies GitOwnerRequestFrame),
    );
  }

  return {
    status() {
      return request({ op: 'status' }) as Promise<readonly StatusEntry[]>;
    },
    diff(input) {
      return request(input === undefined ? { op: 'diff' } : { op: 'diff', input }) as Promise<
        readonly DiffEntry[]
      >;
    },
    show(rev) {
      return request({ op: 'show', rev }) as Promise<ShowObject>;
    },
    log(options) {
      return request(options === undefined ? { op: 'log' } : { op: 'log', options }) as Promise<
        readonly LogEntry[]
      >;
    },
    currentBranch() {
      return request({ op: 'currentBranch' }) as Promise<string | undefined>;
    },
    listBranches() {
      return request({ op: 'listBranches' }) as Promise<readonly string[]>;
    },
    async add(filepath) {
      await request({ op: 'add', filepath });
    },
    async remove(filepath) {
      await request({ op: 'remove', filepath });
    },
    async unstage(filepath) {
      await request({ op: 'unstage', filepath });
    },
    commit(input) {
      return request({
        op: 'commit',
        message: input.message,
        author: input.author,
        ...(input.committer ? { committer: input.committer } : {}),
        ...(input.parents ? { parents: [...input.parents] } : {}),
        ...(input.amend !== undefined ? { amend: input.amend } : {}),
      }) as Promise<string>;
    },
    commitResolvedIdentity(input) {
      return request({
        op: 'commitResolvedIdentity',
        message: input.message,
        ...(input.amend !== undefined ? { amend: input.amend } : {}),
      }) as Promise<string>;
    },
    restore(pathspecs, source) {
      return request({
        op: 'restore',
        pathspecs: [...pathspecs],
        ...(source !== undefined ? { source } : {}),
      }) as Promise<CheckoutResult>;
    },
    async reset(input) {
      await request({ op: 'reset', input });
    },
    dispose() {
      settlements.dispose(new Error('git owner RPC bridge disposed'));
    },
  };
}

function cloneResult(result: GitOwnerResult): GitOwnerResult {
  return isBlobShowObject(result) ? cloneShowObject(result) : result;
}
