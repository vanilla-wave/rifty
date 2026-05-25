/**
 * `Shell` — minimal command dispatcher.
 *
 * Steps for `run(line)`:
 *   1. Tokenize (see `tokenize.ts`) — single/double quotes, `$VAR` expansion
 *      against the shell env merged with any inline `KEY=value` overrides.
 *   2. Reject unsupported redirections (`<`, see ADR follow-up M12) loudly via
 *      `NotImplementedError('shell.input-redirect')`.
 *   3. Detect a trailing `> path` or `>> path` redirection; if present,
 *      stdout is buffered to a file instead of returned in the result.
 *   4. Pop env assignments off the front (FOO=bar baz → set FOO before baz).
 *   5. Look up the command in the registry; if absent, exit 127.
 *   6. Run the command, capture its stdout/stderr, return.
 *
 * The shell holds a mutable `cwd` and `env`; commands can mutate cwd through
 * the closure passed to built-in `cd`. Custom commands cannot — they only see
 * a snapshot via the context.
 */

import { NotImplementedError } from '@rifty/io';
import { isAbsolute, joinPath, normalizePath, syncMirror } from '@rifty/vfs';
import { builtinCommands } from './builtins.ts';
import { tokenize } from './tokenize.ts';
import type { ShellCommand } from './types.ts';

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const encoder = new TextEncoder();

export class Shell {
  private _cwd: string;
  private readonly env: Record<string, string>;
  private readonly commands: Map<string, ShellCommand> = new Map();

  constructor(options: ShellOptions = {}) {
    this._cwd = normalizePath(options.cwd ?? '/');
    this.env = { ...(options.env ?? {}) };
    const builtins = builtinCommands((p) => {
      this._cwd = p;
    });
    for (const [name, cmd] of Object.entries(builtins)) this.commands.set(name, cmd);
  }

  get cwd(): string {
    return this._cwd;
  }

  registerCommand(name: string, cmd: ShellCommand): void {
    this.commands.set(name, cmd);
  }

  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }

  async run(line: string): Promise<RunResult> {
    // Tokenise with the shell's current env so `$VAR` expands. Inline env
    // overrides (e.g. `FOO=bar cmd $FOO`) follow bash semantics: the override
    // applies to the command being run, NOT to expansion in the same line.
    // That matches POSIX (`FOO=bar echo $FOO` prints the OUTER FOO).
    const tokens = tokenize(line, this.env);
    if (tokens.length === 0) return { exitCode: 0, stdout: '', stderr: '' };

    if (tokens.includes('<')) {
      throw new NotImplementedError(
        'shell.input-redirect',
        'use bash via wasi for < input redirect — M12 work item',
      );
    }

    if (tokens.includes('|')) {
      throw new NotImplementedError(
        'shell.pipe',
        'pipe operator not yet supported — M12 work item',
      );
    }

    // Pop env assignments (KEY=value) off the front.
    let i = 0;
    const overrides: Record<string, string> = {};
    while (i < tokens.length) {
      const t = tokens[i]!;
      const eq = t.indexOf('=');
      if (eq > 0 && /^[A-Za-z_][A-Za-z_0-9]*$/.test(t.slice(0, eq))) {
        overrides[t.slice(0, eq)] = t.slice(eq + 1);
        i++;
      } else break;
    }
    const rest = tokens.slice(i);
    if (rest.length === 0) {
      Object.assign(this.env, overrides);
      return { exitCode: 0, stdout: '', stderr: '' };
    }

    // Pull off trailing redirection: `... > path` or `... >> path`.
    let redirectTo: { path: string; append: boolean } | null = null;
    if (rest.length >= 2) {
      const op = rest[rest.length - 2];
      const target = rest[rest.length - 1];
      if ((op === '>' || op === '>>') && target && !target.startsWith('-')) {
        redirectTo = { path: target, append: op === '>>' };
        rest.splice(rest.length - 2, 2);
      }
    }

    const cmd = rest[0]!;
    const args = rest.slice(1);
    const handler = this.commands.get(cmd);

    let stdout = '';
    let stderr = '';
    const ctx = {
      cwd: this._cwd,
      env: { ...this.env, ...overrides },
      stdout: {
        write(c: string) {
          stdout += c;
        },
      },
      stderr: {
        write(c: string) {
          stderr += c;
        },
      },
    };

    if (!handler) {
      stderr += `${cmd}: command not found\n`;
      return { exitCode: 127, stdout, stderr };
    }

    let exitCode = 0;
    try {
      exitCode = await handler(args, ctx);
    } catch (err) {
      stderr += `${(err as Error).stack ?? (err as Error).message}\n`;
      exitCode = 1;
    }

    if (redirectTo && stdout.length > 0) {
      try {
        const path = normalizePath(
          isAbsolute(redirectTo.path) ? redirectTo.path : joinPath(this._cwd, redirectTo.path),
        );
        const fs = syncMirror();
        if (redirectTo.append && fs.existsSync(path)) {
          const existing = fs.readFileBytesSync(path);
          const next = new Uint8Array(existing.length + stdout.length);
          next.set(existing, 0);
          next.set(encoder.encode(stdout), existing.length);
          fs.writeFileSync(path, next);
        } else {
          fs.writeFileSync(path, encoder.encode(stdout));
        }
        stdout = '';
      } catch (err) {
        // Loud failure: do NOT silently drop the redirected payload onto
        // stdout (callers expected it in a file). Surface as exit code 1
        // with an EREDIRECT-tagged stderr line so a caller scanning logs
        // can detect "redirect write failed" unambiguously.
        stderr += `${cmd}: redirect write failed: ${redirectTo.path}: ${(err as Error).message} [EREDIRECT]\n`;
        stdout = '';
        exitCode = 1;
      }
    }

    return { exitCode, stdout, stderr };
  }
}
