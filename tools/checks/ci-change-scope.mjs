#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DOCUMENT_BASENAMES = new Set([
  'AGENTS.MD',
  'CHANGELOG.MD',
  'CLAUDE.MD',
  'CODE_OF_CONDUCT.MD',
  'CONTRIBUTING.MD',
  'LICENSE',
  'LICENSE.MD',
  'LICENSE.TXT',
  'README.MD',
  'README.MDX',
  'SECURITY.MD',
]);

export function isDocumentationOnlyPath(path) {
  if (path.startsWith('docs/')) return true;
  const basename = path.slice(path.lastIndexOf('/') + 1).toUpperCase();
  return DOCUMENT_BASENAMES.has(basename);
}

export function requiresHeavyCi(paths) {
  // An empty diff is unexpected for a PR event. Fail open rather than silently
  // weakening the gate if GitHub's event SHAs or checkout behavior drift.
  return paths.length === 0 || paths.some((path) => !isDocumentationOnlyPath(path));
}

export function changedPathsBetween(base, head, cwd = process.cwd()) {
  const output = execFileSync(
    'git',
    ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`, '--'],
    {
      cwd,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  return output.split('\0').filter(Boolean);
}

function writeResult(code, paths, reason) {
  process.stdout.write(`code=${code}\n`);
  const detail = paths.length === 0 ? '' : ` paths=${JSON.stringify(paths)}`;
  process.stderr.write(`heavy CI ${code ? 'enabled' : 'skipped'}: ${reason}${detail}\n`);
}

function main() {
  const [eventName, base, head] = process.argv.slice(2);
  if (eventName !== 'pull_request') {
    writeResult(true, [], `${eventName || 'unknown event'} receives the full gate`);
    return;
  }

  try {
    const paths = changedPathsBetween(base, head);
    const code = requiresHeavyCi(paths);
    writeResult(code, paths, code ? 'code-affecting or empty diff' : 'documentation-only PR');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeResult(true, [], `diff classification failed open (${message})`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
