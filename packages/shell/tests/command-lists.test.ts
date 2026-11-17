/**
 * Conformance against the frozen GNU bash 3.2.57 capture (ADR-0093 frozen tier):
 * newline lists, line continuation and `#` comments behave as bash; heredoc,
 * here-string and compound-command syntax is a loud, atomic gap — the run
 * throws before any segment runs, so files and output stay untouched.
 */
import { readFileSync } from 'node:fs';
import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';

interface BashCase {
  readonly id: string;
  readonly command: string;
  readonly setup: Readonly<Record<string, string>>;
  readonly bash: {
    readonly stdout: string;
    readonly stderr: string;
    readonly exit: number;
    readonly files: Readonly<Record<string, string>>;
  };
}

const fixture = JSON.parse(
  readFileSync(new URL('../fixtures/bash/command-lists-bash-3.2.57.json', import.meta.url), 'utf8'),
) as { readonly cases: readonly BashCase[] };

/** Rifty's contract per case: bash-identical, or a named loud gap. */
function expectation(id: string): 'conform' | `shell.${string}` {
  if (id === 'heredoc-operator-quoted') return 'conform';
  if (id.startsWith('heredoc-')) return 'shell.heredoc';
  if (id.startsWith('here-string')) return 'shell.here-string';
  if (id.startsWith('reserved-word')) return 'conform';
  if (id.startsWith('compound-') || id.startsWith('reserved-')) return 'shell.compound-command';
  return 'conform';
}

const ROOT = '/p';
const dec = new TextDecoder();

function snapshot(fs: MemoryFsSync, rel = ''): Record<string, string> {
  const out: Record<string, string> = {};
  const entries = [...fs.readdirSync(rel ? `${ROOT}/${rel}` : ROOT)].sort((a, b) =>
    a.name < b.name ? -1 : 1,
  );
  for (const entry of entries) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory) {
      out[`${path}/`] = '';
      Object.assign(out, snapshot(fs, path));
    } else out[path] = dec.decode(fs.readFileBytesSync(`${ROOT}/${path}`));
  }
  return out;
}

function seeded(setup: Readonly<Record<string, string>>): MemoryFsSync {
  const fs = new MemoryFsSync();
  fs.mkdirSync(ROOT, { recursive: true });
  for (const [path, body] of Object.entries(setup)) {
    fs.mkdirSync(`${ROOT}/${path}`.replace(/\/[^/]+$/, ''), { recursive: true });
    fs.writeFileSync(`${ROOT}/${path}`, new TextEncoder().encode(body));
  }
  return fs;
}

describe('command lists vs frozen bash 3.2.57', () => {
  it('covers loud and conforming cases', () => {
    const kinds = new Set(fixture.cases.map((c) => expectation(c.id)));
    expect([...kinds].sort()).toEqual([
      'conform',
      'shell.compound-command',
      'shell.here-string',
      'shell.heredoc',
    ]);
  });

  for (const c of fixture.cases) {
    const expected = expectation(c.id);
    it(`${c.id}: ${expected}`, async () => {
      const fileSystem = seeded(c.setup);
      const before = snapshot(fileSystem);
      const shell = new Shell({ cwd: ROOT, fileSystem });
      const chunks: string[] = [];
      const run = shell.run(c.command, { onChunk: (chunk) => chunks.push(chunk) });

      if (expected === 'conform') {
        const result = await run;
        expect({
          stdout: result.stdout,
          exit: result.exitCode,
          files: snapshot(fileSystem),
        }).toEqual({ stdout: c.bash.stdout, exit: c.bash.exit, files: c.bash.files });
        if (c.bash.stderr === '') expect(result.stderr).toBe('');
        else expect(result.stderr).not.toBe('');
        return;
      }

      const error = await run.then(
        () => null,
        (thrown: unknown) => thrown,
      );
      expect(error).toBeInstanceOf(NotImplementedError);
      expect((error as NotImplementedError).feature).toBe(expected);
      // Atomic: nothing ran, so nothing was written or printed.
      expect(chunks).toEqual([]);
      expect(snapshot(fileSystem)).toEqual(before);
    });
  }
});
