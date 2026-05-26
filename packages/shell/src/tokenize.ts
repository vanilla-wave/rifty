/**
 * Minimal shell tokenizer with POSIX-ish quoting and `$VAR` expansion.
 *
 * Supported:
 *   - Whitespace splitting outside quotes.
 *   - Single quotes (`'…'`): literal, no expansion, no escape sequences.
 *   - Double quotes (`"…"`): `$VAR` / `${VAR}` expansion; escapes for
 *     `\$`, `\"`, `\\`, `` \` `` only — other backslashes are literal.
 *   - Unquoted: `$VAR` / `${VAR}` expansion; backslash escapes the next char.
 *   - `>` and `>>` produce their own redirection tokens.
 *   - `<` produces its own token; the shell decides whether it is supported
 *     (currently `NotImplementedError('shell.input-redirect')`).
 *   - `|` produces its own token; the shell decides whether it is supported
 *     (currently `NotImplementedError('shell.pipe')`). Without this, a line
 *     like `cat f | grep x` would silently bury the pipe inside an argument.
 *   - `&&`, `||`, `;` produce their own tokens (compound-chain joiners). The
 *     dispatcher splits the token list on these and runs each segment with
 *     POSIX joiner semantics (see `shell.ts`). Inside quotes these stay
 *     literal — `echo 'a && b'` yields one argument `a && b`.
 *
 * Deliberately NOT supported (kept loud — if a token signals these, the caller
 * is expected to error):
 *   - Glob expansion (`*`, `?`, `[abc]`).
 *   - Command substitution `$(…)` / `` `…` ``.
 *   - Arithmetic substitution `$((…))`.
 *   - Heredocs.
 *
 * Variable expansion uses the optional `env` argument. Unknown variables expand
 * to the empty string (POSIX default). Word splitting after expansion is NOT
 * performed — an expanded `"$x"` keeps its embedded whitespace as a single
 * token; an unquoted `$x` also stays one token here. This is a deliberate
 * simplification: real bash splits unquoted expansions on `IFS`, but every
 * call-site in the playground passes already-tokenised values, so the
 * complexity isn't worth it.
 */

const VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*/;

function expandVarAt(
  line: string,
  i: number,
  env: Readonly<Record<string, string>>,
): {
  value: string;
  next: number;
} {
  // Caller has verified line[i] === '$'.
  const j = i + 1;
  if (j >= line.length) return { value: '$', next: j };
  if (line[j] === '{') {
    // ${NAME}
    const end = line.indexOf('}', j + 1);
    if (end === -1) {
      // Unterminated — treat the rest as a malformed ${…}; emit literally.
      return { value: line.slice(i), next: line.length };
    }
    const name = line.slice(j + 1, end);
    if (!VAR_NAME_RE.test(name) || name.length !== VAR_NAME_RE.exec(name)![0].length) {
      // Unsupported expansion form: ${VAR:-default}, ${#VAR}, etc.
      throw new Error(
        `shell.tokenize: unsupported variable expansion form: \${${name}} — only \${NAME} is supported`,
      );
    }
    return { value: env[name] ?? '', next: end + 1 };
  }
  // $NAME
  const tail = line.slice(j);
  const m = VAR_NAME_RE.exec(tail);
  if (!m) {
    // Bare '$' not followed by a name — emit literal '$' (POSIX).
    return { value: '$', next: j };
  }
  const name = m[0];
  return { value: env[name] ?? '', next: j + name.length };
}

export function tokenize(line: string, env: Readonly<Record<string, string>> = {}): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '|' || ch === '&' || ch === ';') {
      let op = ch;
      if (ch === '>' && line[i + 1] === '>') {
        op = '>>';
        i++;
      } else if (ch === '&' && line[i + 1] === '&') {
        op = '&&';
        i++;
      } else if (ch === '|' && line[i + 1] === '|') {
        op = '||';
        i++;
      } else if (ch === '&') {
        // Bare `&` (background process) is intentionally not supported. Emit
        // the token so the dispatcher can decide to reject loudly; without
        // this, a line like `vite &` would silently drop the `&` into the
        // tail of an arg.
        op = '&';
      }
      tokens.push(op);
      i++;
      continue;
    }

    // Build one token: a run of single-quoted, double-quoted, and unquoted
    // segments concatenated together. POSIX behaviour: `a"b"c` is one token.
    let buf = '';
    while (
      i < n &&
      line[i] !== ' ' &&
      line[i] !== '\t' &&
      line[i] !== '>' &&
      line[i] !== '<' &&
      line[i] !== '|' &&
      line[i] !== '&' &&
      line[i] !== ';'
    ) {
      const c = line[i]!;
      if (c === "'") {
        // Single-quoted: literal, no expansion.
        i++;
        while (i < n && line[i] !== "'") {
          buf += line[i];
          i++;
        }
        if (i < n) i++; // consume closing quote
      } else if (c === '"') {
        // Double-quoted: expand $VAR, honour limited escapes.
        i++;
        while (i < n && line[i] !== '"') {
          const dc = line[i]!;
          if (dc === '\\') {
            const next = line[i + 1];
            if (next === '$' || next === '"' || next === '\\' || next === '`') {
              buf += next;
              i += 2;
              continue;
            }
            // Unknown escape inside double quotes — backslash is literal.
            buf += dc;
            i++;
            continue;
          }
          if (dc === '$') {
            const { value, next } = expandVarAt(line, i, env);
            buf += value;
            i = next;
            continue;
          }
          buf += dc;
          i++;
        }
        if (i < n) i++; // consume closing quote
      } else if (c === '\\') {
        // Unquoted backslash escapes the next character literally.
        const next = line[i + 1];
        if (next === undefined) {
          // Trailing backslash — treat as literal (no line continuation).
          buf += '\\';
          i++;
        } else {
          buf += next;
          i += 2;
        }
      } else if (c === '$') {
        const { value, next } = expandVarAt(line, i, env);
        buf += value;
        i = next;
      } else {
        buf += c;
        i++;
      }
    }
    tokens.push(buf);
  }
  return tokens;
}
