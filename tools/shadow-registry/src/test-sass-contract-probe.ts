export interface SassCompileResult {
  readonly css: string;
  readonly loadedUrls: readonly URL[];
  readonly sourceMap?: unknown;
}

export interface SassCompiler {
  compile(path: string, options?: unknown): SassCompileResult;
  compileString(source: string, options?: unknown): SassCompileResult;
  dispose(): unknown;
}

export interface SassAsyncCompiler {
  compileAsync(path: string, options?: unknown): Promise<SassCompileResult>;
  compileStringAsync(source: string, options?: unknown): Promise<SassCompileResult>;
  dispose(): Promise<unknown>;
}

export interface SassContractApi {
  readonly info: string;
  readonly Compiler: abstract new (...args: readonly unknown[]) => SassCompiler;
  readonly AsyncCompiler: abstract new (...args: readonly unknown[]) => SassAsyncCompiler;
  compileString(source: string, options?: unknown): SassCompileResult;
  compileStringAsync(source: string, options?: unknown): Promise<SassCompileResult>;
  initCompiler(): SassCompiler;
  initAsyncCompiler(): Promise<SassAsyncCompiler>;
  renderSync(options: unknown): {
    readonly css: Uint8Array;
    readonly stats: Readonly<Record<string, unknown>>;
  };
}

export interface SassContractModules {
  readonly cjs: SassContractApi & Readonly<Record<string, unknown>>;
  readonly esm: Readonly<Record<string, unknown>>;
}

export interface SassContractProbeOptions {
  readonly compilerPath: string;
  normalizeCompilerUrl(url: URL): string;
}

interface SourceLocationTranscript {
  readonly offset: number | null;
  readonly line: number | null;
  readonly column: number | null;
}

interface SourceSpanTranscript {
  readonly text: string | null;
  readonly context: string | null;
  readonly urlType: string;
  readonly url: string | null;
  readonly start: SourceLocationTranscript;
  readonly end: SourceLocationTranscript;
}

interface ErrorTranscript {
  readonly name: string | null;
  readonly message: string | null;
  readonly toString: string;
  readonly sassMessage: string | null;
  readonly sassStack: string | null;
  readonly span: SourceSpanTranscript | null;
}

interface CompileTranscript {
  readonly css: string;
  readonly loadedUrls: readonly string[];
  readonly hasSourceMap: boolean;
  readonly sourceMapJson: string | null;
}

interface WarningTranscript {
  readonly message: string;
  readonly deprecation: boolean | null;
  readonly deprecationId: string | null;
  readonly stack: string | null;
  readonly span: SourceSpanTranscript | null;
}

interface CompilerIdentityTranscript {
  readonly directPrototypeIsExportPrototype: boolean;
  readonly constructorIsExport: boolean;
  readonly constructorStable: boolean;
  readonly prototypeConstructorIsExport: boolean;
  readonly prototypeHasOwnConstructor: boolean;
  readonly prototypeConstructorDescriptor: PropertyDescriptorTranscript;
  readonly constructorName: string | null;
  readonly constructorLength: number | null;
  readonly constructorPrototypeWritable: boolean | null;
  readonly compileMethod: MethodIdentityTranscript;
  readonly compileStringMethod: MethodIdentityTranscript;
  readonly disposeMethod: MethodIdentityTranscript;
}

interface MethodIdentityTranscript {
  readonly name: string | null;
  readonly length: number | null;
  readonly stable: boolean;
  readonly instanceIsPrototypeMethod: boolean;
  readonly prototypeHasOwnMethod: boolean;
  readonly prototypeDescriptor: PropertyDescriptorTranscript;
}

interface PropertyDescriptorTranscript {
  readonly kind: 'accessor' | 'data' | 'missing';
  readonly enumerable: boolean | null;
  readonly configurable: boolean | null;
  readonly writable: boolean | null;
  readonly hasGetter: boolean;
  readonly hasSetter: boolean;
}

interface ReflectionOperationTranscript {
  readonly value: unknown;
  readonly error: ErrorTranscript | null;
}

interface CompilerReflectionTranscript {
  readonly ownKeys: ReflectionOperationTranscript;
  readonly getKinds: ReflectionOperationTranscript;
  readonly hasKeys: ReflectionOperationTranscript;
  readonly descriptors: ReflectionOperationTranscript;
}

export interface SassContractTranscript {
  readonly schema: 2;
  readonly oracle: 'sass@1.100.0' | 'sass-embedded@1.100.0';
  readonly version: string;
  readonly rows: Readonly<{
    module: Readonly<{
      cjsKeys: readonly string[];
      esmKeys: readonly string[];
      esmDefaultKeys: readonly string[];
      undefinedEsmExports: readonly string[];
      cjsToEsmIdentity: readonly string[];
      esmNamedToDefaultIdentity: readonly string[];
      cjsLifecycleExportDescriptors: Readonly<Record<string, PropertyDescriptorTranscript>>;
      esmDefaultLifecycleExportDescriptors: Readonly<Record<string, PropertyDescriptorTranscript>>;
    }>;
    compile: Readonly<{
      sync: CompileTranscript;
      async: CompileTranscript;
    }>;
    sourceMap: Readonly<{
      sync: CompileTranscript;
      async: CompileTranscript;
    }>;
    lifecycle: Readonly<{
      syncDirectConstruction: ErrorTranscript;
      syncInstance: boolean;
      syncIdentity: CompilerIdentityTranscript;
      syncReflection: Readonly<{
        cjs: CompilerReflectionTranscript;
        esm: CompilerReflectionTranscript;
      }>;
      syncPathFirst: CompileTranscript;
      syncPathSecond: CompileTranscript;
      syncFirst: CompileTranscript;
      syncSecond: CompileTranscript;
      syncDisposeReturnKind: string;
      syncPostDisposePath: ErrorTranscript;
      syncPostDisposeString: ErrorTranscript;
      asyncDirectConstruction: ErrorTranscript;
      asyncInstance: boolean;
      asyncIdentity: CompilerIdentityTranscript;
      asyncReflection: Readonly<{
        cjs: CompilerReflectionTranscript;
        esm: CompilerReflectionTranscript;
      }>;
      asyncPathFirst: CompileTranscript;
      asyncPathSecond: CompileTranscript;
      asyncFirst: CompileTranscript;
      asyncSecond: CompileTranscript;
      asyncDisposeReturnKind: string;
      asyncDisposeResolvedKind: string;
      asyncPostDisposePath: ErrorTranscript;
      asyncPostDisposeString: ErrorTranscript;
    }>;
    importers: Readonly<{
      sync: CompileTranscript;
      syncTrace: readonly string[];
      async: CompileTranscript;
      asyncTrace: readonly string[];
    }>;
    logger: Readonly<{
      result: CompileTranscript;
      warnings: readonly WarningTranscript[];
    }>;
    errors: Readonly<{
      syntax: ErrorTranscript;
      missingUse: ErrorTranscript;
    }>;
    legacy: Readonly<{
      css: string;
      statsKeys: readonly string[];
      warnings: readonly WarningTranscript[];
      stderr: string;
    }>;
  }>;
}

const constructorLivenessGap: ErrorTranscript = {
  name: 'NotImplementedError',
  message: 'Not implemented: sass-embedded.compiler-construction-liveness',
  toString: 'NotImplementedError: Not implemented: sass-embedded.compiler-construction-liveness',
  sassMessage: null,
  sassStack: null,
  span: null,
};

const compilerInternalReflectionGap: ErrorTranscript = {
  name: 'NotImplementedError',
  message: 'Not implemented: sass-embedded.compiler-internal-reflection',
  toString: 'NotImplementedError: Not implemented: sass-embedded.compiler-internal-reflection',
  sassMessage: null,
  sassStack: null,
  span: null,
};

const reflectionGapOperation = (): ReflectionOperationTranscript => ({
  value: null,
  error: compilerInternalReflectionGap,
});

const compilerReflectionGap = (): CompilerReflectionTranscript => ({
  ownKeys: reflectionGapOperation(),
  getKinds: reflectionGapOperation(),
  hasKeys: reflectionGapOperation(),
  descriptors: reflectionGapOperation(),
});

export function sassFacadeContract(embedded: SassContractTranscript): SassContractTranscript {
  return {
    ...embedded,
    rows: {
      ...embedded.rows,
      lifecycle: {
        ...embedded.rows.lifecycle,
        syncDirectConstruction: constructorLivenessGap,
        syncReflection: { cjs: compilerReflectionGap(), esm: compilerReflectionGap() },
        asyncDirectConstruction: constructorLivenessGap,
        asyncReflection: { cjs: compilerReflectionGap(), esm: compilerReflectionGap() },
      },
    },
  };
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function sourceLocation(value: unknown): SourceLocationTranscript {
  const location = objectValue(value);
  return {
    offset: numberValue(location?.offset),
    line: numberValue(location?.line),
    column: numberValue(location?.column),
  };
}

function sourceSpan(value: unknown): SourceSpanTranscript | null {
  const span = objectValue(value);
  if (!span) return null;
  return {
    text: stringValue(span.text),
    context: stringValue(span.context),
    urlType: typeof span.url,
    url: span.url == null ? null : String(span.url),
    start: sourceLocation(span.start),
    end: sourceLocation(span.end),
  };
}

function errorTranscript(error: unknown): ErrorTranscript {
  const value = objectValue(error);
  return {
    name: stringValue(value?.name),
    message: stringValue(value?.message),
    toString: String(error),
    sassMessage: stringValue(value?.sassMessage),
    sassStack: stringValue(value?.sassStack),
    span: sourceSpan(value?.span),
  };
}

async function caught(run: () => unknown | Promise<unknown>): Promise<ErrorTranscript> {
  try {
    await run();
  } catch (error) {
    return errorTranscript(error);
  }
  throw new Error('Sass contract expected an error');
}

function compileTranscript(
  result: SassCompileResult,
  normalizeUrl: (url: URL) => string = String,
): CompileTranscript {
  return {
    css: result.css,
    loadedUrls: result.loadedUrls.map(normalizeUrl),
    hasSourceMap: Object.hasOwn(result, 'sourceMap'),
    sourceMapJson: result.sourceMap === undefined ? null : JSON.stringify(result.sourceMap),
  };
}

function returnKind(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Promise) return 'promise';
  return typeof value;
}

function warningTranscript(message: string, options: unknown): WarningTranscript {
  const value = objectValue(options);
  const deprecationType = objectValue(value?.deprecationType);
  return {
    message,
    deprecation: booleanValue(value?.deprecation),
    deprecationId: stringValue(deprecationType?.id),
    stack: stringValue(value?.stack),
    span: sourceSpan(value?.span),
  };
}

function contractLogger(target: WarningTranscript[]) {
  return {
    warn(message: string, options: unknown): void {
      target.push(warningTranscript(message, options));
    },
    debug(): void {},
  };
}

function contractImporter(trace: string[], asynchronous: boolean) {
  const canonicalize = (url: string, context: unknown): URL | Promise<URL> => {
    const value = objectValue(context);
    trace.push(`canonicalize:${url}:${String(value?.fromImport)}:${String(value?.containingUrl)}`);
    const result = new URL('contract:tokens');
    return asynchronous ? Promise.resolve(result) : result;
  };
  const load = (url: URL) => {
    trace.push(`load:${String(url)}`);
    const result = { contents: '$accent: #123456;', syntax: 'scss' };
    return asynchronous ? Promise.resolve(result) : result;
  };
  return { canonicalize, load };
}

function captureStderr<T>(run: () => T): { readonly value: T; readonly stderr: string } {
  const writeDescriptor = Object.getOwnPropertyDescriptor(process.stderr, 'write');
  const warnDescriptor = Object.getOwnPropertyDescriptor(console, 'warn');
  let stderr = '';
  Object.defineProperty(process.stderr, 'write', {
    configurable: true,
    value(chunk: unknown): boolean {
      stderr += String(chunk);
      return true;
    },
  });
  Object.defineProperty(console, 'warn', {
    configurable: true,
    value(...values: readonly unknown[]): void {
      stderr += `${values.map(String).join(' ')}\n`;
    },
  });
  try {
    return { value: run(), stderr };
  } finally {
    if (writeDescriptor) Object.defineProperty(process.stderr, 'write', writeDescriptor);
    else Reflect.deleteProperty(process.stderr, 'write');
    if (warnDescriptor) Object.defineProperty(console, 'warn', warnDescriptor);
    else Reflect.deleteProperty(console, 'warn');
  }
}

function propertyDescriptorTranscript(
  descriptor: PropertyDescriptor | undefined,
): PropertyDescriptorTranscript {
  if (descriptor === undefined) {
    return {
      kind: 'missing',
      enumerable: null,
      configurable: null,
      writable: null,
      hasGetter: false,
      hasSetter: false,
    };
  }
  return {
    kind: 'value' in descriptor ? 'data' : 'accessor',
    enumerable: descriptor.enumerable ?? false,
    configurable: descriptor.configurable ?? false,
    writable: typeof descriptor.writable === 'boolean' ? descriptor.writable : null,
    hasGetter: typeof descriptor.get === 'function',
    hasSetter: typeof descriptor.set === 'function',
  };
}

function moduleRow(modules: SassContractModules) {
  const cjsKeys = Object.keys(modules.cjs).sort();
  const esmKeys = Object.keys(modules.esm).sort();
  const esmDefault = objectValue(modules.esm.default);
  if (!esmDefault) throw new Error('Sass contract: ESM default export is missing');
  const lifecycleExports = ['Compiler', 'AsyncCompiler', 'initCompiler', 'initAsyncCompiler'];
  const exportDescriptors = (
    namespace: Readonly<Record<string, unknown>>,
  ): Readonly<Record<string, PropertyDescriptorTranscript>> =>
    Object.fromEntries(
      lifecycleExports.map((key) => [
        key,
        propertyDescriptorTranscript(Reflect.getOwnPropertyDescriptor(namespace, key)),
      ]),
    );
  return {
    cjsKeys,
    esmKeys,
    esmDefaultKeys: Object.keys(esmDefault).sort(),
    undefinedEsmExports: esmKeys.filter(
      (key) => key !== 'default' && modules.esm[key] === undefined,
    ),
    cjsToEsmIdentity: cjsKeys.filter((key) => modules.cjs[key] === modules.esm[key]),
    esmNamedToDefaultIdentity: esmKeys.filter(
      (key) => key !== 'default' && modules.esm[key] === esmDefault[key],
    ),
    cjsLifecycleExportDescriptors: exportDescriptors(modules.cjs),
    esmDefaultLifecycleExportDescriptors: exportDescriptors(esmDefault),
  };
}

function methodIdentity(
  compiler: object,
  prototype: object | null,
  method: string,
): MethodIdentityTranscript {
  const value = Reflect.get(compiler, method);
  const descriptor =
    prototype === null ? undefined : Reflect.getOwnPropertyDescriptor(prototype, method);
  return {
    name: typeof value === 'function' ? value.name : null,
    length: typeof value === 'function' ? value.length : null,
    stable: value === Reflect.get(compiler, method),
    instanceIsPrototypeMethod: prototype !== null && value === Reflect.get(prototype, method),
    prototypeHasOwnMethod: descriptor !== undefined,
    prototypeDescriptor: propertyDescriptorTranscript(descriptor),
  };
}

function compilerIdentity(
  compiler: object,
  Constructor: abstract new (...args: readonly unknown[]) => object,
  compileMethod: string,
  compileStringMethod: string,
): CompilerIdentityTranscript {
  const prototype = Reflect.getPrototypeOf(compiler);
  const exportedPrototype = Reflect.get(Constructor, 'prototype') as object;
  const constructor = Reflect.get(compiler, 'constructor');
  const prototypeDescriptor = Reflect.getOwnPropertyDescriptor(Constructor, 'prototype');
  const prototypeConstructorDescriptor =
    prototype === null ? undefined : Reflect.getOwnPropertyDescriptor(prototype, 'constructor');
  return {
    directPrototypeIsExportPrototype: prototype === exportedPrototype,
    constructorIsExport: constructor === Constructor,
    constructorStable: constructor === Reflect.get(compiler, 'constructor'),
    prototypeConstructorIsExport:
      prototype !== null && Reflect.get(prototype, 'constructor') === Constructor,
    prototypeHasOwnConstructor: prototypeConstructorDescriptor !== undefined,
    prototypeConstructorDescriptor: propertyDescriptorTranscript(prototypeConstructorDescriptor),
    constructorName: typeof Constructor.name === 'string' ? Constructor.name : null,
    constructorLength: typeof Constructor.length === 'number' ? Constructor.length : null,
    constructorPrototypeWritable:
      typeof prototypeDescriptor?.writable === 'boolean' ? prototypeDescriptor.writable : null,
    compileMethod: methodIdentity(compiler, prototype, compileMethod),
    compileStringMethod: methodIdentity(compiler, prototype, compileStringMethod),
    disposeMethod: methodIdentity(compiler, prototype, 'dispose'),
  };
}

const syncEmbeddedInternalKeys = [
  'process',
  'compilationId',
  'dispatchers',
  'stdout$',
  'stderr$',
  'disposed',
  'messageTransformer',
] as const;

const asyncEmbeddedInternalKeys = [
  'process',
  'compilationId',
  'compilations',
  'disposed',
  'messageTransformer',
  'exit$',
  'stdout$',
  'stderr$',
] as const;

function reflectionOperation(run: () => unknown): ReflectionOperationTranscript {
  try {
    return { value: run(), error: null };
  } catch (error) {
    return { value: null, error: errorTranscript(error) };
  }
}

function compilerReflection(
  compiler: object,
  internalKeys: readonly string[],
): CompilerReflectionTranscript {
  return {
    ownKeys: reflectionOperation(() =>
      Reflect.ownKeys(compiler).map((key) => (typeof key === 'symbol' ? String(key) : key)),
    ),
    getKinds: reflectionOperation(() =>
      Object.fromEntries(internalKeys.map((key) => [key, returnKind(Reflect.get(compiler, key))])),
    ),
    hasKeys: reflectionOperation(() => internalKeys.filter((key) => Reflect.has(compiler, key))),
    descriptors: reflectionOperation(() =>
      Object.fromEntries(
        internalKeys.map((key) => [
          key,
          propertyDescriptorTranscript(Reflect.getOwnPropertyDescriptor(compiler, key)),
        ]),
      ),
    ),
  };
}

export async function probeSassContract(
  modules: SassContractModules,
  oracle: SassContractTranscript['oracle'],
  options: SassContractProbeOptions,
): Promise<SassContractTranscript> {
  const esmApi = modules.esm as unknown as SassContractApi;
  const basicSource = '$accent: #123456;\n.card { color: $accent; }\n';
  const basicOptions = { url: new URL('file:///contract/basic.scss') };
  const compileSync = compileTranscript(modules.cjs.compileString(basicSource, basicOptions));
  const compileAsync = compileTranscript(
    await modules.cjs.compileStringAsync(basicSource, basicOptions),
  );

  const mapSource = '.mapped { color: #123456; }\n';
  const mapOptions = {
    url: new URL('file:///contract/mapped.scss'),
    sourceMap: true,
    sourceMapIncludeSources: true,
  };
  const sourceMapSync = compileTranscript(modules.cjs.compileString(mapSource, mapOptions));
  const sourceMapAsync = compileTranscript(
    await modules.cjs.compileStringAsync(mapSource, mapOptions),
  );

  const syncDirectConstruction = await caught(() => Reflect.construct(modules.cjs.Compiler, []));
  const asyncDirectConstruction = await caught(() =>
    Reflect.construct(modules.cjs.AsyncCompiler, []),
  );

  const syncCompiler = modules.cjs.initCompiler();
  const syncInstance = syncCompiler instanceof modules.cjs.Compiler;
  const syncIdentity = compilerIdentity(
    syncCompiler,
    modules.cjs.Compiler,
    'compile',
    'compileString',
  );
  const esmSyncCompiler = esmApi.initCompiler();
  const syncReflection = {
    cjs: compilerReflection(syncCompiler, syncEmbeddedInternalKeys),
    esm: compilerReflection(esmSyncCompiler, syncEmbeddedInternalKeys),
  };
  esmSyncCompiler.dispose();
  const syncPathFirst = compileTranscript(
    syncCompiler.compile(options.compilerPath),
    options.normalizeCompilerUrl,
  );
  const syncPathSecond = compileTranscript(
    syncCompiler.compile(options.compilerPath),
    options.normalizeCompilerUrl,
  );
  const syncFirst = compileTranscript(syncCompiler.compileString('.one { order: 1; }'));
  const syncSecond = compileTranscript(syncCompiler.compileString('.two { order: 2; }'));
  const syncDispose = syncCompiler.dispose();
  const syncPostDisposePath = await caught(() => syncCompiler.compile(options.compilerPath));
  const syncPostDisposeString = await caught(() =>
    syncCompiler.compileString('.late { order: 3; }'),
  );

  const asyncCompiler = await modules.cjs.initAsyncCompiler();
  const asyncInstance = asyncCompiler instanceof modules.cjs.AsyncCompiler;
  const asyncIdentity = compilerIdentity(
    asyncCompiler,
    modules.cjs.AsyncCompiler,
    'compileAsync',
    'compileStringAsync',
  );
  const esmAsyncCompiler = await esmApi.initAsyncCompiler();
  const asyncReflection = {
    cjs: compilerReflection(asyncCompiler, asyncEmbeddedInternalKeys),
    esm: compilerReflection(esmAsyncCompiler, asyncEmbeddedInternalKeys),
  };
  await esmAsyncCompiler.dispose();
  const asyncPathFirst = compileTranscript(
    await asyncCompiler.compileAsync(options.compilerPath),
    options.normalizeCompilerUrl,
  );
  const asyncPathSecond = compileTranscript(
    await asyncCompiler.compileAsync(options.compilerPath),
    options.normalizeCompilerUrl,
  );
  const asyncFirst = compileTranscript(
    await asyncCompiler.compileStringAsync('.one { order: 1; }'),
  );
  const asyncSecond = compileTranscript(
    await asyncCompiler.compileStringAsync('.two { order: 2; }'),
  );
  const asyncDispose = asyncCompiler.dispose();
  const asyncDisposeResolved = await asyncDispose;
  const asyncPostDisposePath = await caught(() => asyncCompiler.compileAsync(options.compilerPath));
  const asyncPostDisposeString = await caught(() =>
    asyncCompiler.compileStringAsync('.late { order: 3; }'),
  );

  const importerSource = "@use 'tokens';\n.imported { color: tokens.$accent; }\n";
  const syncTrace: string[] = [];
  const importerSync = compileTranscript(
    modules.cjs.compileString(importerSource, {
      url: new URL('file:///contract/importer.scss'),
      importers: [contractImporter(syncTrace, false)],
    }),
  );
  const asyncTrace: string[] = [];
  const importerAsync = compileTranscript(
    await modules.cjs.compileStringAsync(importerSource, {
      url: new URL('file:///contract/importer.scss'),
      importers: [contractImporter(asyncTrace, true)],
    }),
  );

  const warnings: WarningTranscript[] = [];
  const loggerResult = compileTranscript(
    modules.cjs.compileString('@warn "capsule warning";\n.warning { width: (12px / 4); }\n', {
      url: new URL('file:///contract/logger.scss'),
      logger: contractLogger(warnings),
    }),
  );

  const syntaxError = await caught(() => modules.cjs.compileString('a { color: red;'));
  const missingUseError = await caught(() =>
    modules.cjs.compileString("@use 'does-not-exist';", {
      url: new URL('file:///contract/missing-use.scss'),
    }),
  );

  const legacyWarnings: WarningTranscript[] = [];
  const legacyCapture = captureStderr(() =>
    modules.cjs.renderSync({
      data: '@warn "legacy warning";\n.legacy { color: #123456; }\n',
      logger: contractLogger(legacyWarnings),
    }),
  );
  const legacy = legacyCapture.value;

  return {
    schema: 2,
    oracle,
    version: modules.cjs.info,
    rows: {
      module: moduleRow(modules),
      compile: { sync: compileSync, async: compileAsync },
      sourceMap: { sync: sourceMapSync, async: sourceMapAsync },
      lifecycle: {
        syncDirectConstruction,
        syncInstance,
        syncIdentity,
        syncReflection,
        syncPathFirst,
        syncPathSecond,
        syncFirst,
        syncSecond,
        syncDisposeReturnKind: returnKind(syncDispose),
        syncPostDisposePath,
        syncPostDisposeString,
        asyncDirectConstruction,
        asyncInstance,
        asyncIdentity,
        asyncReflection,
        asyncPathFirst,
        asyncPathSecond,
        asyncFirst,
        asyncSecond,
        asyncDisposeReturnKind: returnKind(asyncDispose),
        asyncDisposeResolvedKind: returnKind(asyncDisposeResolved),
        asyncPostDisposePath,
        asyncPostDisposeString,
      },
      importers: {
        sync: importerSync,
        syncTrace,
        async: importerAsync,
        asyncTrace,
      },
      logger: { result: loggerResult, warnings },
      errors: { syntax: syntaxError, missingUse: missingUseError },
      legacy: {
        css: new TextDecoder().decode(legacy.css),
        statsKeys: Object.keys(legacy.stats).sort(),
        warnings: legacyWarnings,
        stderr: legacyCapture.stderr,
      },
    },
  };
}
