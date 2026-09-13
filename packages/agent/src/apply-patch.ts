import { NotImplementedError } from '@riftydev/io';

/**
 * Strict unified-diff engine for the `apply_patch` tool (ADR-0424):
 * accepts standard unified diffs (what models emit), rejects on ANY hunk
 * mismatch (no fuzz — every context/deletion line must match exactly),
 * reporting the failing hunk. Position drift alone is tolerated: a hunk whose
 * line numbers are stale still applies when its exact old text matches at
 * exactly one position. Pure module — unit-tested without a browser.
 */

export interface PatchHunk {
  /** The `@@ -a,b +c,d @@` header, verbatim — named in every rejection. */
  readonly header: string;
  readonly oldStart: number;
  /** Context + deleted lines — must match the file exactly. */
  readonly oldLines: readonly string[];
  /** Context + added lines — what the matched span becomes. */
  readonly newLines: readonly string[];
}

export interface FilePatch {
  /** null = file creation (`--- /dev/null`). */
  readonly oldPath: string | null;
  /** null = file deletion (`+++ /dev/null`). */
  readonly newPath: string | null;
  readonly hunks: readonly PatchHunk[];
  /** `\ No newline at end of file` on the NEW side — output drops the final newline. */
  readonly newNoTrailingNewline: boolean;
}

export interface PlannedChange {
  readonly path: string;
  readonly action: 'write' | 'delete';
  /** Present for `write`. */
  readonly content?: string;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function stripDiffPath(raw: string): string | null {
  const path = diffPath(raw.replace(/\r$/, ''));
  if (path === '/dev/null') return null;
  return path.replace(/^[ab]\//, '');
}

function diffPath(raw: string): string {
  if (!raw.startsWith('"')) {
    const path = raw.split('\t')[0] ?? '';
    if (!path) throw new Error('apply_patch: empty file path');
    return path;
  }
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    t: 9,
    n: 10,
    v: 11,
    f: 12,
    r: 13,
    '\\': 92,
    '"': 34,
    "'": 39,
    '?': 63,
  };
  for (let index = 1; index < raw.length; ) {
    const char = raw[index];
    if (char === '"') {
      if (index + 1 < raw.length && raw[index + 1] !== '\t')
        throw new Error('apply_patch: invalid quoted path suffix');
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
        Uint8Array.from(bytes),
      );
    }
    if (char === '\\') {
      index++;
      const octal = /^[0-7]{1,3}/.exec(raw.slice(index))?.[0];
      if (octal) {
        const value = Number.parseInt(octal, 8);
        if (value > 255) throw new Error('apply_patch: invalid quoted path byte');
        bytes.push(value);
        index += octal.length;
      } else {
        const value = escapes[raw[index] ?? ''];
        if (value === undefined) throw new Error('apply_patch: invalid quoted path escape');
        bytes.push(value);
        index++;
      }
    } else {
      const value = raw.codePointAt(index);
      if (value === undefined) throw new Error('apply_patch: incomplete quoted path');
      const text = String.fromCodePoint(value);
      bytes.push(...encoder.encode(text));
      index += text.length;
    }
  }
  throw new Error('apply_patch: unterminated quoted path');
}

/** Parse a unified diff into per-file patches. Throws on malformed input. */
export function parseUnifiedPatch(patch: string): FilePatch[] {
  const lines = patch.split('\n');
  if (lines.some((line) => /^(?:GIT binary patch|Binary files .+ differ)\r?$/.test(line)))
    throw new NotImplementedError('agent.apply_patch.binary');
  const files: FilePatch[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    if (!line.startsWith('--- ')) {
      i += 1;
      continue;
    }
    const oldPath = stripDiffPath(line.slice(4));
    const plusLine = lines[i + 1] ?? '';
    if (!plusLine.startsWith('+++ ')) {
      throw new Error(`apply_patch: malformed patch — "${line}" is not followed by a +++ line`);
    }
    const newPath = stripDiffPath(plusLine.slice(4));
    if (oldPath === null && newPath === null) {
      throw new Error('apply_patch: malformed patch — both sides are /dev/null');
    }
    i += 2;
    const hunks: PatchHunk[] = [];
    let newNoTrailingNewline = false;
    while (i < lines.length) {
      const hunkHead = lines[i] ?? '';
      const match = HUNK_RE.exec(hunkHead);
      if (!match) break;
      const header = hunkHead;
      const oldStart = Number(match[1]);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      i += 1;
      const oldLines: string[] = [];
      const newLines: string[] = [];
      let lastSide: 'old' | 'new' | 'both' = 'both';
      while (i < lines.length && (oldLines.length < oldCount || newLines.length < newCount)) {
        const body = lines[i] ?? '';
        if (body.startsWith(' ')) {
          oldLines.push(body.slice(1));
          newLines.push(body.slice(1));
          lastSide = 'both';
        } else if (body.startsWith('-')) {
          oldLines.push(body.slice(1));
          lastSide = 'old';
        } else if (body.startsWith('+')) {
          newLines.push(body.slice(1));
          lastSide = 'new';
        } else if (body.startsWith('\\')) {
          // "\ No newline at end of file" — only the NEW side changes output.
          if (lastSide !== 'old') newNoTrailingNewline = true;
        } else if (body === '') {
          // Tolerate a blank line models emit for an empty context line.
          oldLines.push('');
          newLines.push('');
          lastSide = 'both';
        } else {
          throw new Error(
            `apply_patch: malformed patch — unexpected line "${body}" inside hunk ${header}`,
          );
        }
        i += 1;
      }
      // Trailing no-newline marker after the last counted line.
      if (i < lines.length && (lines[i] ?? '').startsWith('\\')) {
        if (lastSide !== 'old') newNoTrailingNewline = true;
        i += 1;
      }
      if (oldLines.length !== oldCount || newLines.length !== newCount) {
        throw new Error(
          `apply_patch: malformed patch — hunk ${header} body does not match its declared counts`,
        );
      }
      hunks.push({ header, oldStart, oldLines, newLines });
    }
    if (hunks.length === 0) {
      throw new Error(
        `apply_patch: malformed patch — no hunks for ${newPath ?? oldPath ?? '(unknown)'}`,
      );
    }
    files.push({ oldPath, newPath, hunks, newNoTrailingNewline });
  }
  if (files.length === 0) {
    throw new Error('apply_patch: no file diffs found — expected a standard unified diff');
  }
  return files;
}

function sliceMatches(lines: readonly string[], at: number, expected: readonly string[]): boolean {
  if (at < 0 || at + expected.length > lines.length) return false;
  for (let k = 0; k < expected.length; k += 1) {
    if (lines[at + k] !== expected[k]) return false;
  }
  return true;
}

function locateHunk(
  lines: readonly string[],
  hunk: PatchHunk,
  minIndex: number,
  path: string,
  offset = 0,
): number {
  // Exact position first (header line numbers), then a UNIQUE exact-text match
  // anywhere at/after the previous hunk — offset drift ok, fuzz never.
  const headerAt = hunk.oldStart - 1 + offset;
  if (headerAt >= minIndex && sliceMatches(lines, headerAt, hunk.oldLines)) return headerAt;
  const matches: number[] = [];
  for (let at = minIndex; at + hunk.oldLines.length <= lines.length; at += 1) {
    if (sliceMatches(lines, at, hunk.oldLines)) matches.push(at);
  }
  if (matches.length === 1) return matches[0] ?? 0;
  if (matches.length === 0) {
    throw new Error(
      `apply_patch: hunk ${hunk.header} does not match the current content of ${path}`,
    );
  }
  throw new Error(
    `apply_patch: hunk ${hunk.header} matches ${matches.length} positions in ${path} — ambiguous`,
  );
}

function applyHunks(content: string, filePatch: FilePatch, path: string): string {
  let lines = content.split('\n');
  let searchFrom = 0;
  let offset = 0;
  let touchesEnd = false;
  for (const hunk of filePatch.hunks) {
    const lineCount = lines.length - (lines.at(-1) === '' ? 1 : 0);
    if (hunk.oldLines.length === 0) {
      // Pure insertion into an empty region: anchor by header position.
      const at = Math.min(Math.max(hunk.oldStart + offset, searchFrom), lineCount);
      touchesEnd ||= at === lineCount;
      lines = [...lines.slice(0, at), ...hunk.newLines, ...lines.slice(at)];
      searchFrom = at + hunk.newLines.length;
      offset = at - hunk.oldStart + hunk.newLines.length;
      continue;
    }
    const at = locateHunk(lines, hunk, searchFrom, path, offset);
    touchesEnd ||= at + hunk.oldLines.length === lineCount;
    lines = [...lines.slice(0, at), ...hunk.newLines, ...lines.slice(at + hunk.oldLines.length)];
    searchFrom = at + hunk.newLines.length;
    offset = at - (hunk.oldStart - 1) + hunk.newLines.length - hunk.oldLines.length;
  }
  let next = lines.join('\n');
  if (filePatch.newNoTrailingNewline) next = next.replace(/\n$/, '');
  else if (touchesEnd && next && !next.endsWith('\n')) next += '\n';
  return next;
}

/**
 * Plan the writes/deletes a patch produces against the current tree. `read`
 * returns a file's text or null when absent. Fully validated before anything
 * is returned — a failing hunk rejects the WHOLE patch (no partial apply).
 */
export function planUnifiedPatch(
  patch: string,
  read: (path: string) => string | null,
): PlannedChange[] {
  const files = parseUnifiedPatch(patch);
  const changes: PlannedChange[] = [];
  for (const filePatch of files) {
    if (filePatch.oldPath === null) {
      const path = filePatch.newPath;
      if (path === null) throw new Error('apply_patch: malformed patch — both sides /dev/null');
      if (read(path) !== null) {
        throw new Error(`apply_patch: cannot create ${path} — it already exists`);
      }
      const badHunk = filePatch.hunks.find((hunk) => hunk.oldLines.length > 0);
      if (badHunk) {
        throw new Error(
          `apply_patch: hunk ${badHunk.header} deletes/keeps lines in new file ${path}`,
        );
      }
      const body = filePatch.hunks.flatMap((hunk) => [...hunk.newLines]).join('\n');
      const content = filePatch.newNoTrailingNewline ? body : `${body}\n`;
      changes.push({ path, action: 'write', content });
      continue;
    }
    const current = read(filePatch.oldPath);
    if (current === null) {
      throw new Error(`apply_patch: ${filePatch.oldPath} does not exist in the workspace`);
    }
    if (filePatch.newPath === null) {
      if (applyHunks(current, filePatch, filePatch.oldPath) !== '') {
        throw new Error(`apply_patch: deletion leaves unmentioned content in ${filePatch.oldPath}`);
      }
      changes.push({ path: filePatch.oldPath, action: 'delete' });
      continue;
    }
    const content = applyHunks(current, filePatch, filePatch.oldPath);
    changes.push({ path: filePatch.newPath, action: 'write', content });
    if (filePatch.newPath !== filePatch.oldPath) {
      changes.push({ path: filePatch.oldPath, action: 'delete' });
    }
  }
  return changes;
}
