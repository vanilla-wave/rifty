import { ProjectFileOperationError } from '@riftydev/workbench';
import type { ProjectFileEntry, ProjectFiles, ProjectTerminalRun } from '@riftydev/workbench';
import type {
  AgentCommandResult,
  AgentFiles,
  AgentHost,
  WorkbenchAgentHostOptions,
} from './types.ts';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function text(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new Error('Binary file is not supported by text tools');
  return decoder.decode(bytes);
}

async function entryAt(files: ProjectFiles, path: string): Promise<ProjectFileEntry | undefined> {
  const parts = path.split('/').filter(Boolean);
  let directory = '/';
  let entry: ProjectFileEntry | undefined;
  for (const [index, name] of parts.entries()) {
    const selected = `${directory === '/' ? '' : directory}/${name}`;
    entry = (await files.readdir(directory)).find((candidate) => candidate.path === selected);
    if (!entry) return undefined;
    if (index < parts.length - 1 && entry.kind !== 'dir')
      throw new Error(`Not a directory: ${selected}`);
    directory = selected;
  }
  return entry;
}

async function ensureParents(files: ProjectFiles, path: string): Promise<void> {
  let directory = '/';
  for (const name of path.split('/').filter(Boolean).slice(0, -1)) {
    const selected = `${directory === '/' ? '' : directory}/${name}`;
    const entry = (await files.readdir(directory)).find((candidate) => candidate.path === selected);
    if (!entry) await files.mkdir(selected, { expectedVersion: null });
    else if (entry.kind !== 'dir') throw new Error(`Not a directory: ${selected}`);
    directory = selected;
  }
}

export function createWorkbenchAgentHost(options: WorkbenchAgentHostOptions): AgentHost {
  const { session, companion } = options;
  const terminal = options.terminal ?? session.terminals.open();
  const files: AgentFiles = {
    async read(path) {
      return text((await session.files.readFile(path)).bytes);
    },
    list: (path) => session.files.readdir(path),
    async change(path, transform) {
      const entry = await entryAt(session.files, path);
      if (entry && entry.kind !== 'file') throw new Error(`Not a file: ${path}`);
      const prior = entry ? await session.files.readFile(path) : null;
      const next = transform(prior ? text(prior.bytes) : null);
      if (next === null) {
        if (!prior) throw new Error(`File does not exist: ${path}`);
        await session.files.remove(path, { expectedVersion: prior.version });
      } else {
        await ensureParents(session.files, path);
        await session.files.writeFile(path, encoder.encode(next), {
          expectedVersion: prior?.version ?? null,
        });
      }
    },
  };

  const shell = async (
    command: string,
    signal: AbortSignal | undefined,
    onOutput: (chunk: string, stream: 'stdout' | 'stderr') => void,
  ): Promise<AgentCommandResult> => {
    signal?.throwIfAborted();
    let stdout = '';
    let stderr = '';
    const detach = terminal.attach((chunk, stream) => {
      if (stream === 'stdout') stdout += chunk;
      else stderr += chunk;
      onOutput(chunk, stream);
    });
    let run: ProjectTerminalRun;
    try {
      run = terminal.run(command);
    } catch (error) {
      detach();
      throw error;
    }
    let stopping: Promise<unknown> | undefined;
    const stop = () => {
      stopping ??= run.stop();
      void stopping.catch(() => {});
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    try {
      const [exitCode] = await Promise.all([run.exitCode, run.exited]);
      await stopping;
      return { status: signal?.aborted ? 'cancelled' : 'exited', exitCode, stdout, stderr };
    } finally {
      signal?.removeEventListener('abort', stop);
      try {
        await run.close();
      } finally {
        detach();
      }
    }
  };

  return {
    root: '/',
    capabilities() {
      const preview = options.preview?.();
      return {
        files,
        shell,
        ...(preview ? { preview } : {}),
        ...(companion
          ? {
              diagnostics: async (path: string) => {
                await companion.typescript.open(path, await files.read(path));
                return [
                  ...(await companion.typescript.getSyntacticDiagnostics(path)),
                  ...(await companion.typescript.getSemanticDiagnostics(path)),
                ];
              },
              diff: async () => {
                const state = await companion.scm.refresh();
                return Promise.all(
                  state.changes.map(async (change) => {
                    const diff = await companion.scm.diff(change);
                    return {
                      path: change.path,
                      original: text(diff.original.bytes),
                      modified: text(diff.modified.bytes),
                    };
                  }),
                );
              },
            }
          : {}),
        notes: [
          'Workbench shell cwd/environment persist between commands; files use project-rooted paths and versioned writes.',
        ],
      };
    },
    async close() {
      if (!options.terminal) await terminal.close();
    },
  };
}

export function hostError(error: unknown): Record<string, unknown> {
  const inspected = error instanceof Error ? error : new Error(String(error));
  const fields = inspected as Error & { code?: unknown; path?: unknown };
  return {
    name: inspected.name,
    message: inspected.message,
    ...(typeof fields.code === 'string' ? { code: fields.code } : {}),
    ...(typeof fields.path === 'string' ? { path: fields.path } : {}),
    ...(error instanceof ProjectFileOperationError
      ? { mutationOutcome: error.mutationOutcome }
      : {}),
    ...('effects' in inspected ? { effects: inspected.effects } : {}),
  };
}
