/**
 * Minimal shell tokenizer with POSIX-ish quoting and `$VAR` expansion.
 *
 * Emits {@link Token}s, NOT bare strings: word tokens carry a `quoted` flag
 * recording whether quoting contributed to the word, and operator tokens carry
 * an `op` discriminator. Quote provenance is load-bearing for glob expansion
 * (ADR-0091): `grep '*.ts'` (quoted) must stay literal while `grep *.ts`
 * (unquoted) expands — a bare `string[]` can't distinguish them. A wholly empty
 * quoted word is also marked quoted so explicit `''`/`""` survives argv elision.
 *
 * Supported:
 *   - Whitespace splitting outside quotes.
 *   - Unquoted newline ends a command: lowered to the `;` operator, or dropped
 *     after nothing, `;`, `&&`, `||`, `|` or `&` (the list continues / ended).
 *   - Unquoted or double-quoted backslash-newline is removed before lexing
 *     (line continuation), so it can join operators, words and `$NAME`.
 *   - Word-initial unquoted `#` comments out the rest of the line.
 *   - Unquoted word-initial `~` / `~/…` → `$HOME` (bash tilde expansion).
 *   - Single quotes (`'…'`): literal, no expansion, no escapes.
 *   - Double quotes (`"…"`): `$VAR` / `${VAR}` expansion; escapes for
 *     `\$`, `\"`, `\\`, `` \` `` only — other backslashes are literal.
 *   - Unquoted: `$VAR` / `${VAR}` expansion; backslash escapes the next char.
 *   - `>` / `>>` / `<` redirection tokens; `|` pipe token.
 *   - `&&`, `||`, `;` compound-chain joiner tokens. The dispatcher splits on
 *     these and runs each segment with POSIX joiner semantics (see `shell.ts`).
 *     Inside quotes they stay literal — `echo 'a && b'` is one argument.
 *
 * Deliberately NOT supported:
 *   glob (`*`, `?`, `[abc]`) is NOT expanded here — the dispatcher expands it
 *   AFTER tokenize, using the `quoted` flag (ADR-0091). Command substitution
 *   `$(…)` / `` `…` `` and arithmetic `$((…))` THROW here (loud — they used to
 *   pass through as a silent literal, a Fidelity bug); single-quoted forms stay
 *   literal (bash suppresses substitution in `'…'`). Heredoc `<<` / `<<-` and
 *   here-string `<<<` THROW on the operator, before any body is lexed.
 *
 * Expansion uses the optional `env`; unknown variables expand to '' (POSIX).
 * Word splitting after expansion is NOT done — `"$x"` and unquoted `$x` both
 * stay one token. Deliberate: bash splits unquoted expansions on `IFS`, but
 * every playground call-site passes already-tokenised values.
 */

import { NotImplementedError } from '@riftydev/io';

/** A word token plus whether any of its characters came from inside quotes. */
export interface WordToken {
  value: string;
  /** Quoted character provenance, or an explicitly empty quoted word. */
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
const WORD_END = new Set([' ', '\t', '\n', '>', '<', '|', '&', ';']);
/** Operators after which a newline separates nothing: the list continues or already ended. */
const NEWLINE_JOINED = new Set<OpToken['op']>([';', '&&', '||', '|', '&']);

/**
 * Loud gap for `$(…)` / `$((…))` / `` `…` `` — command substitution and
 * arithmetic expansion are not evaluated yet. Throws in the contexts where bash
 * WOULD substitute (unquoted + double-quoted), so the user sees a directed error
 * instead of the silent literal pass-through this used to do (a Fidelity bug).
 * Single-quoted forms never reach here, staying literal (bash-faithful).
 */
function throwCommandSubstitution(): never {
  throw new NotImplementedError(
    'shell.command-substitution',
    'command substitution `$(…)` / backticks (and `$((…))` arithmetic) are not evaluated yet — run the inner command separately and use its output',
  );
}

/** Loud gap for `<<` / `<<-` / `<<<`: thrown on the operator, so a body is never lexed as commands. */
// TODO(backlog: shell/heredoc)
function throwHeredoc(hereString: boolean): never {
  if (hereString) {
    throw new NotImplementedError(
      'shell.here-string',
      'here-strings `<<<` are not supported — write the text to a file and redirect it with `<`',
    );
  }
  throw new NotImplementedError(
    'shell.heredoc',
    'heredocs `<<` are not supported — write the body to a file (file tools or `node -e`), then redirect it with `<`',
  );
}

/**
 * bash removes a line continuation before it lexes: unquoted or double-quoted
 * backslash-newline goes; `'…'`, an escaped `\\` and comment text keep theirs.
 */
function joinContinuations(line: string): string {
  if (!line.includes('\\\n')) return line;
  let out = '';
  let quote: "'" | '"' | null = null;
  let wordStart = true;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      out += ch;
      continue;
    }
    if (ch === '\\') {
      if (line[i + 1] !== '\n') {
        out += line.slice(i, i + 2);
        wordStart = false;
      }
      i++;
      continue;
    }
    if (quote === '"') {
      if (ch === '"') quote = null;
      out += ch;
      continue;
    }
    if (ch === '#' && wordStart) {
      const end = line.indexOf('\n', i);
      out += line.slice(i, end === -1 ? line.length : end);
      i = (end === -1 ? line.length : end) - 1;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    wordStart = WORD_END.has(ch);
    out += ch;
  }
  return out;
}

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
  // `$(` → command substitution `$(…)` or arithmetic `$((…))` — loud, not literal.
  if (line[j] === '(') throwCommandSubstitution();
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

/** Lexical facts the compound guard needs and the public {@link Token} does not carry. */
interface Lexeme {
  readonly token: Token;
  /** Word made only of literal characters: no quote, escape or expansion. */
  readonly plain: boolean;
  /** Word holds an unquoted, unescaped `(` or `)` — a bash operator. */
  readonly paren: boolean;
}

export function tokenize(line: string, env: Readonly<Record<string, string>> = {}): Token[] {
  return lex(line, env).map((lexeme) => lexeme.token);
}

function lex(input: string, env: Readonly<Record<string, string>>): Lexeme[] {
  const line = joinContinuations(input);
  const lexemes: Lexeme[] = [];
  const push = (token: Token, plain = false, paren = false): void => {
    lexemes.push({ token, plain, paren });
  };
  let i = 0;
  const n = line.length;
  while (i < n) {
    const ch = line[i]!;
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }
    if (ch === '\n') {
      const last = lexemes.at(-1)?.token;
      if (last && !(isOp(last) && NEWLINE_JOINED.has(last.op))) push({ op: ';' });
      i++;
      continue;
    }
    if (ch === '#') {
      // Comment to end of line; the newline itself still separates.
      while (i < n && line[i] !== '\n') i++;
      continue;
    }
    if (ch === '>' || ch === '<' || ch === '|' || ch === '&' || ch === ';') {
      let op: OpToken['op'] = ch;
      if (ch === '<' && line[i + 1] === '<') throwHeredoc(line[i + 2] === '<');
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
      push({ op });
      i++;
      continue;
    }

    // One token = concatenated quoted/unquoted segments (POSIX: `a"b"c`).
    // `quoted` flips true as soon as any character originates inside quotes.
    let buf = '';
    let quoted = false;
    let hasQuoteSyntax = false;
    let plain = true;
    let paren = false;
    // Tilde expansion (bash): an unquoted word-initial `~` alone or before `/`
    // is `$HOME`; `~user` and an unset HOME stay literal.
    const after = line[i + 1];
    if (
      line[i] === '~' &&
      env.HOME !== undefined &&
      (after === undefined || after === '/' || WORD_END.has(after))
    ) {
      buf = env.HOME;
      plain = false;
      i++;
    }
    while (
      i < n &&
      line[i] !== ' ' &&
      line[i] !== '\t' &&
      line[i] !== '\n' &&
      line[i] !== '>' &&
      line[i] !== '<' &&
      line[i] !== '|' &&
      line[i] !== '&' &&
      line[i] !== ';'
    ) {
      const c = line[i]!;
      if (c === "'" || c === '"' || c === '\\' || c === '$') plain = false;
      if (c === "'") {
        // Single-quoted: literal, no expansion. Chars are quoted-provenance.
        hasQuoteSyntax = true;
        i++;
        while (i < n && line[i] !== "'") {
          buf += line[i];
          quoted = true;
          i++;
        }
        if (i < n) i++;
      } else if (c === '"') {
        // Double-quoted: expand $VAR, honour limited escapes. All quoted.
        hasQuoteSyntax = true;
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
          // A bare backtick inside "…" is command substitution (bash) — loud.
          if (dc === '`') throwCommandSubstitution();
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
      } else if (c === '`') {
        // Unquoted backtick is command substitution (bash) — loud, not literal.
        throwCommandSubstitution();
      } else {
        if (c === '(' || c === ')') paren = true;
        buf += c;
        i++;
      }
    }
    // `''` / `""` is one real empty argv entry. Empty quotes adjacent to an
    // unquoted value contribute no characters, so `*''` remains glob-eligible.
    if (buf === '' && hasQuoteSyntax) quoted = true;
    push({ value: buf, quoted }, plain, paren);
  }
  return lexemes;
}

/** bash 3.2 reserved words; reserved only as the first word of a command. */
const RESERVED_WORDS = new Set([
  '!',
  '{',
  '}',
  '[[',
  ']]',
  'case',
  'do',
  'done',
  'elif',
  'else',
  'esac',
  'fi',
  'for',
  'function',
  'if',
  'in',
  'select',
  'then',
  'until',
  'while',
]);
const COMMAND_SEPARATORS = new Set<OpToken['op']>([';', '&&', '||', '|', '&']);

/**
 * Loud gap for compound commands: a literal reserved word at command position,
 * or an unquoted `(`/`)` anywhere (subshell, `name ()` function, `((…))`),
 * throws before anything runs. Run as plain lines, a multi-line
 * `if …\nthen\nrm -rf dist\nfi` body would execute unconditionally.
 */
export function assertSimpleCommands(line: string): void {
  let commandStart = true;
  for (const { token, plain, paren } of lex(line, {})) {
    if (isOp(token)) {
      // bash: a list operator where a command must start is a syntax error.
      if (commandStart && COMMAND_SEPARATORS.has(token.op)) {
        throw new Error(`shell: syntax error near unexpected token \`${token.op}\``);
      }
      commandStart = COMMAND_SEPARATORS.has(token.op);
      continue;
    }
    if (paren || (commandStart && plain && RESERVED_WORDS.has(token.value))) {
      throw new NotImplementedError(
        'shell.compound-command',
        `\`${token.value}\`: compound commands (if/for/while/until/case/select, {…}, (…), [[…]], !, functions) and unquoted \`(\`/\`)\` are not supported — run simple commands, or move the logic into a node script`,
      );
    }
    commandStart = false;
  }
}
