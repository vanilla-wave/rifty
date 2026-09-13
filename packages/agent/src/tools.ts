import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { type Static, type TSchema, Type } from '@earendil-works/pi-ai';
import { NotImplementedError } from '@riftydev/io';
import { parseUnifiedPatch, planUnifiedPatch } from './apply-patch.ts';
import { capToolText, projectPath } from './text.ts';
import type { AgentCapabilities, AgentFiles, AgentSessionEvent } from './types.ts';
import { hostError } from './workbench-host.ts';

type Tool = AgentTool<TSchema, unknown>;
const excluded = new Set(['node_modules', '.git', 'dist']);
const failure = Symbol('agent tool failure');

function result(text: string, details: unknown = {}): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details };
}

function failedResult(text: string, details: Record<string, unknown>): AgentToolResult<unknown> {
  return result(text, { ...details, [failure]: true });
}

export function isToolFailure(value: AgentToolResult<unknown>): boolean {
  return (
    value.details !== null &&
    typeof value.details === 'object' &&
    Reflect.get(value.details, failure) === true
  );
}

function tool<S extends TSchema>(
  name: string,
  description: string,
  parameters: S,
  execute: (args: Static<S>, signal?: AbortSignal) => Promise<AgentToolResult<unknown>>,
): Tool {
  const value: AgentTool<S, unknown> = {
    name,
    label: name,
    description,
    parameters,
    execute: (_id, args, signal) => execute(args, signal),
  };
  // Pi validates parameters before dispatch; registry erases each schema's generic.
  return value as unknown as Tool;
}

async function walk(
  files: AgentFiles,
  root: string,
): Promise<{ paths: string[]; files: string[]; capped: boolean }> {
  const paths: string[] = [];
  const selected: string[] = [];
  const pending = [root];
  while (pending.length && paths.length < 2000) {
    const directory = pending.pop();
    if (directory === undefined) break;
    for (const entry of await files.list(directory)) {
      if (excluded.has(entry.path.split('/').at(-1) ?? '')) continue;
      paths.push(entry.kind === 'dir' ? `${entry.path}/` : entry.path);
      if (entry.kind === 'dir') pending.push(entry.path);
      else selected.push(entry.path);
      if (paths.length >= 2000) return { paths, files: selected, capped: true };
    }
  }
  return { paths, files: selected, capped: false };
}

async function lookup(
  files: AgentFiles,
  root: string,
  path: string,
): Promise<'file' | 'dir' | null> {
  if (path === root) return 'dir';
  let directory = root;
  const parts = path.slice(root === '/' ? 1 : root.length + 1).split('/');
  for (const [index, name] of parts.entries()) {
    const selected = `${directory === '/' ? '' : directory}/${name}`;
    const entry = (await files.list(directory)).find((candidate) => candidate.path === selected);
    if (!entry) return null;
    if (index === parts.length - 1) return entry.kind;
    if (entry.kind !== 'dir') throw new Error(`Not a directory: ${selected}`);
    directory = selected;
  }
  throw new Error(`Invalid file path: ${path}`);
}

async function readOptional(files: AgentFiles, root: string, path: string): Promise<string | null> {
  const kind = await lookup(files, root, path);
  if (kind === null) return null;
  if (kind !== 'file') throw new Error(`Not a file: ${path}`);
  return files.read(path);
}

function globPattern(pattern: string): RegExp {
  let source = '';
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index] ?? '';
    if (char === '*' && pattern[index + 1] === '*') {
      if (pattern[index + 2] === '/') {
        source += '(?:.*/)?';
        index += 2;
      } else {
        source += '.*';
        index++;
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function standardTools(
  root: string,
  capabilities: AgentCapabilities,
  emit: (event: AgentSessionEvent) => void,
): Tool[] {
  const tools: Tool[] = [];
  const path = (input: string) => projectPath(root, input);
  const relative = (input: string) => input.slice(root === '/' ? 1 : root.length + 1);
  const files = capabilities.files;
  if (files) {
    tools.push(
      tool(
        'read_file',
        'Read a UTF-8 project file; optional 1-based line offset and line limit. Results capped to 16 KiB.',
        Type.Object({
          path: Type.String(),
          offset: Type.Optional(Type.Integer({ minimum: 1 })),
          limit: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
        async (args) => {
          const text = await files.read(path(args.path));
          const offset = (args.offset ?? 1) - 1;
          return result(
            args.offset === undefined && args.limit === undefined
              ? text
              : text
                  .split('\n')
                  .slice(offset, args.limit === undefined ? undefined : offset + args.limit)
                  .join('\n'),
          );
        },
      ),
      tool(
        'write_file',
        'Create or replace a project text file; creates parent directories.',
        Type.Object({ path: Type.String(), content: Type.String() }),
        async (args) => {
          await files.change(path(args.path), () => args.content);
          return result(
            `wrote ${new TextEncoder().encode(args.content).length} bytes to ${args.path}`,
          );
        },
      ),
      tool(
        'edit_file',
        'Replace exactly one unique occurrence of old with new; no fuzzy matching.',
        Type.Object({ path: Type.String(), old: Type.String(), new: Type.String() }),
        async (args) => {
          await files.change(path(args.path), (current) => {
            if (current === null) throw new Error(`File does not exist: ${args.path}`);
            if (!args.old) throw new Error('edit_file: old must not be empty');
            const at = current.indexOf(args.old);
            if (at < 0) throw new Error(`edit_file: string not found in ${args.path}`);
            if (current.indexOf(args.old, at + 1) >= 0)
              throw new Error(`edit_file: string is not unique in ${args.path}`);
            return current.slice(0, at) + args.new + current.slice(at + args.old.length);
          });
          return result(`edited ${args.path}`);
        },
      ),
      tool(
        'apply_patch',
        'Apply a standard unified diff. All hunks are checked before writes; no fuzzy matching. A host failure may leave explicitly reported partial writes.',
        Type.Object({ patch: Type.String() }),
        async (args) => {
          const before = new Map<string, string | null>();
          for (const patch of parseUnifiedPatch(args.patch)) {
            for (const name of [patch.oldPath, patch.newPath]) {
              if (name !== null && !before.has(name))
                before.set(name, await readOptional(files, root, path(name)));
            }
          }
          const changes = planUnifiedPatch(args.patch, (name) => {
            if (!before.has(name)) throw new Error(`Unplanned patch read: ${name}`);
            return before.get(name) ?? null;
          });
          const applied: string[] = [];
          try {
            for (const change of changes) {
              await files.change(path(change.path), (current) => {
                if (current !== before.get(change.path))
                  throw new Error(`Patch file changed since validation: ${change.path}`);
                if (change.action === 'delete') return null;
                if (change.content === undefined)
                  throw new Error(`Patch content absent: ${change.path}`);
                return change.content;
              });
              applied.push(change.path);
            }
          } catch (error) {
            return failedResult(
              `Patch failed after ${applied.length} file changes: ${JSON.stringify(hostError(error))}`,
              { status: 'failed', applied, error: hostError(error) },
            );
          }
          return result(`patched ${applied.join(', ')}`, { applied });
        },
      ),
      tool(
        'list_files',
        'List project paths recursively; node_modules/.git/dist excluded; 2000-entry bound.',
        Type.Object({ path: Type.Optional(Type.String()) }),
        async (args) => {
          const tree = await walk(files, path(args.path || '.'));
          return result(
            tree.paths.map(relative).join('\n') +
              (tree.capped ? '\n[listing capped at 2000 entries]' : ''),
          );
        },
      ),
      tool(
        'glob',
        'Match project-relative paths using **, * and ?; node_modules/.git/dist excluded.',
        Type.Object({ pattern: Type.String() }),
        async (args) => {
          const tree = await walk(files, root);
          const pattern = globPattern(args.pattern);
          return result(
            tree.files
              .map(relative)
              .filter((name) => pattern.test(name))
              .join('\n') + (tree.capped ? '\n[search capped at 2000 entries]' : ''),
          );
        },
      ),
      tool(
        'grep',
        'Search project text files using a JavaScript regexp; returns path:line: text. 500 matches maximum.',
        Type.Object({
          pattern: Type.String(),
          path: Type.Optional(Type.String()),
          ignoreCase: Type.Optional(Type.Boolean()),
        }),
        async (args) => {
          const pattern = new RegExp(args.pattern, args.ignoreCase ? 'i' : '');
          const base = path(args.path || '.');
          let selected: string[];
          let capped = false;
          const kind = await lookup(files, root, base);
          if (kind === null) throw new Error(`Search path does not exist: ${base}`);
          if (kind === 'file') selected = [base];
          else {
            const tree = await walk(files, base);
            selected = tree.files;
            capped = tree.capped;
          }
          const matches: string[] = [];
          for (const name of selected) {
            let text: string;
            try {
              text = await files.read(name);
            } catch (error) {
              if (
                error instanceof TypeError ||
                (error instanceof Error && error.message.includes('Binary file'))
              )
                continue;
              throw error;
            }
            for (const [index, line] of text.split('\n').entries()) {
              if (!pattern.test(line)) continue;
              matches.push(`${relative(name)}:${index + 1}: ${line}`);
              if (matches.length === 500)
                return result(`${matches.join('\n')}\n[matches capped at 500]`);
            }
          }
          return result(matches.join('\n') + (capped ? '\n[search capped at 2000 entries]' : ''));
        },
      ),
    );
  }
  const shell = capabilities.shell;
  if (shell)
    tools.push(
      tool(
        'shell',
        'Run a command in the host project shell. Errors and nonzero exit codes are reported; Stop cancels the active command.',
        Type.Object({ command: Type.String() }),
        async (args, signal) => {
          const outcome = await shell(args.command, signal, (chunk, stream) =>
            emit({ type: 'output', command: args.command, chunk, stream }),
          );
          const makeResult =
            outcome.status !== 'exited' || outcome.exitCode !== 0 ? failedResult : result;
          return makeResult(`${outcome.stdout}${outcome.stderr}`, {
            ...outcome,
            command: args.command,
          });
        },
      ),
    );
  if (capabilities.diagnostics) {
    const diagnostics = capabilities.diagnostics;
    tools.push(
      tool(
        'diagnostics',
        'Return the host TypeScript syntactic and semantic diagnostics.',
        Type.Object({ path: Type.String() }),
        async (args) => result(JSON.stringify(await diagnostics(path(args.path)))),
      ),
    );
  }
  const preview = capabilities.preview;
  if (preview) {
    tools.push(
      tool(
        'preview_fetch',
        'GET a path relative to the current preview URL.',
        Type.Object({ path: Type.Optional(Type.String()) }),
        async (args, signal) => {
          const response = await preview.fetch(args.path ?? '', signal);
          const makeResult = response.status >= 400 ? failedResult : result;
          return makeResult(response.body, {
            statusCode: response.status,
          });
        },
      ),
    );
    for (const method of ['query', 'click', 'type'] as const) {
      const operation = preview[method];
      if (!operation) continue;
      tools.push(
        tool(
          `preview_${method}`,
          `${method} the current host preview DOM; no implicit waiting.`,
          Type.Object({
            selector: Type.String(),
            ...(method === 'type' ? { text: Type.String() } : {}),
          }),
          async (args) =>
            result(
              JSON.stringify(
                await operation.call(
                  preview,
                  args.selector,
                  'text' in args ? String(args.text) : '',
                ),
              ),
            ),
        ),
      );
    }
  }
  return tools;
}

export function wrapTool(original: Tool): Tool {
  return {
    ...original,
    async execute(id, args, signal, update) {
      const capped = (value: AgentToolResult<unknown>) => {
        if (value.content.some((block) => block.type !== 'text'))
          throw new NotImplementedError('agent.tool-image-result');
        return {
          ...value,
          content: [
            {
              type: 'text' as const,
              text: capToolText(
                value.content.map((block) => (block.type === 'text' ? block.text : '')).join('\n'),
              ),
            },
          ],
        };
      };
      try {
        signal?.throwIfAborted();
        return capped(
          await original.execute(
            id,
            args,
            signal,
            update ? (value) => update(capped(value)) : undefined,
          ),
        );
      } catch (error) {
        return capped(
          failedResult(JSON.stringify(hostError(error)), {
            status: signal?.aborted ? 'cancelled' : 'failed',
            error: hostError(error),
          }),
        );
      }
    },
  };
}
