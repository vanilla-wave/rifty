/**
 * Workspace file tools (ADR-0190 tool surface): read_file / write_file /
 * edit_file / apply_patch / list_files / grep / glob over the EXISTING
 * playground adapters — reads from the owner snapshot mirror, writes through
 * the acked owner-RPC fs. Errors are thrown (Pi renders them as error tool
 * results); nothing returns an empty-string "success".
 */
// typebox comes via Pi's re-export (ADR-0190 decision) — never @sinclair/typebox.
import { Type } from '@earendil-works/pi-ai';
import { looksBinary } from '../../glue/fs-ops.ts';
import { resolveWorkspacePath, workspaceRelative } from '../../glue/workspace-path.ts';
import type { AiAppContext } from '../app-context.ts';
import { planUnifiedPatch } from './apply-patch.ts';
import { type DefinedAiTool, cappedResult, defineAiTool } from './tool-def.ts';

const enc = new TextEncoder();
const fatalDec = new TextDecoder('utf-8', { fatal: true });

/** Listing/grep/glob guards so a huge tree cannot melt one tool call. */
export const LIST_MAX_ENTRIES = 2_000;
export const GREP_MAX_MATCHES = 500;

function readWorkspaceText(ctx: AiAppContext, path: string): string {
  const bytes = ctx.snapshot.readFileBytesSync(path);
  if (looksBinary(bytes)) {
    throw new Error(`${workspaceRelative(ctx.root(), path)} is binary — text tools cannot read it`);
  }
  try {
    return fatalDec.decode(bytes);
  } catch {
    throw new Error(`${workspaceRelative(ctx.root(), path)} is not valid UTF-8`);
  }
}

async function writeWorkspaceText(ctx: AiAppContext, path: string, content: string): Promise<void> {
  await ctx.fs.writeFile(path, enc.encode(content), { recursive: true });
  ctx.fileWritten(path, content);
}

/** Depth-first file walk of the snapshot tree (dirs first is snapshot order). */
function walkFiles(ctx: AiAppContext, dir: string, out: string[], budget: { left: number }): void {
  for (const entry of ctx.snapshot.readdirSync(dir)) {
    if (budget.left <= 0) return;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      walkFiles(ctx, path, out, budget);
    } else {
      out.push(path);
      budget.left -= 1;
    }
  }
}

function walkTree(ctx: AiAppContext, dir: string, out: string[], budget: { left: number }): void {
  for (const entry of ctx.snapshot.readdirSync(dir)) {
    if (budget.left <= 0) return;
    const path = `${dir}/${entry.name}`;
    out.push(entry.isDirectory ? `${path}/` : path);
    budget.left -= 1;
    if (entry.isDirectory) walkTree(ctx, path, out, budget);
  }
}

/** Convert a glob (`**`, `*`, `?`) to a RegExp over workspace-relative paths. */
export function globToRegExp(pattern: string): RegExp {
  let re = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] ?? '';
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // `**/` matches zero or more path segments; bare `**` matches anything.
        if (pattern[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${re}$`);
}

export function buildFsTools(ctx: AiAppContext): DefinedAiTool[] {
  const readFile = defineAiTool({
    name: 'read_file',
    label: 'Read file',
    snippet: 'read a workspace file (optional line offset/limit)',
    description:
      'Read a text file from the workspace. Paths resolve against the workspace root. ' +
      'Use offset/limit (1-based lines) to page through large files; results are capped at 16 KiB.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, workspace-relative or absolute' }),
      offset: Type.Optional(Type.Number({ description: '1-based first line to read' })),
      limit: Type.Optional(Type.Number({ description: 'Max lines to read' })),
    }),
    execute: (params) => {
      const path = resolveWorkspacePath(ctx.root(), params.path);
      const text = readWorkspaceText(ctx, path);
      if (params.offset === undefined && params.limit === undefined) {
        return Promise.resolve(cappedResult(text, { path }));
      }
      const lines = text.split('\n');
      const start = Math.max(0, Math.floor(params.offset ?? 1) - 1);
      const count = Math.max(0, Math.floor(params.limit ?? lines.length));
      const slice = lines.slice(start, start + count).join('\n');
      return Promise.resolve(
        cappedResult(slice, { path, offset: start + 1, lines: Math.min(count, lines.length) }),
      );
    },
  });

  const writeFile = defineAiTool({
    name: 'write_file',
    label: 'Write file',
    snippet: 'create or overwrite a workspace file',
    description:
      'Write a text file into the workspace (creates parent directories). ' +
      'The write is acknowledged by the workspace store before this tool returns.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, workspace-relative or absolute' }),
      content: Type.String({ description: 'Full file content' }),
    }),
    execute: async (params) => {
      const path = resolveWorkspacePath(ctx.root(), params.path);
      await writeWorkspaceText(ctx, path, params.content);
      const bytes = enc.encode(params.content).byteLength;
      return cappedResult(`wrote ${bytes} bytes to ${workspaceRelative(ctx.root(), path)}`, {
        path,
        bytes,
      });
    },
  });

  const editFile = defineAiTool({
    name: 'edit_file',
    label: 'Edit file',
    snippet: 'replace one exact, unique string in a file',
    description:
      'Replace exactly one occurrence of `old` with `new` in a file. `old` must match the ' +
      'current content EXACTLY (whitespace included) and be unique — no fuzzy matching. ' +
      'Fails loudly when the string is not found or not unique.',
    parameters: Type.Object({
      path: Type.String({ description: 'File path, workspace-relative or absolute' }),
      old: Type.String({ description: 'Exact existing text to replace (must be unique)' }),
      new: Type.String({ description: 'Replacement text' }),
    }),
    execute: async (params) => {
      const path = resolveWorkspacePath(ctx.root(), params.path);
      const rel = workspaceRelative(ctx.root(), path);
      if (params.old === '') throw new Error(`edit_file: \`old\` is empty for ${rel}`);
      const text = readWorkspaceText(ctx, path);
      let occurrences = 0;
      for (let at = text.indexOf(params.old); at !== -1; at = text.indexOf(params.old, at + 1)) {
        occurrences += 1;
        if (occurrences > 1) break;
      }
      if (occurrences === 0) {
        throw new Error(`edit_file: string not found in ${rel} — \`old\` must match exactly`);
      }
      if (occurrences > 1) {
        throw new Error(
          `edit_file: string is not unique in ${rel} — include more surrounding context in \`old\``,
        );
      }
      const next = text.replace(params.old, () => params.new);
      await writeWorkspaceText(ctx, path, next);
      return cappedResult(`edited ${rel} (1 replacement)`, { path });
    },
  });

  const applyPatch = defineAiTool({
    name: 'apply_patch',
    label: 'Apply patch',
    snippet: 'apply a standard unified diff to the workspace',
    description:
      'Apply a standard unified diff (`--- a/…` / `+++ b/…` / `@@` hunks). The whole patch is ' +
      'validated first and rejected on any hunk mismatch (no fuzz), naming the failing hunk. ' +
      'Supports file creation (`--- /dev/null`) and deletion (`+++ /dev/null`).',
    parameters: Type.Object({
      patch: Type.String({ description: 'Unified diff text' }),
    }),
    execute: async (params) => {
      const root = ctx.root();
      const changes = planUnifiedPatch(params.patch, (rel) => {
        const path = resolveWorkspacePath(root, rel);
        return ctx.snapshot.existsSync(path) ? readWorkspaceText(ctx, path) : null;
      });
      const applied: string[] = [];
      for (const change of changes) {
        const path = resolveWorkspacePath(root, change.path);
        if (change.action === 'delete') {
          await ctx.fs.rm(path, { recursive: false, force: false });
          applied.push(`deleted ${change.path}`);
        } else {
          await writeWorkspaceText(ctx, path, change.content ?? '');
          applied.push(`patched ${change.path}`);
        }
      }
      return cappedResult(applied.join('\n'), { files: applied.length });
    },
  });

  const listFiles = defineAiTool({
    name: 'list_files',
    label: 'List files',
    snippet: 'list the workspace tree (dirs end with /)',
    description: `Recursively list files and directories under a path (default: workspace root). node_modules content is not included. Stops after ${LIST_MAX_ENTRIES} entries.`,
    parameters: Type.Object({
      path: Type.Optional(
        Type.String({ description: 'Directory to list (default workspace root)' }),
      ),
    }),
    execute: (params) => {
      const root = ctx.root();
      const base = resolveWorkspacePath(root, params.path ?? '.');
      const out: string[] = [];
      const budget = { left: LIST_MAX_ENTRIES };
      walkTree(ctx, base, out, budget);
      const rels = out.map((p) => workspaceRelative(base, p));
      const listing = rels.length === 0 ? '(empty)' : rels.join('\n');
      const suffix = budget.left <= 0 ? `\n[listing capped at ${LIST_MAX_ENTRIES} entries]` : '';
      return Promise.resolve(cappedResult(listing + suffix, { base, entries: rels.length }));
    },
  });

  const grep = defineAiTool({
    name: 'grep',
    label: 'Grep',
    snippet: 'regex search across workspace files (path:line: text)',
    description: `Search workspace text files with a JavaScript regular expression. Output is \`path:line: text\` per match, capped at ${GREP_MAX_MATCHES} matches. node_modules is not searched.`,
    parameters: Type.Object({
      pattern: Type.String({ description: 'JavaScript regex (no flags syntax, source only)' }),
      path: Type.Optional(
        Type.String({ description: 'Directory or file to search (default root)' }),
      ),
      ignoreCase: Type.Optional(Type.Boolean({ description: 'Case-insensitive match' })),
    }),
    execute: (params) => {
      const root = ctx.root();
      let re: RegExp;
      try {
        re = new RegExp(params.pattern, params.ignoreCase ? 'i' : undefined);
      } catch (err) {
        throw new Error(`grep: invalid pattern ${params.pattern} — ${(err as Error).message}`);
      }
      const base = resolveWorkspacePath(root, params.path ?? '.');
      const files: string[] = [];
      if (ctx.snapshot.statSync(base).isFile) files.push(base);
      else walkFiles(ctx, base, files, { left: LIST_MAX_ENTRIES });
      const matches: string[] = [];
      let capped = false;
      for (const file of files) {
        let text: string;
        try {
          text = readWorkspaceText(ctx, file);
        } catch {
          continue; // binary / oversized snapshot entries are not text-searchable
        }
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (!re.test(lines[i] ?? '')) continue;
          matches.push(`${workspaceRelative(root, file)}:${i + 1}: ${lines[i] ?? ''}`);
          if (matches.length >= GREP_MAX_MATCHES) {
            capped = true;
            break;
          }
        }
        if (capped) break;
      }
      const body = matches.length === 0 ? '(no matches)' : matches.join('\n');
      const suffix = capped ? `\n[matches capped at ${GREP_MAX_MATCHES}]` : '';
      return Promise.resolve(cappedResult(body + suffix, { matches: matches.length }));
    },
  });

  const glob = defineAiTool({
    name: 'glob',
    label: 'Glob',
    snippet: 'find files by glob pattern (** / * / ?)',
    description:
      'Find workspace files whose workspace-relative path matches a glob pattern. ' +
      'Supports `**` (any directories), `*` (within a segment) and `?`. node_modules is not searched.',
    parameters: Type.Object({
      pattern: Type.String({ description: 'Glob over workspace-relative paths, e.g. src/**/*.ts' }),
    }),
    execute: (params) => {
      const root = ctx.root();
      const re = globToRegExp(params.pattern);
      const files: string[] = [];
      walkFiles(ctx, root, files, { left: LIST_MAX_ENTRIES });
      const hits = files.map((p) => workspaceRelative(root, p)).filter((rel) => re.test(rel));
      const body = hits.length === 0 ? '(no matches)' : hits.join('\n');
      return Promise.resolve(cappedResult(body, { matches: hits.length }));
    },
  });

  return [readFile, writeFile, editFile, applyPatch, listFiles, grep, glob];
}
