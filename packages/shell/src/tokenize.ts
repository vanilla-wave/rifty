/**
 * Minimal shell tokenizer with POSIX-ish quoting and `$VAR` expansion.
 *
 * Emits {@link Token}s, NOT bare strings: word tokens carry a `quoted` flag
 * recording whether any character came from inside `'…'`/`"…"`, and operator
 * tokens carry an `op` discriminator. Quote provenance is load-bearing for glob
 * expansion (ADR-0091): `grep '*.ts'` (quoted) must stay literal while
 * `grep *.ts` (unquoted) expands — a bare `string[]` can't distinguish them.
 *
 * Supported:
 *   - Whitespace splitting outside quotes.
 *   - Single quotes (`'…'`): literal, no expansion, no escapes.
 *   - Double quotes (`"…"`): `$VAR` / `${VAR}` expansion; escapes for
 *     `\$`, `\"`, `\\`, `` \` `` only — other backslashes are literal.
 *   - Unquoted: `$VAR` / `${VAR}` expansion; backslash escapes the next char.
 *   - `>` / `>>` redirection tokens.
 *   - `<` token; shell decides support (currently `NotImplementedError('shell.input-redirect')`).
 *   - `|` token; shell decides support (`NotImplementedError('shell.pipe')`).
 *     Without it, `cat f | grep x` would bury the pipe inside an argument.
 *   - `&&`, `||`, `;` compound-chain joiner tokens. The dispatcher splits on
 *     these and runs each segment with POSIX joiner semantics (see `shell.ts`).
 *     Inside quotes they stay literal — `echo 'a && b'` is one argument.
 *
 * Deliberately NOT supported (kept loud — caller is expected to error):
 *   glob (`*`, `?`, `[abc]`) is NOT expanded here — the dispatcher expands it
 *   AFTER tokenize, using the `quoted` flag (ADR-0091); command substitution
 *   `$(…)` / `` `…` ``; arithmetic `$((…))`; heredocs.
 *
 * Expansion uses the optional `env`; unknown variables expand to '' (POSIX).
 * Word splitting after expansion is NOT done — `"$x"` and unquoted `$x` both
 * stay one token. Deliberate: bash splits unquoted expansions on `IFS`, but
 * every playground call-site passes already-tokenised values.
 */

/** A word token plus whether any of its characters came from inside quotes. */
export interface WordToken {
  value: string;
  /** `true` iff ≥1 character of `value` originated inside `'…'` or `"…"`. */
  quoted: boolean;
}

/** A shell operator token. */
export interface OpToken {
  op: '>' | '>>' | '<' | '|' | '&' | '&&' | '||' | ';';
}

/** A tokenized line element: either a word (with quote provenance) or an operator. */
export type Token = WordToken | OpToken;

/** Type guard: `true` for an operator token, narrowing to {@link OpToken}. */
export function isOp(token: Token): token is OpToken {
  return 'op' in token;
}

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
    const end = line.indexOf('}', j + 1);
    if (end === -1) {
      // Unterminated ${…} — emit literally.
      return { value: line.slice(i), next: line.length };
    }
    const name = line.slice(j + 1, end);
    if (!VAR_NAME_RE.test(name) || name.length !== VAR_NAME_RE.exec(name)![0].length) {
      // Reject ${VAR:-default}, ${#VAR}, etc. — only plain ${NAME}.
      throw new Error(
        `shell.tokenize: unsupported variable expansion form: \${${name}} — only \${NAME} is supported`,
      );
    }
    return { value: env[name] ?? '', next: end + 1 };
  }
  const tail = line.slice(j);
  const m = VAR_NAME_RE.exec(tail);
  if (!m) {
    // Bare '$' not followed by a name — emit literal '$' (POSIX).
    return { value: '$', next: j };
  }
  const name = m[0];
  return { value: env[name] ?? '', next: j + name.length };
}

export function tokenize(line: string, env: Readonly<Record<string, string>> = {}): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '|' || ch === '&' || ch === ';') {
      let op: OpToken['op'] = ch;
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
        // Bare `&` (background) unsupported — emit the token so the dispatcher
        // rejects loudly instead of `vite &` silently dropping `&` into an arg.
        op = '&';
      }
      tokens.push({ op });
      i++;
      continue;
    }

    // One token = concatenated quoted/unquoted segments (POSIX: `a"b"c`).
    // `quoted` flips true as soon as any character originates inside quotes.
    let buf = '';
    let quoted = false;
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
        // Single-quoted: literal, no expansion. Chars are quoted-provenance.
        i++;
        while (i < n && line[i] !== "'") {
          buf += line[i];
          quoted = true;
          i++;
        }
        if (i < n) i++;
      } else if (c === '"') {
        // Double-quoted: expand $VAR, honour limited escapes. All quoted.
        i++;
        while (i < n && line[i] !== '"') {
          const dc = line[i]!;
          if (dc === '\\') {
            const next = line[i + 1];
            if (next === '$' || next === '"' || next === '\\' || next === '`') {
              buf += next;
              quoted = true;
              i += 2;
              continue;
            }
            // Unknown escape in double quotes — backslash stays literal.
            buf += dc;
            quoted = true;
            i++;
            continue;
          }
          if (dc === '$') {
            const { value, next } = expandVarAt(line, i, env);
            buf += value;
            quoted = true;
            i = next;
            continue;
          }
          buf += dc;
          quoted = true;
          i++;
        }
        if (i < n) i++;
      } else if (c === '\\') {
        // Unquoted backslash escapes the next character literally.
        const next = line[i + 1];
        if (next === undefined) {
          // Trailing backslash — literal, no line continuation.
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
    tokens.push({ value: buf, quoted });
  }
  return tokens;
}
