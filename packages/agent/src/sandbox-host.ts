import type { AgentCapabilities, AgentFiles, AgentHost, SandboxAgentHostOptions } from './types.ts';

const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function policyRecord(
  value: unknown,
  fields: readonly string[],
  label: string,
): Record<string, unknown> | undefined {
  if (value === undefined) return undefined;
  if (
    value === null ||
    typeof value !== 'object' ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw new TypeError(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !fields.includes(key))
      throw new TypeError(`${label} has unsupported field ${String(key)}`);
    if (!('value' in descriptors[key]!)) throw new TypeError(`${label} has accessor fields`);
  }
  return value as Record<string, unknown>;
}

export function createSandboxAgentHost(options: SandboxAgentHostOptions): AgentHost {
  const policies = policyRecord(options.policies, ['files', 'shell'], 'capability policies');
  const effective = (capability: 'files' | 'shell') => {
    const override = policyRecord(
      policies?.[capability],
      ['readonlyPaths', 'allowedCommands'],
      `${capability} policy`,
    );
    if (override === undefined) return options.project;
    // Preserve SDK validation of the original object's prototype/accessors.
    return Object.create(Object.getPrototypeOf(options.project), {
      ...Object.getOwnPropertyDescriptors(options.project),
      ...Object.getOwnPropertyDescriptors(override),
    }) as SandboxAgentHostOptions['project'];
  };
  const filePolicy = effective('files');
  const shellPolicy = effective('shell');
  const project = options.sandbox.project(filePolicy);
  const shellProject = options.sandbox.project(shellPolicy);
  const root = options.project.root;
  const policyValues = (value: SandboxAgentHostOptions['project']) => ({
    root: value.root,
    readonlyPaths: value.readonlyPaths,
    allowedCommands: value.allowedCommands,
  });
  const policy = JSON.stringify({
    files: policyValues(filePolicy),
    shell: policyValues(shellPolicy),
  });
  const files: AgentFiles = {
    async read(path) {
      const bytes = await project.fs.readFile(path);
      if (bytes.includes(0)) throw new Error('Binary file is not supported by text tools');
      return decoder.decode(bytes);
    },
    async list(path) {
      return (await project.fs.readdir(path)).map((entry) => ({
        path: `${path === '/' ? '' : path}/${entry.name}`,
        kind: entry.isDirectory ? ('dir' as const) : ('file' as const),
      }));
    },
    async change(path, transform) {
      const current = await files.read(path).catch((error: unknown) => {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
        throw error;
      });
      const next = transform(current);
      if (next === null) await project.fs.rm(path);
      else await project.fs.writeFile(path, next);
    },
  };
  const shell: NonNullable<AgentCapabilities['shell']> = async (command, signal, onOutput) => {
    signal?.throwIfAborted();
    const run = shellProject.run(command);
    const detach = run.onOutput(({ chunk, stream }) => onOutput(chunk, stream));
    const stop = () => {
      void run.stop().catch(() => {});
    };
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    try {
      return await run.completion;
    } finally {
      signal?.removeEventListener('abort', stop);
      detach();
    }
  };
  return {
    root,
    capabilities() {
      const mode = options.mode();
      if (mode === 'preview') {
        const preview = options.preview?.();
        return {
          ...(preview ? { preview } : {}),
          notes: [
            'no-COI preview mode: the resident owns the Worker. The host must stopResident before project file or command operations.',
          ],
        };
      }
      if (mode !== 'commands')
        throw new TypeError('Sandbox agent mode must be commands or preview');
      return {
        files,
        shell,
        notes: [
          'no-COI commands mode: each invocation starts at the project root with a fresh environment. Files use ordinary read/transform/write, without CAS or rollback. The host owns build/preview mode changes.',
          `Project policy: ${policy}. Root bounds file tools; SDK command policy is not a hostile-code filesystem jail.`,
        ],
      };
    },
    async close() {
      /* The caller owns the sandbox; this adapter allocates no separate resource. */
    },
  };
}
