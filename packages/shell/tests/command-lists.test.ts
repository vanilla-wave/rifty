/**
 * Conformance against the frozen GNU bash 3.2.57 capture (ADR-0093 frozen tier):
 * newline lists, line continuation and `#` comments behave as bash; heredoc,
 * here-string and compound-command syntax is a loud, atomic gap — the run
 * throws before any segment runs, so files and output stay untouched.
 */
import { NotImplementedError } from '@riftydev/io';
import { MemoryFsSync } from '@riftydev/vfs/internal';
import { describe, expect, it } from 'vitest';
import { Shell } from '../src/index.ts';
import { bashCases, expectation } from './_bash-fixture.ts';

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
    const kinds = new Set(bashCases.map((c) => expectation(c.id)));
    expect([...kinds].sort()).toEqual([
      'conform',
      'shell.background',
      'shell.compound-command',
      'shell.fd-redirect',
      'shell.here-string',
      'shell.heredoc',
      'shell.process-substitution',
      'syntax-error',
    ]);
  });

  for (const c of bashCases) {
    const expected = expectation(c.id);
    it(`${c.id}: ${expected}`, async () => {
      const fileSystem = seeded(c.setup);
      const before = snapshot(fileSystem);
      const allowBackground = expected !== 'shell.background';
      const shell = new Shell({ cwd: ROOT, fileSystem, allowBackground });
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
      if (expected === 'syntax-error') {
        expect(error).not.toBeInstanceOf(NotImplementedError);
        const token = /near unexpected token `(.+?)'/.exec(c.bash.stderr)?.[1];
        expect((error as Error).message).toBe(
          `shell: syntax error near unexpected token \`${token}\``,
        );
      } else {
        expect(error).toBeInstanceOf(NotImplementedError);
        expect((error as NotImplementedError).feature).toBe(expected);
      }
      // Atomic: nothing ran, so nothing was written or printed.
      expect(chunks).toEqual([]);
      expect(snapshot(fileSystem)).toEqual(before);
    });
  }
});
