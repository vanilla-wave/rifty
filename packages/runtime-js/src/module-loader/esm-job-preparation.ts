import { publishRuntimeGlobal, readRuntimeGlobal } from '../internal/worker-globals.ts';
import { ModuleLoadError } from './errors.ts';
import { transformEsm } from './esm-ast.ts';
import { syncTransformCeiling } from './esm-job-state.ts';
import type { EsmDirectFactory, EsmFactory, EsmLoaderDeps, PreparedEsm } from './esm-job-types.ts';
import { assertNoEsmFunctionRoutingCeiling } from './esm.ts';
import type { ResolvedModule } from './resolver.ts';

export function transformedLoaderForId(id: string): 'ts' | 'tsx' | 'jsx' | null {
  if (id.endsWith('.tsx')) return 'tsx';
  if (id.endsWith('.ts')) return 'ts';
  if (id.endsWith('.jsx')) return 'jsx';
  return null;
}

export function transformedSource(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
): string | Promise<string> {
  const loader = transformedLoaderForId(resolved.id);
  if (!loader) return resolved.source;
  if (!deps.transformSource) {
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      resolved.id,
      `TS transform not configured for ${resolved.id}: the loader has no transformSource hook, so its .${loader} syntax cannot be stripped before parsing. Inject a transformSource on createModuleLoader (ADR-0052).`,
      resolved.id,
    );
  }
  return deps.transformSource({
    source: resolved.source,
    id: resolved.id,
    loader,
    workspace: deps.workspace,
  });
}

export function finishPreparation(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
  source: string,
  mode: 'async' | 'sync',
): PreparedEsm {
  assertNoEsmFunctionRoutingCeiling(source, resolved.id);
  const transformed = (deps.transformEsm ?? transformEsm)(source, resolved.id);
  deps.sourceMaps?.setGeneratedLineMap(resolved.id, transformed.lineMap);
  const stash: Record<string, string> = readRuntimeGlobal('esmStash') ?? {};
  stash[resolved.id] = transformed.body;
  publishRuntimeGlobal('esmStash', stash);

  const dependencies = transformed.staticImports.map((specifier) => ({
    specifier,
    resolved: deps.resolve(specifier, resolved.id, true),
  }));
  if (mode === 'sync' && transformed.hasTopLevelAwait) {
    return { resolved, transformed, dependencies };
  }
  if (
    mode === 'async' &&
    transformed.hasTopLevelAwait &&
    !transformed.needsGeneratorInstantiation
  ) {
    return {
      resolved,
      transformed,
      dependencies,
      directFactory: compileDirectEsmFactory(resolved, transformed),
    };
  }
  return {
    resolved,
    transformed,
    dependencies,
    factory: compileEsmFactory(resolved, transformed, transformed.hasTopLevelAwait),
  };
}

export function prepareLocalAsync(
  resolved: ResolvedModule,
  deps: EsmLoaderDeps,
): PreparedEsm | Promise<PreparedEsm> {
  const source = transformedSource(resolved, deps);
  return typeof source === 'string'
    ? finishPreparation(resolved, deps, source, 'async')
    : source.then((value) => finishPreparation(resolved, deps, value, 'async'));
}

export function prepareLocalSync(resolved: ResolvedModule, deps: EsmLoaderDeps): PreparedEsm {
  if (transformedLoaderForId(resolved.id)) throw syncTransformCeiling(resolved.id);
  return finishPreparation(resolved, deps, resolved.source, 'sync');
}

function compileEsmFactory(
  resolved: ResolvedModule,
  transformed: PreparedEsm['transformed'],
  asyncBody: boolean,
): EsmFactory {
  const helper = transformed.helpers;
  try {
    return new Function(
      helper.dynamicImport,
      helper.importStatic,
      helper.slots,
      '__resolveStatic',
      helper.rebuildExports,
      helper.importMetaUrl,
      helper.metaDirname,
      helper.metaFilename,
      helper.assetPath,
      helper.metaResolve,
      'Function',
      `const ${helper.runtimeObject} = Object; return (${asyncBody ? 'async ' : ''}function* () {\nconst ${helper.importMeta} = { url: ${helper.importMetaUrl}, dirname: ${helper.metaDirname}, filename: ${helper.metaFilename}, resolve: ${helper.metaResolve} }; ${transformed.instantiationBody} yield;\n${transformed.body}\n})();\n//# sourceURL=${resolved.id}`,
    ) as EsmFactory;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    publishRuntimeGlobal('esmLastBody', transformed.body);
    publishRuntimeGlobal('esmLastFile', resolved.id);
    const stack = (error as Error).stack ?? '';
    const match = /<anonymous>:(\d+):(\d+)/.exec(stack);
    const around = match
      ? snippetForBody(transformed.body, Number(match[1]), Number(match[2]))
      : `\n(no offset in stack; body length=${transformed.body.length}, stashed at globalThis.__rifty.esmLastBody)`;
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      resolved.id,
      `Failed to wrap transformed ESM body for ${resolved.id}: ${message}${around}`,
      resolved.id,
    );
  }
}

function compileDirectEsmFactory(
  resolved: ResolvedModule,
  transformed: PreparedEsm['transformed'],
): EsmDirectFactory {
  const helper = transformed.helpers;
  try {
    return new Function(
      helper.dynamicImport,
      helper.importStatic,
      helper.slots,
      '__resolveStatic',
      helper.rebuildExports,
      helper.importMetaUrl,
      helper.metaDirname,
      helper.metaFilename,
      helper.assetPath,
      helper.metaResolve,
      'Function',
      `const ${helper.runtimeObject} = Object; return (async function () {
const ${helper.importMeta} = { url: ${helper.importMetaUrl}, dirname: ${helper.metaDirname}, filename: ${helper.metaFilename}, resolve: ${helper.metaResolve} }; ${transformed.instantiationBody}
${transformed.body}
})();
//# sourceURL=${resolved.id}`,
    ) as EsmDirectFactory;
  } catch (error) {
    const message = (error as Error).message ?? String(error);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      resolved.id,
      `Failed to wrap transformed ESM body for ${resolved.id}: ${message}`,
      resolved.id,
    );
  }
}

function snippetForBody(body: string, line: number, _col: number): string {
  const bodyLine = line - 2;
  const lines = body.split('\n');
  const start = Math.max(0, bodyLine - 4);
  const end = Math.min(lines.length, bodyLine + 4);
  const numbered = lines
    .slice(start, end)
    .map((text, index) => {
      const lineNumber = start + index;
      const marker = lineNumber === bodyLine - 1 ? '>> ' : '   ';
      const display = text.length > 200 ? `${text.slice(0, 200)}…` : text;
      return `${marker}${String(lineNumber + 1).padStart(5, ' ')} | ${display}`;
    })
    .join('\n');
  return `\nNear body line ${bodyLine}:\n${numbered}`;
}
