import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { type Plugin, build } from 'vite';
import { describe, expect, test } from 'vitest';
import { QUICKSTART_SNIPPET, snippetText } from './public-snippets';

interface BuildArtifact {
  readonly type: 'asset' | 'chunk';
  readonly fileName: string;
  readonly code?: string;
}

interface ViteBuildOutput {
  readonly output: readonly BuildArtifact[];
}

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const playgroundRoot = resolve(repoRoot, 'apps/playground');
const quickStartId = 'virtual:landing-quickstart-snippet.ts';
const quickStartFile = resolve(playgroundRoot, '.landing-snippets/quickstart.ts');
const workerUrlTypesFile = resolve(playgroundRoot, '.landing-snippets/worker-url.d.ts');
const resolvedSnippetIds = new Map([[quickStartId, quickStartFile]]);
const snippetSources = new Map([
  [quickStartFile, snippetText(QUICKSTART_SNIPPET)],
  [
    workerUrlTypesFile,
    `declare module '@riftydev/runtime-js/worker?worker&url' {
  const runtimeWorkerUrl: string
  export default runtimeWorkerUrl
}`,
  ],
]);

function snippetPlugin(): Plugin {
  return {
    name: 'landing-public-snippets',
    resolveId(id) {
      return resolvedSnippetIds.get(id) ?? null;
    },
    load(id) {
      return snippetSources.get(id) ?? null;
    },
  };
}

describe('landing public snippets', () => {
  test('type-check against the current public SDK contract', () => {
    const options: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      allowImportingTsExtensions: true,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts', 'lib.webworker.d.ts'],
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      baseUrl: repoRoot,
      paths: {
        '@riftydev/sdk': ['packages/rifty/src/index.ts'],
      },
    };
    const host = ts.createCompilerHost(options);
    const readFile = host.readFile.bind(host);
    const fileExists = host.fileExists.bind(host);
    const getSourceFile = host.getSourceFile.bind(host);
    host.readFile = (fileName) => snippetSources.get(fileName) ?? readFile(fileName);
    host.fileExists = (fileName) => snippetSources.has(fileName) || fileExists(fileName);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = snippetSources.get(fileName);
      return source === undefined
        ? getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, source, languageVersion, true);
    };

    const program = ts.createProgram({
      rootNames: [quickStartFile, workerUrlTypesFile],
      options,
      host,
    });
    const diagnostics = ts.getPreEmitDiagnostics(program).map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      return diagnostic.file ? `${diagnostic.file.fileName}: ${message}` : message;
    });

    expect(diagnostics).toEqual([]);
  });

  test('compile in a Vite production build and emit the runtime Worker asset', async () => {
    const result = (await build({
      configFile: false,
      root: playgroundRoot,
      logLevel: 'silent',
      plugins: [snippetPlugin()],
      resolve: {
        alias: [
          {
            find: /^@riftydev\/sdk$/,
            replacement: resolve(repoRoot, 'packages/rifty/src/index.ts'),
          },
        ],
      },
      worker: {
        format: 'es',
      },
      build: {
        target: 'es2022',
        write: false,
        rollupOptions: {
          preserveEntrySignatures: 'strict',
          input: {
            quickstart: quickStartId,
          },
        },
      },
    })) as ViteBuildOutput | ViteBuildOutput[];

    const artifacts = (Array.isArray(result) ? result : [result]).flatMap(
      (output) => output.output,
    );
    const worker = artifacts.find((artifact) =>
      /^assets\/worker-entry-[\w-]+\.js$/.test(artifact.fileName),
    );
    const entryCode = artifacts
      .filter((artifact) => artifact.type === 'chunk')
      .map((artifact) => artifact.code ?? '')
      .join('\n');

    expect(worker).toBeDefined();
    expect(entryCode).toContain(worker?.fileName);
    expect(entryCode).not.toContain('@riftydev/runtime-js/worker');
  }, 30_000);
});
