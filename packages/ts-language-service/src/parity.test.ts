/**
 * Parity harness (gold standard, ADR-0166 / AGENTS.md §Fidelity).
 *
 * Proves rifty's language service produces the SAME semantic diagnostics as the
 * real `ts.LanguageService`, for the SAME fixture, the SAME pinned
 * `typescript@5.9.3`.
 *
 * Why a co-located vitest test (not a `tools/node-parity-runner` case): the
 * node-parity-runner is a *guest-program* harness — it runs `code` in real Node
 * (child_process) vs the rifty runtime and diffs stdout. This task is a
 * *library-API* head-to-head: call `ts.LanguageService` two ways (real Node fs
 * host vs the rifty VFS host) and deep-equal their normalized diagnostics. That
 * does not fit the stdout-diff case shape, so it lives here as a vitest parity
 * test (picked up by the `unit` project glob for package src test files).
 *
 * Independence (this is what makes it a gold standard):
 *   - Side A (gold) writes the fixture to a REAL Node tmp dir and builds a real
 *     `ts.LanguageService` over a real-`node:fs`-backed host, parsing the
 *     tsconfig with tsc's own `parseJsonConfigFileContent` over `ts.sys`. It
 *     touches NO rifty code (not host.ts / tsconfig.ts / the VFS) — only the
 *     pinned `typescript`.
 *   - Side B (rifty) loads the SAME fixture bytes into a `createMemoryFs()` and
 *     calls `createTsLanguageService`.
 *   - Expectations are computed from Side A AT TEST RUNTIME — nothing is
 *     hardcoded, nothing is derived from Side B.
 *   - The SAME `normalize` is applied to both sides; it compares file + code +
 *     range + message (nothing diagnostic-identifying is dropped) and sorts
 *     deterministically. A real divergence is a FAILING test, by design.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import * as nodePath from 'node:path';
import { createMemoryFs } from '@riftydev/vfs/internal';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { createTsLanguageService } from './service.ts';

const require = createRequire(import.meta.url);

/** A fixture: a map of POSIX-relative path → file contents, plus the files to diagnose. */
interface Fixture {
  readonly name: string;
  /** What divergence this fixture probes (documentation only). */
  readonly probes: string;
  /** Relative path → contents. Keys are POSIX (`a.ts`, `node_modules/x/index.d.ts`). */
  readonly files: Readonly<Record<string, string>>;
  /** Relative paths to collect semantic diagnostics for (order-independent). */
  readonly diagnose: readonly string[];
}

/** Comparison shape — everything that identifies a diagnostic. */
interface NormDiagnostic {
  readonly file: string;
  readonly code: number | undefined;
  readonly start: { line: number; character: number };
  readonly end: { line: number; character: number };
  readonly messageText: string;
}

// ---------------------------------------------------------------------------
// Symmetric normalization (applied IDENTICALLY to both sides).
//
// Both raw inputs are reduced to `{ file, code, start, end, messageText }` and
// sorted by (file, start.line, start.character, code). Nothing
// diagnostic-identifying is dropped: code, range AND message all survive. The
// sort is purely to make deep-equal order-independent — it does not hide
// identity.
// ---------------------------------------------------------------------------
function sortDiags(diags: NormDiagnostic[]): NormDiagnostic[] {
  return [...diags].sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.start.line - b.start.line ||
      a.start.character - b.start.character ||
      (a.code ?? 0) - (b.code ?? 0) ||
      a.messageText.localeCompare(b.messageText),
  );
}

/** Side A: a real `ts.Diagnostic` (carries its own SourceFile) → comparison shape. */
function normalizeTsDiagnostic(d: ts.Diagnostic, rel: (abs: string) => string): NormDiagnostic {
  const file = d.file;
  const start =
    file && d.start !== undefined
      ? file.getLineAndCharacterOfPosition(d.start)
      : { line: 0, character: 0 };
  const end =
    file && d.start !== undefined
      ? file.getLineAndCharacterOfPosition(d.start + (d.length ?? 0))
      : { line: 0, character: 0 };
  return {
    file: file ? rel(file.fileName) : '<global>',
    code: typeof d.code === 'number' ? d.code : undefined,
    start: { line: start.line, character: start.character },
    end: { line: end.line, character: end.character },
    messageText: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
  };
}

/** Side B: a rifty LSP `Diagnostic` (no file field; range is line/char) → comparison shape. */
function normalizeLspDiagnostic(
  d: import('./lsp-types.ts').Diagnostic,
  relFile: string,
): NormDiagnostic {
  return {
    file: relFile,
    code: d.code,
    start: { line: d.range.start.line, character: d.range.start.character },
    end: { line: d.range.end.line, character: d.range.end.character },
    messageText: d.message,
  };
}

// ---------------------------------------------------------------------------
// Side A — gold standard. Real tmp dir + real-fs ts.LanguageService.
// ---------------------------------------------------------------------------

/** Resolve the lib dir of the pinned `typescript` (so the gold lib set matches). */
function tsLibDir(): string {
  const pkg = require.resolve('typescript/package.json');
  return nodePath.join(nodePath.dirname(pkg), 'lib');
}

const tmpRoots: string[] = [];
afterAll(() => {
  for (const r of tmpRoots) rmSync(r, { recursive: true, force: true });
});

function writeFixtureToTmp(fixture: Fixture): string {
  const root = mkdtempSync(nodePath.join(tmpdir(), 'rifty-tslsp-parity-'));
  tmpRoots.push(root);
  for (const [rel, contents] of Object.entries(fixture.files)) {
    const abs = nodePath.join(root, rel);
    mkdirSync(nodePath.dirname(abs), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

/**
 * Build a real `ts.LanguageService` over real Node fs for `root`, parse the
 * tsconfig with tsc's own machinery (`ts.sys`), and collect semantic
 * diagnostics for the requested files. Pure tsc — no rifty code.
 */
function goldDiagnostics(fixture: Fixture, root: string): NormDiagnostic[] {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');
  let parsed: ts.ParsedCommandLine;
  if (configPath) {
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    parsed = ts.parseJsonConfigFileContent(
      read.config ?? {},
      ts.sys,
      nodePath.dirname(configPath),
      undefined,
      configPath,
    );
  } else {
    parsed = ts.parseJsonConfigFileContent({}, ts.sys, root);
  }

  const libDir = tsLibDir();
  const fileVersions = new Map<string, number>();
  const bumpVersion = (f: string) => {
    fileVersions.set(f, (fileVersions.get(f) ?? 0) + 1);
    return String(fileVersions.get(f));
  };
  for (const f of parsed.fileNames) bumpVersion(f);

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => parsed.fileNames,
    getScriptVersion: (f) => String(fileVersions.get(f) ?? 0),
    getScriptSnapshot: (f) => {
      const text = ts.sys.readFile(f);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => root,
    // Point the default lib at the real typescript install lib dir so the gold
    // standard's std-lib is exactly the pinned compiler's.
    getDefaultLibFileName: (options) => nodePath.join(libDir, ts.getDefaultLibFileName(options)),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: ts.sys.realpath,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };

  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const out: NormDiagnostic[] = [];
  const rel = (abs: string) => toPosixRel(root, abs);
  for (const relPath of fixture.diagnose) {
    const abs = nodePath.join(root, relPath);
    for (const d of service.getSemanticDiagnostics(abs)) out.push(normalizeTsDiagnostic(d, rel));
  }
  return sortDiags(out);
}

/** Real-fs absolute path → POSIX relative-to-root (so it compares with Side B). */
function toPosixRel(root: string, abs: string): string {
  const r = nodePath.relative(root, abs);
  return r.split(nodePath.sep).join('/');
}

// ---------------------------------------------------------------------------
// Side B — rifty. SAME fixture bytes into a memory VFS + createTsLanguageService.
// ---------------------------------------------------------------------------

const RIFTY_ROOT = '/proj';

function writeFixtureToVfs(fixture: Fixture): ReturnType<typeof createMemoryFs>['fsSync'] {
  const { fsSync } = createMemoryFs();
  const enc = new TextEncoder();
  for (const [rel, contents] of Object.entries(fixture.files)) {
    const abs = `${RIFTY_ROOT}/${rel}`;
    const dir = abs.slice(0, abs.lastIndexOf('/')) || '/';
    fsSync.mkdirSync(dir, { recursive: true });
    fsSync.writeFileSync(abs, enc.encode(contents));
  }
  return fsSync;
}

async function riftyDiagnostics(fixture: Fixture): Promise<NormDiagnostic[]> {
  const fsSync = writeFixtureToVfs(fixture);
  const svc = await createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT });
  const out: NormDiagnostic[] = [];
  for (const relPath of fixture.diagnose) {
    const abs = `${RIFTY_ROOT}/${relPath}`;
    for (const d of svc.getSemanticDiagnostics(abs)) out.push(normalizeLspDiagnostic(d, relPath));
  }
  return sortDiags(out);
}

// ---------------------------------------------------------------------------
// Fixtures — each probes a divergence-prone area.
// ---------------------------------------------------------------------------

const FIXTURES: readonly Fixture[] = [
  // (a) Cross-file type error: importing a sibling and calling it wrong.
  {
    name: 'cross-file wrong-typed argument',
    probes: 'relative import resolution across files + signature consulted across modules (TS2345)',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
      }),
      'math.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      'main.ts': "import { add } from './math.ts';\nadd('1', 2);\n",
    },
    diagnose: ['main.ts', 'math.ts'],
  },

  // (b) tsconfig strict + noUnusedLocals: diagnostics that differ vs defaults.
  {
    name: 'strict + noUnusedLocals',
    probes:
      'tsconfig honored exactly: strictNullChecks (TS2531/2532) + noUnusedLocals (TS6133) + implicit-any params (TS7006) under strict',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, noUnusedLocals: true, module: 'esnext', target: 'es2022' },
      }),
      // Each line probes a strict-only diagnostic:
      //   - `unused` → TS6133 (noUnusedLocals)
      //   - `p.length` where p: string|null → TS18047/2531 (strictNullChecks)
      //   - `q` untyped param → TS7006 (noImplicitAny under strict)
      'a.ts':
        'export function f(p: string | null, q): number {\n' +
        '  const unused = 1;\n' +
        '  return p.length + q;\n' +
        '}\n',
    },
    diagnose: ['a.ts'],
  },

  // (b2) NO tsconfig (loose defaults). Same shape as (b) but engineered so the
  // loose-file defaults still yield a NON-empty, but DIFFERENT, diagnostic set:
  //   - `const a: number = "x"` → TS2322 (reported under defaults too)
  //   - `p.length` where `p: string | null` → strict-ONLY (no diagnostic here)
  //   - `q` untyped param → strict-ONLY noImplicitAny (no diagnostic here)
  // So real tsc under defaults reports exactly the TS2322 and NOT the
  // strict-only ones. rifty (which also finds no tsconfig → tsc loose defaults)
  // must reproduce that exact set — proving it honors the *absence* of a
  // tsconfig like real tsc, not a vacuous empty==empty pass.
  {
    name: 'no tsconfig (loose defaults) — strict-only diagnostics suppressed',
    probes:
      'loose-file defaults: a plain TS2322 IS reported, but strictNullChecks/noImplicitAny diagnostics are NOT — rifty must match real tsc defaults exactly (non-vacuous)',
    files: {
      'a.ts':
        'const a: number = "x";\n' +
        'export function f(p: string | null, q) {\n' +
        '  return p.length + q + a;\n' +
        '}\n',
    },
    diagnose: ['a.ts'],
  },

  // (c) node_modules resolution: a package whose .d.ts lives in node_modules,
  // used wrongly so a TS2345-style error appears.
  {
    name: 'node_modules .d.ts used wrongly (TS2345)',
    probes:
      'classic node_modules resolution via package.json "types" + signature consulted → TS2345 (NOT "Cannot find module")',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'es2022',
        },
      }),
      'node_modules/leftpad/package.json': JSON.stringify({
        name: 'leftpad',
        version: '1.0.0',
        types: 'index.d.ts',
      }),
      'node_modules/leftpad/index.d.ts': 'export function leftpad(s: string, n: number): string;\n',
      'main.ts': "import { leftpad } from 'leftpad';\nleftpad(1, 2);\n",
    },
    diagnose: ['main.ts'],
  },

  // (d) Multiple errors per file, ordered — exercises range ordering & message
  // flattening across several diagnostics in one file.
  {
    name: 'multiple errors per file (ordering + flattening)',
    probes: 'several diagnostics in one file: deterministic ordering by range + message flatten',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
      }),
      'm.ts':
        'const a: number = "x";\n' + // TS2322
        'const b: string = 5;\n' + // TS2322
        'function g(): number {}\n' + // TS2355 (no return)
        'unknownIdentifier();\n', // TS2304 (cannot find name)
      // touch a/b so they aren't also flagged unused (keeps this fixture about
      // the four chosen errors, not noUnusedLocals)
    },
    diagnose: ['m.ts'],
  },

  // (e) Re-export chain: error surfaces at the call site through a barrel.
  {
    name: 're-export through a barrel (TS2345)',
    probes: 'export-star / re-export resolution chain across 3 files, error at the wrong call',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, module: 'esnext', target: 'es2022' },
      }),
      'impl.ts': 'export function greet(name: string): string {\n  return `hi ${name}`;\n}\n',
      'index.ts': "export * from './impl.ts';\n",
      'main.ts': "import { greet } from './index.ts';\ngreet(42);\n",
    },
    diagnose: ['main.ts', 'index.ts', 'impl.ts'],
  },

  // (g) Extensionless relative import (the common style) under bundler
  // resolution — the sibling `.ts` resolves WITHOUT an explicit extension, so
  // there is NO TS5097 (unlike the `.ts`-extension fixtures); only the TS2345
  // call error. Probes that rifty's resolver finds `./math` → `math.ts` exactly
  // like real tsc and does not spuriously add/drop the extension diagnostic.
  {
    name: 'extensionless relative import (bundler) wrong-typed argument',
    probes:
      'extensionless sibling resolution (./math → math.ts) under bundler — only TS2345, NO TS5097',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'esnext',
          target: 'es2022',
          moduleResolution: 'bundler',
        },
      }),
      'math.ts': 'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
      'main.ts': "import { add } from './math';\nadd('1', 2);\n",
    },
    diagnose: ['main.ts', 'math.ts'],
  },

  // (f) paths alias: tsconfig `paths` + `baseUrl`, used wrongly → TS2345.
  {
    name: 'paths alias (baseUrl + paths) used wrongly',
    probes: 'tsconfig paths/baseUrl alias resolution honored exactly (alias → real file, TS2345)',
    files: {
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          strict: true,
          module: 'esnext',
          target: 'es2022',
          moduleResolution: 'bundler',
          baseUrl: '.',
          paths: { '@lib/*': ['src/lib/*'] },
        },
      }),
      'src/lib/util.ts': 'export function twice(n: number): number {\n  return n * 2;\n}\n',
      'src/main.ts': "import { twice } from '@lib/util.ts';\ntwice('nope');\n",
    },
    diagnose: ['src/main.ts', 'src/lib/util.ts'],
  },
];

describe('parity: rifty TS language service vs real ts.LanguageService (gold standard)', () => {
  for (const fixture of FIXTURES) {
    it(`matches real TS — ${fixture.name} [${fixture.probes}]`, async () => {
      const root = writeFixtureToTmp(fixture);
      const gold = goldDiagnostics(fixture, root); // Side A (expectations)
      const rifty = await riftyDiagnostics(fixture); // Side B

      // Sanity: the fixture must actually exercise diagnostics (a green run on
      // zero diagnostics on both sides would be a vacuous parity pass). Every
      // fixture here is engineered to produce ≥1 gold diagnostic.
      expect(gold.length).toBeGreaterThan(0);

      // The real assertion: Side B deep-equals Side A.
      expect(rifty).toEqual(gold);
    });
  }
});
