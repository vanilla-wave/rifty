import type { TransformResult } from './esm-ast.ts';

export type EsmFactory = (...args: unknown[]) => Promise<void>;

const SafeFunction = Function;
const SafeObject = Object;
const safeObjectCreate = Object.create.bind(Object);
const safeReflectApply = Reflect.apply.bind(Reflect);
const safeReflectConstruct = Reflect.construct.bind(Reflect);

interface MutableArgumentList<T> {
  length: number;
  [index: number]: T;
}

function argumentList<T>(length: number): MutableArgumentList<T> {
  const list = safeObjectCreate(null) as MutableArgumentList<T>;
  list.length = length;
  return list;
}

function factoryArgumentNames(transformed: TransformResult): MutableArgumentList<string> {
  const helper = transformed.helpers;
  const names = argumentList<string>(12);
  names[0] = helper.dynamicImport;
  names[1] = helper.importStatic;
  names[2] = helper.slots;
  names[3] = '__resolveStatic';
  names[4] = helper.rebuildExports;
  names[5] = helper.importMetaUrl;
  names[6] = helper.metaDirname;
  names[7] = helper.metaFilename;
  names[8] = helper.assetPath;
  names[9] = helper.metaResolve;
  names[10] = 'Function';
  names[11] = helper.runtimeObject;
  return names;
}

function assertNoExactHelperCollision(
  transformed: TransformResult,
  helperNames: MutableArgumentList<string>,
  importName: string,
): void {
  for (let index = 0; index < helperNames.length; index += 1) {
    if (importName === helperNames[index]) {
      throw new TypeError(
        `Exact ESM module binding import collides with loader helper: ${importName}`,
      );
    }
  }
  if (importName === transformed.helpers.importMeta) {
    throw new TypeError(
      `Exact ESM module binding import collides with loader helper: ${importName}`,
    );
  }
}

function assertNoExactModuleBindingCollision(
  transformed: TransformResult,
  exactImportNames: readonly string[],
): void {
  for (let importIndex = 0; importIndex < exactImportNames.length; importIndex += 1) {
    const importName = exactImportNames[importIndex] as string;
    for (
      let bindingIndex = 0;
      bindingIndex < transformed.moduleBindings.length;
      bindingIndex += 1
    ) {
      if (importName !== transformed.moduleBindings[bindingIndex]) continue;
      throw new TypeError(
        `Exact ESM module binding import collides with module binding: ${importName}`,
      );
    }
  }
}

function joinedNames(names: readonly string[]): string {
  let joined = '';
  for (let index = 0; index < names.length; index += 1) {
    if (index !== 0) joined += ',';
    joined += names[index] as string;
  }
  return joined;
}

/** Build and syntax-check the real ESM wrapper from one transformed body. */
export function createEsmFactory(
  transformed: TransformResult,
  id: string,
  exactImportNames: readonly string[] = [],
): EsmFactory {
  const helperNames = factoryArgumentNames(transformed);
  for (let index = 0; index < exactImportNames.length; index += 1) {
    assertNoExactHelperCollision(transformed, helperNames, exactImportNames[index] as string);
  }
  assertNoExactModuleBindingCollision(transformed, exactImportNames);

  const constructorArguments = argumentList<string>(
    helperNames.length + exactImportNames.length + 1,
  );
  for (let index = 0; index < helperNames.length; index += 1) {
    constructorArguments[index] = helperNames[index] as string;
  }
  for (let index = 0; index < exactImportNames.length; index += 1) {
    constructorArguments[helperNames.length + index] = exactImportNames[index] as string;
  }
  const helper = transformed.helpers;
  const exactParameters = joinedNames(exactImportNames);
  constructorArguments[constructorArguments.length - 1] =
    `"use strict"; return (async (${exactParameters}) => {\nconst ${helper.importMeta} = { url: ${helper.importMetaUrl}, dirname: ${helper.metaDirname}, filename: ${helper.metaFilename}, resolve: ${helper.metaResolve} };\n${transformed.body}\n})(${exactParameters});\n//# sourceURL=${id}`;
  try {
    return safeReflectConstruct(SafeFunction, constructorArguments) as EsmFactory;
  } catch (error) {
    if (exactImportNames.length === 0) throw error;
    const message = (error as Error).message ?? String(error);
    throw new TypeError(
      `Exact ESM module binding factory collides with transformed module scope or is invalid: ${message}`,
    );
  }
}

/** Invoke without consulting guest-replaceable Array iteration or Reflect.apply. */
export function invokeEsmFactory(
  factory: EsmFactory,
  standardArguments: readonly unknown[],
  exactArguments: readonly unknown[] = [],
): Promise<void> {
  const args = argumentList<unknown>(standardArguments.length + exactArguments.length + 1);
  for (let index = 0; index < standardArguments.length; index += 1) {
    args[index] = standardArguments[index];
  }
  args[standardArguments.length] = SafeObject;
  for (let index = 0; index < exactArguments.length; index += 1) {
    args[standardArguments.length + 1 + index] = exactArguments[index];
  }
  return safeReflectApply(factory, undefined, args) as Promise<void>;
}
