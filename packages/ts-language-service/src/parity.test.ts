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
import type { Position, Range } from './lsp-types.ts';
import {
  partsToString,
  quickInfoToHover,
  scriptElementKindToCompletionKind,
  spanToRange,
} from './mapping.ts';
import { offsetToPosition, positionToOffset } from './position.ts';
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
 * Build a real `ts.LanguageService` over real Node fs for `root`, parsing the
 * tsconfig with tsc's own machinery (`ts.sys`). Pure tsc — no rifty code. The
 * host is returned too so the query tests can read a target file's text (to map
 * a definition span into a Range) the same way the service does.
 */
function buildGoldService(root: string): {
  service: ts.LanguageService;
  host: ts.LanguageServiceHost;
  rel: (abs: string) => string;
} {
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
  return { service, host, rel: (abs: string) => toPosixRel(root, abs) };
}

/** Collect semantic diagnostics for the requested files (gold side). */
function goldDiagnostics(fixture: Fixture, root: string): NormDiagnostic[] {
  const { service, rel } = buildGoldService(root);
  const out: NormDiagnostic[] = [];
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

/** Build the rifty service over the fixture, returning the service + its fsSync. */
async function buildRiftyService(fixture: Fixture): Promise<{
  svc: import('./service.ts').TsLanguageService;
  fsSync: ReturnType<typeof writeFixtureToVfs>;
}> {
  const fsSync = writeFixtureToVfs(fixture);
  const svc = await createTsLanguageService({ fsSync, projectRoot: RIFTY_ROOT });
  return { svc, fsSync };
}

async function riftyDiagnostics(fixture: Fixture): Promise<NormDiagnostic[]> {
  const { svc } = await buildRiftyService(fixture);
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

// ===========================================================================
// Phase 2 queries: hover / definition / type-definition / completions.
//
// Same gold-standard discipline: Side A calls the RAW `ts.LanguageService`
// (getQuickInfoAtPosition / getDefinitionAtPosition / … ) over the real-fs host
// and reduces the result with the SAME `mapping.ts` renderer the rifty service
// uses (so the comparison is rendered-vs-rendered, never renderer-vs-raw — a
// symmetric normalization that hides nothing). Side B calls rifty's new
// methods. Positions are located by an unambiguous `needle` substring so the
// fixtures stay readable.
// ===========================================================================

/** Locate the position to query: offset = (index of `needle`) + `inner`. */
interface Probe {
  readonly file: string;
  /** Unambiguous substring whose start anchors the position. */
  readonly needle: string;
  /** Offset INTO the needle (e.g. just past `.` for a member completion). */
  readonly inner: number;
}

function probePosition(text: string, probe: Probe): Position {
  const at = text.indexOf(probe.needle);
  if (at === -1) throw new Error(`probe needle not found: ${JSON.stringify(probe.needle)}`);
  if (text.indexOf(probe.needle, at + 1) !== -1)
    throw new Error(`probe needle is ambiguous: ${JSON.stringify(probe.needle)}`);
  return offsetToPosition(text, at + probe.inner);
}

/** Side A hover for a probe — RAW ts.QuickInfo rendered via the shared mapper. */
function goldHover(
  svc: ts.LanguageService,
  host: ts.LanguageServiceHost,
  abs: string,
  probe: Probe,
) {
  const text = host.readFile?.(abs) ?? '';
  const offset = positionToOffset(text, probePosition(text, probe));
  const info = svc.getQuickInfoAtPosition(abs, offset);
  return info ? quickInfoToHover(info, text) : null;
}

/** Side A definition/type-definition — map each DefinitionInfo to a Location. */
function goldDefinitions(
  defs: readonly ts.DefinitionInfo[] | undefined,
  host: ts.LanguageServiceHost,
  rel: (abs: string) => string,
): { uri: string; range: Range }[] {
  return (defs ?? []).map((d) => {
    const text = host.readFile?.(d.fileName) ?? '';
    return { uri: rel(d.fileName), range: spanToRange(text, d.textSpan) };
  });
}

/** Normalize a rifty Location[] to relative-uri for comparison with Side A. */
function relLocations(
  locs: readonly { uri: string; range: Range }[],
  riftyRel: (abs: string) => string,
): { uri: string; range: Range }[] {
  return locs.map((l) => ({ uri: riftyRel(l.uri), range: l.range }));
}

function sortLocations(locs: { uri: string; range: Range }[]): { uri: string; range: Range }[] {
  return [...locs].sort(
    (a, b) =>
      a.uri.localeCompare(b.uri) ||
      a.range.start.line - b.range.start.line ||
      a.range.start.character - b.range.start.character,
  );
}

const TS_LIB_DIR = tsLibDir();
/**
 * Gold target paths point at the real ts lib dir / tmp root; rifty's at /ts-lib
 * + /proj. Strip both to a stable tail. `ts.sys.realpath` may canonicalize the
 * tmp root (macOS `/var` → `/private/var`), so relativize against BOTH the raw
 * and realpath'd root — whichever yields a non-`..` (in-tree) result wins.
 */
function goldRel(root: string): (abs: string) => string {
  const realRoot = ts.sys.realpath ? ts.sys.realpath(root) : root;
  return (abs) => {
    if (abs.startsWith(TS_LIB_DIR)) return `lib:${nodePath.basename(abs)}`;
    for (const base of [root, realRoot]) {
      const r = toPosixRel(base, abs);
      if (!r.startsWith('..')) return r;
    }
    return toPosixRel(root, abs);
  };
}
function riftyRel(abs: string): string {
  if (abs.startsWith('/ts-lib/')) return `lib:${abs.slice('/ts-lib/'.length)}`;
  if (abs.startsWith(`${RIFTY_ROOT}/`)) return abs.slice(`${RIFTY_ROOT}/`.length);
  return abs;
}

// --- Shared fixture for the query tests (one program, many probes) ----------
const QUERY_FIXTURE: Fixture = {
  name: 'queries: hover / definition / completions',
  probes: 'cross-file + node_modules symbols for quick-info / definition / completions',
  files: {
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        module: 'esnext',
        target: 'es2022',
        moduleResolution: 'bundler',
      },
    }),
    'math.ts':
      '/** Adds two numbers. */\nexport function add(a: number, b: number): number {\n  return a + b;\n}\n',
    'node_modules/leftpad/package.json': JSON.stringify({
      name: 'leftpad',
      version: '1.0.0',
      types: 'index.d.ts',
    }),
    'node_modules/leftpad/index.d.ts':
      'export interface Padder {\n  pad(s: string, n: number): string;\n}\nexport declare const padder: Padder;\n',
    'main.ts':
      "import { add } from './math.ts';\n" +
      "import { padder } from 'leftpad';\n" +
      'const total = add(1, 2);\n' +
      'padder.pad("x", 3);\n' +
      'const arr = [1, 2, 3];\n' +
      'arr.map((n) => n);\n',
  },
  diagnose: [],
};

describe('parity: phase-2 queries vs real ts.LanguageService (gold standard)', () => {
  it('hover (quick-info) matches real TS — cross-file fn + node_modules symbol', async () => {
    const root = writeFixtureToTmp(QUERY_FIXTURE);
    const { service: gsvc, host: ghost } = buildGoldService(root);
    const { svc } = await buildRiftyService(QUERY_FIXTURE);

    // (1) cross-file function `add` at its call site; (2) node_modules `padder`.
    const probes: Probe[] = [
      { file: 'main.ts', needle: 'add(1, 2)', inner: 1 }, // cursor on `add`
      { file: 'main.ts', needle: 'padder.pad', inner: 1 }, // cursor on `padder`
    ];
    for (const probe of probes) {
      const gold = goldHover(gsvc, ghost, nodePath.join(root, probe.file), probe);
      const text = QUERY_FIXTURE.files[probe.file] ?? '';
      const pos = probePosition(text, probe);
      const rifty = svc.getQuickInfo(`${RIFTY_ROOT}/${probe.file}`, pos);
      expect(gold).not.toBeNull(); // non-vacuous: there IS quick-info here
      expect(rifty).toEqual(gold);
    }
  });

  it('definition matches real TS — cross-file + into node_modules .d.ts', async () => {
    const root = writeFixtureToTmp(QUERY_FIXTURE);
    const { service: gsvc, host: ghost } = buildGoldService(root);
    const { svc } = await buildRiftyService(QUERY_FIXTURE);
    const grel = goldRel(root);

    const probes: Probe[] = [
      { file: 'main.ts', needle: 'add(1, 2)', inner: 1 }, // → math.ts add
      { file: 'main.ts', needle: 'padder.pad', inner: 1 }, // → node_modules leftpad
    ];
    for (const probe of probes) {
      const text = QUERY_FIXTURE.files[probe.file] ?? '';
      const offset = positionToOffset(text, probePosition(text, probe));
      const goldDefs = sortLocations(
        goldDefinitions(
          gsvc.getDefinitionAtPosition(nodePath.join(root, probe.file), offset),
          ghost,
          grel,
        ),
      );
      const riftyDefs = sortLocations(
        relLocations(
          svc.getDefinition(`${RIFTY_ROOT}/${probe.file}`, probePosition(text, probe)),
          riftyRel,
        ),
      );
      expect(goldDefs.length).toBeGreaterThan(0); // non-vacuous
      expect(riftyDefs).toEqual(goldDefs);
    }
  });

  it('type-definition matches real TS — node_modules interface', async () => {
    const root = writeFixtureToTmp(QUERY_FIXTURE);
    const { service: gsvc, host: ghost } = buildGoldService(root);
    const { svc } = await buildRiftyService(QUERY_FIXTURE);
    const grel = goldRel(root);

    // `padder`'s TYPE is `Padder` (the interface in node_modules) — different
    // location from go-to-definition (which lands on the `padder` const).
    const probe: Probe = { file: 'main.ts', needle: 'padder.pad', inner: 1 };
    const text = QUERY_FIXTURE.files[probe.file] ?? '';
    const offset = positionToOffset(text, probePosition(text, probe));
    const goldDefs = sortLocations(
      goldDefinitions(
        gsvc.getTypeDefinitionAtPosition(nodePath.join(root, probe.file), offset),
        ghost,
        grel,
      ),
    );
    const riftyDefs = sortLocations(
      relLocations(
        svc.getTypeDefinition(`${RIFTY_ROOT}/${probe.file}`, probePosition(text, probe)),
        riftyRel,
      ),
    );
    expect(goldDefs.length).toBeGreaterThan(0);
    expect(riftyDefs).toEqual(goldDefs);
  });

  it('completions match real TS — member access + global, names+kinds as sets', async () => {
    const root = writeFixtureToTmp(QUERY_FIXTURE);
    const { service: gsvc } = buildGoldService(root);
    const { svc } = await buildRiftyService(QUERY_FIXTURE);

    // Member access `arr.|` and a global position (start of an expression line).
    const probes: Probe[] = [
      { file: 'main.ts', needle: 'arr.map', inner: 4 }, // after `arr.`
      { file: 'main.ts', needle: 'const total = add', inner: 14 }, // global, at `add`
    ];
    for (const probe of probes) {
      const text = QUERY_FIXTURE.files[probe.file] ?? '';
      const offset = positionToOffset(text, probePosition(text, probe));
      const goldInfo = gsvc.getCompletionsAtPosition(
        nodePath.join(root, probe.file),
        offset,
        undefined,
      );
      const riftyList = svc.getCompletions(
        `${RIFTY_ROOT}/${probe.file}`,
        probePosition(text, probe),
      );

      // Compare as sorted (name, kind) SETS — order-independent, no truncation.
      const goldSet = (goldInfo?.entries ?? [])
        .map((e) => `${e.name}\t${scriptElementKindToCompletionKind(e.kind)}`)
        .sort();
      const riftySet = riftyList.items.map((i) => `${i.label}\t${i.kind}`).sort();
      expect(goldSet.length).toBeGreaterThan(0); // non-vacuous
      expect(riftySet).toEqual(goldSet);
      expect(riftyList.isIncomplete).toBe(goldInfo?.isIncomplete === true);
    }

    // getCompletionEntryDetails probe: resolve ONE member entry's detail.
    const probe: Probe = { file: 'main.ts', needle: 'arr.map', inner: 4 };
    const text = QUERY_FIXTURE.files[probe.file] ?? '';
    const offset = positionToOffset(text, probePosition(text, probe));
    const goldDetail = gsvc.getCompletionEntryDetails(
      nodePath.join(root, probe.file),
      offset,
      'map',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    const riftyDetail = svc.getCompletionDetails(
      `${RIFTY_ROOT}/${probe.file}`,
      probePosition(text, probe),
      'map',
    );
    expect(goldDetail).not.toBeUndefined();
    expect(riftyDetail?.detail).toBe(partsToString(goldDetail?.displayParts));
    expect(riftyDetail?.label).toBe('map');
  });
});
