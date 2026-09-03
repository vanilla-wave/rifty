import { NotImplementedError } from '@riftydev/io';
import type { ImportExpression, Program } from 'acorn';
import { parse as acornParse } from 'acorn';
import { rewriteDirectEvalImportArgument } from './direct-eval-import.ts';
import { ModuleLoadError } from './errors.ts';

type DynamicImport = (specifier: unknown) => Promise<Record<string, unknown>>;
type RuntimeCompiledFunction = (...args: unknown[]) => unknown;

type RuntimeFunctionConstructor = {
  (...args: unknown[]): RuntimeCompiledFunction;
  new (...args: unknown[]): RuntimeCompiledFunction;
  prototype: RuntimeCompiledFunction;
  readonly name: string;
  readonly length: number;
};

export interface RoutedFunctionConstructors {
  readonly Function: RuntimeFunctionConstructor;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

interface AnyNodeShape {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly [key: string]: unknown;
}

type ReflectMethodName = 'apply' | 'construct' | 'get' | 'getOwnPropertyDescriptor';

interface ReflectMethodAliases {
  readonly apply: Set<string>;
  readonly construct: Set<string>;
  readonly get: Set<string>;
  readonly getOwnPropertyDescriptor: Set<string>;
}

type ObjectMethodName = 'getOwnPropertyDescriptor' | 'getOwnPropertyDescriptors';

interface ObjectMethodAliases {
  readonly getOwnPropertyDescriptor: Set<string>;
  readonly getOwnPropertyDescriptors: Set<string>;
}

const importToken = /\bimport\b/;
const dynamicScopeToken = /\beval\b|\bwith\b/;

const RealFunction = Function as unknown as RuntimeFunctionConstructor;

export function createFunctionImportRouting(
  dynamicImport: DynamicImport,
  baseId: string,
): RoutedFunctionConstructors {
  return {
    Function: makeRoutedConstructor(RealFunction, dynamicImport, baseId),
  };
}

function makeRoutedConstructor(
  realConstructor: RuntimeFunctionConstructor,
  dynamicImport: DynamicImport,
  baseId: string,
): RuntimeFunctionConstructor {
  return new Proxy(realConstructor, {
    apply(target, thisArg, rawArgs) {
      return routeOrCompile(rawArgs, dynamicImport, baseId, (args) =>
        Reflect.apply(target, thisArg, args),
      );
    },
    construct(target, rawArgs, newTarget) {
      return routeOrCompile(rawArgs, dynamicImport, baseId, (args) =>
        Reflect.construct(target, args, newTarget),
      );
    },
  }) as RuntimeFunctionConstructor;
}

function routeOrCompile(
  rawArgs: readonly unknown[],
  dynamicImport: DynamicImport,
  baseId: string,
  fallback: (args: readonly string[]) => RuntimeCompiledFunction,
): RuntimeCompiledFunction {
  const args = rawArgs.map(toFunctionSourceString);
  const body = args.length === 0 ? '' : (args[args.length - 1] ?? '');

  const params = args.slice(0, -1);
  const helperName = uniqueHelperName(args, '__riftyDynamicImport');
  const rewritten = rewriteConstructedSource(
    params,
    body,
    baseId,
    helperName,
    args.some((arg) => importToken.test(arg)),
  );
  if (rewritten === null) return fallback(args);
  const source = `return ${rewritten}`;
  const factory = RealFunction(helperName, source) as (
    importer: DynamicImport,
  ) => RuntimeCompiledFunction;
  return factory(dynamicImport);
}

function toFunctionSourceString(value: unknown): string {
  return `${value}`;
}

function uniqueHelperName(sourceParts: readonly string[], base: string): string {
  let candidate = base;
  let suffix = 0;
  while (sourceParts.some((part) => part.includes(candidate))) {
    suffix++;
    candidate = `${base}${suffix}`;
  }
  return candidate;
}

function rewriteConstructedSource(
  params: readonly string[],
  body: string,
  baseId: string,
  helperName: string,
  reportParseError: boolean,
): string | null {
  // TODO(backlog: runtime-js/function-constructor-exhaustive-metaprogramming-ceiling):
  // covers documented static Function/eval import paths, not every metaprogrammed alias graph.
  const header = `function anonymous(${params.join(',')}) {\n`;
  const wrapped = `${header}${body}\n}`;
  let program: Program;
  try {
    program = acornParse(wrapped, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: false,
      locations: false,
    }) as Program;
  } catch (err) {
    if (!reportParseError) return null;
    const msg = (err as Error).message ?? String(err);
    throw new ModuleLoadError(
      'SYNTAX_ERROR',
      baseId,
      `Failed to parse Function constructor body for ${baseId}: ${msg}`,
      baseId,
    );
  }

  const edits: Edit[] = [];
  const evalAliases = new Set<string>();
  const functionAliases = new Set<string>();
  const derivedFunctionAliases = new Set<string>();
  const reflectAliases = new Set<string>();
  const reflectMethodAliases = createReflectMethodAliases();
  const objectAliases = new Set<string>();
  const objectMethodAliases = createObjectMethodAliases();
  const functionDescriptorAliases = new Set<string>();
  const functionDescriptorMapAliases = new Set<string>();
  const evalBindings = new Set<string>();
  if (params.some((param) => /\beval\b/.test(param))) evalBindings.add('eval');
  let hasDynamicScope = false;
  let evalMayImport = false;
  let nestedFunctionMayImport = false;
  let nestedDerivedFunctionMayImport = false;
  const walk = (node: unknown, functionDepth = 0): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as AnyNodeShape;
    if (typeof n.type !== 'string') return;
    const childFunctionDepth =
      n.type === 'FunctionDeclaration' ||
      n.type === 'FunctionExpression' ||
      n.type === 'ArrowFunctionExpression'
        ? functionDepth + 1
        : functionDepth;
    if (n.type === 'CatchClause') {
      collectPatternBindingNames((n as unknown as { param?: unknown }).param, evalBindings);
    }
    if (n.type === 'WithStatement') {
      hasDynamicScope = true;
    }
    if (n.type === 'VariableDeclarator') {
      const decl = n as unknown as { id?: AnyNodeShape; init?: unknown };
      collectPatternBindingNames(decl.id, evalBindings);
      if (decl.id?.type === 'Identifier') {
        const name = (decl.id as unknown as { name?: string }).name;
        if (
          name &&
          expressionMayBeGlobalEval(decl.init, evalAliases, reflectAliases, reflectMethodAliases)
        ) {
          evalAliases.add(name);
        }
        if (
          name &&
          expressionMayBeGlobalFunctionConstructor(
            decl.init,
            functionAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          functionAliases.add(name);
        }
        if (
          name &&
          expressionMayBeDerivedFunctionConstructor(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          derivedFunctionAliases.add(name);
        }
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptor(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorAliases.add(name);
        }
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptorMap(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorMapAliases.add(name);
        }
        if (name && expressionMayBeReflect(decl.init, reflectAliases)) {
          reflectAliases.add(name);
        }
        if (name) {
          const method = reflectMethodName(decl.init, reflectAliases);
          if (method) reflectMethodAliases[method].add(name);
        }
        if (name && expressionMayBeObject(decl.init, objectAliases)) {
          objectAliases.add(name);
        }
        if (name) {
          const method = objectMethodName(decl.init, objectAliases);
          if (method) objectMethodAliases[method].add(name);
        }
      }
      collectEvalAliasesFromPattern(
        decl.id,
        decl.init,
        evalAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectFunctionAliasesFromPattern(
        decl.id,
        decl.init,
        functionAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectDerivedFunctionAliasesFromPattern(
        decl.id,
        decl.init,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorAliasesFromPattern(
        decl.id,
        decl.init,
        functionDescriptorAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorMapAliasesFromPattern(
        decl.id,
        decl.init,
        functionDescriptorMapAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
      );
      collectReflectAliasesFromPattern(decl.id, decl.init, reflectAliases);
      collectReflectMethodAliasesFromPattern(
        decl.id,
        decl.init,
        reflectAliases,
        reflectMethodAliases,
      );
      collectObjectAliasesFromPattern(decl.id, decl.init, objectAliases);
      collectObjectMethodAliasesFromPattern(decl.id, decl.init, objectAliases, objectMethodAliases);
    }
    if (n.type === 'AssignmentExpression') {
      const assignment = n as unknown as { left?: AnyNodeShape; right?: unknown };
      if (assignment.left?.type === 'Identifier') {
        const name = (assignment.left as unknown as { name?: string }).name;
        if (
          name &&
          expressionMayBeGlobalEval(
            assignment.right,
            evalAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          evalAliases.add(name);
        } else if (name) evalAliases.delete(name);
        if (
          name &&
          expressionMayBeGlobalFunctionConstructor(
            assignment.right,
            functionAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          functionAliases.add(name);
        } else if (name) functionAliases.delete(name);
        if (
          name &&
          expressionMayBeDerivedFunctionConstructor(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          derivedFunctionAliases.add(name);
        } else if (name) derivedFunctionAliases.delete(name);
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptor(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorAliases.add(name);
        } else if (name) functionDescriptorAliases.delete(name);
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptorMap(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorMapAliases.add(name);
        } else if (name) functionDescriptorMapAliases.delete(name);
        if (name && expressionMayBeReflect(assignment.right, reflectAliases)) {
          reflectAliases.add(name);
        } else if (name) reflectAliases.delete(name);
        if (name) {
          deleteReflectMethodAlias(reflectMethodAliases, name);
          const method = reflectMethodName(assignment.right, reflectAliases);
          if (method) reflectMethodAliases[method].add(name);
        }
        if (name && expressionMayBeObject(assignment.right, objectAliases)) {
          objectAliases.add(name);
        } else if (name) objectAliases.delete(name);
        if (name) {
          deleteObjectMethodAlias(objectMethodAliases, name);
          const method = objectMethodName(assignment.right, objectAliases);
          if (method) objectMethodAliases[method].add(name);
        }
      }
      collectEvalAliasesFromPattern(
        assignment.left,
        assignment.right,
        evalAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectFunctionAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectDerivedFunctionAliasesFromPattern(
        assignment.left,
        assignment.right,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionDescriptorAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorMapAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionDescriptorMapAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
      );
      collectReflectAliasesFromPattern(assignment.left, assignment.right, reflectAliases);
      collectReflectMethodAliasesFromPattern(
        assignment.left,
        assignment.right,
        reflectAliases,
        reflectMethodAliases,
      );
      collectObjectAliasesFromPattern(assignment.left, assignment.right, objectAliases);
      collectObjectMethodAliasesFromPattern(
        assignment.left,
        assignment.right,
        objectAliases,
        objectMethodAliases,
      );
    }
    if (n.type === 'CallExpression') {
      const call = n as unknown as {
        callee?: AnyNodeShape;
        arguments?: unknown[];
        optional?: boolean;
      };
      const isDirectEval =
        functionDepth === 1 &&
        call.optional !== true &&
        call.callee?.type === 'Identifier' &&
        (call.callee as unknown as { name?: string }).name === 'eval' &&
        !evalBindings.has('eval');
      const directEvalImportReplacement = isDirectEval
        ? rewriteDirectEvalImportArgument(call.arguments?.[0], helperName)
        : null;
      if (directEvalImportReplacement !== null) {
        const argument = call.arguments?.[0] as AnyNodeShape;
        edits.push({ start: argument.start, end: argument.end, text: directEvalImportReplacement });
      }
      if (calleeMayBeEval(call.callee, evalAliases, reflectAliases, reflectMethodAliases)) {
        hasDynamicScope = hasDynamicScope || directEvalImportReplacement === null;
        evalMayImport =
          evalMayImport ||
          (directEvalImportReplacement === null && evalArgumentMayTouchImport(call.arguments?.[0]));
      }
      if (
        callMayInvokeFunctionConstructor(
          call.callee,
          call.arguments ?? [],
          functionAliases,
          reflectAliases,
          reflectMethodAliases,
        )
      ) {
        nestedFunctionMayImport = true;
      }
      if (
        importToken.test(wrapped) &&
        isOwnPropertyDescriptorsFunctionConstructorMapCall(
          n,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        )
      ) {
        nestedDerivedFunctionMayImport = true;
      }
      if (
        calleeMayBeDerivedFunctionConstructor(
          call.callee,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        ) &&
        functionConstructorArgsMayTouchImport(call.arguments ?? [])
      ) {
        nestedDerivedFunctionMayImport = true;
      }
      if (
        isReflectDerivedFunctionConstructorCall(
          n,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        )
      ) {
        nestedDerivedFunctionMayImport = true;
      }
    }
    if (n.type === 'NewExpression') {
      const ctor = n as unknown as { callee?: unknown; arguments?: unknown[] };
      if (
        expressionMayBeGlobalFunctionConstructor(
          ctor.callee,
          functionAliases,
          reflectAliases,
          reflectMethodAliases,
        ) &&
        functionConstructorArgsMayTouchImport(ctor.arguments ?? [])
      ) {
        nestedFunctionMayImport = true;
      }
      if (
        calleeMayBeDerivedFunctionConstructor(
          ctor.callee,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        ) &&
        functionConstructorArgsMayTouchImport(ctor.arguments ?? [])
      ) {
        nestedDerivedFunctionMayImport = true;
      }
    }
    if (n.type === 'ImportExpression') {
      const ie = n as unknown as ImportExpression;
      edits.push({
        start: ie.start,
        end: ie.start + 'import'.length,
        text: helperName,
      });
      walk(ie.source, functionDepth);
      if (ie.options) walk(ie.options, functionDepth);
      return;
    }
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = n[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item, childFunctionDepth);
      } else if (typeof value === 'object') {
        walk(value, childFunctionDepth);
      }
    }
  };

  walk(program);
  if (nestedDerivedFunctionMayImport) {
    throw new NotImplementedError(
      'module-loader.function-constructor-derived-host',
      `Function constructor in ${baseId} compiles import()-bearing source through a derived host Function constructor; rifty cannot route that constructor without mutating the host Function prototype, so this function is an explicit ceiling`,
    );
  }
  if (
    nestedFunctionMayImport ||
    (hasDynamicScope && (edits.length > 0 || evalMayImport || importToken.test(wrapped)))
  ) {
    throw new NotImplementedError(
      'module-loader.function-constructor-dynamic-scope',
      `Function constructor in ${baseId} combines import() routing with nested Function/with/eval dynamic scope; rifty cannot statically preserve the helper binding semantics, so this function is an explicit ceiling`,
    );
  }
  if (edits.length === 0) return null;
  return applyEdits(wrapped, edits);
}

function collectReflectAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  aliases: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeReflect(value, aliases)) aliases.add(name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) collectReflectAliasesFromPattern(prop.value, sourceProp.value, aliases);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectReflectAliasesFromPattern(patterns[i], values[i], aliases);
      }
    }
    return;
  }
  if (pat.type === 'RestElement') collectReflectAliasesFromPattern(pat.argument, value, aliases);
  if (pat.type === 'AssignmentPattern') {
    collectReflectAliasesFromPattern(pat.left, value === undefined ? pat.right : value, aliases);
  }
}

function createReflectMethodAliases(): ReflectMethodAliases {
  return {
    apply: new Set<string>(),
    construct: new Set<string>(),
    get: new Set<string>(),
    getOwnPropertyDescriptor: new Set<string>(),
  };
}
function createObjectMethodAliases(): ObjectMethodAliases {
  return {
    getOwnPropertyDescriptor: new Set<string>(),
    getOwnPropertyDescriptors: new Set<string>(),
  };
}
function deleteReflectMethodAlias(aliases: ReflectMethodAliases, name: string): void {
  aliases.apply.delete(name);
  aliases.construct.delete(name);
  aliases.get.delete(name);
  aliases.getOwnPropertyDescriptor.delete(name);
}
function deleteObjectMethodAlias(aliases: ObjectMethodAliases, name: string): void {
  aliases.getOwnPropertyDescriptor.delete(name);
  aliases.getOwnPropertyDescriptors.delete(name);
}
function addReflectMethodAlias(
  aliases: ReflectMethodAliases,
  method: ReflectMethodName,
  name: string,
): void {
  deleteReflectMethodAlias(aliases, name);
  aliases[method].add(name);
}
function addObjectMethodAlias(
  aliases: ObjectMethodAliases,
  method: ObjectMethodName,
  name: string,
): void {
  deleteObjectMethodAlias(aliases, name);
  aliases[method].add(name);
}
function collectReflectMethodAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  reflectAliases: ReadonlySet<string>,
  aliases: ReflectMethodAliases,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    const method = reflectMethodName(value, reflectAliases);
    if (name && method) addReflectMethodAlias(aliases, method, name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (expressionMayBeReflect(value, reflectAliases)) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (
          key === 'apply' ||
          key === 'construct' ||
          key === 'get' ||
          key === 'getOwnPropertyDescriptor'
        ) {
          collectPatternBindingNames(prop.value, aliases[key]);
        } else if (key === undefined) {
          collectPatternBindingNames(prop.value, aliases.apply);
          collectPatternBindingNames(prop.value, aliases.construct);
          collectPatternBindingNames(prop.value, aliases.get);
          collectPatternBindingNames(prop.value, aliases.getOwnPropertyDescriptor);
        }
      }
      return;
    }
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) {
          collectReflectMethodAliasesFromPattern(
            prop.value,
            sourceProp.value,
            reflectAliases,
            aliases,
          );
        }
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectReflectMethodAliasesFromPattern(patterns[i], values[i], reflectAliases, aliases);
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectReflectMethodAliasesFromPattern(pat.argument, value, reflectAliases, aliases);
  }
  if (pat.type === 'AssignmentPattern') {
    collectReflectMethodAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      reflectAliases,
      aliases,
    );
  }
}
function collectObjectAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  aliases: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeObject(value, aliases)) aliases.add(name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) collectObjectAliasesFromPattern(prop.value, sourceProp.value, aliases);
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectObjectAliasesFromPattern(patterns[i], values[i], aliases);
      }
    }
    return;
  }
  if (pat.type === 'RestElement') collectObjectAliasesFromPattern(pat.argument, value, aliases);
  if (pat.type === 'AssignmentPattern') {
    collectObjectAliasesFromPattern(pat.left, value === undefined ? pat.right : value, aliases);
  }
}
function collectObjectMethodAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  objectAliases: ReadonlySet<string>,
  aliases: ObjectMethodAliases,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    const method = objectMethodName(value, objectAliases);
    if (name && method) addObjectMethodAlias(aliases, method, name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (expressionMayBeObject(value, objectAliases)) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'getOwnPropertyDescriptor' || key === 'getOwnPropertyDescriptors') {
          collectPatternBindingNames(prop.value, aliases[key]);
        } else if (key === undefined) {
          collectPatternBindingNames(prop.value, aliases.getOwnPropertyDescriptor);
          collectPatternBindingNames(prop.value, aliases.getOwnPropertyDescriptors);
        }
      }
      return;
    }
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) {
          collectObjectMethodAliasesFromPattern(
            prop.value,
            sourceProp.value,
            objectAliases,
            aliases,
          );
        }
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectObjectMethodAliasesFromPattern(patterns[i], values[i], objectAliases, aliases);
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectObjectMethodAliasesFromPattern(pat.argument, value, objectAliases, aliases);
  }
  if (pat.type === 'AssignmentPattern') {
    collectObjectMethodAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      objectAliases,
      aliases,
    );
  }
}
function collectDerivedFunctionAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  aliases: Set<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (
      name &&
      expressionMayBeDerivedFunctionConstructor(
        value,
        aliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      )
    ) {
      aliases.add(name);
    }
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      expressionMayBeFunctionConstructorDescriptor(
        value,
        aliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      )
    ) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'value' || key === undefined) {
          collectPatternBindingNames(prop.value, aliases);
        }
      }
      return;
    }
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectDerivedFunctionAliasesFromPattern(
          prop.value,
          sourceProp?.value,
          aliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        );
      }
      return;
    }
    for (const prop of props) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === 'constructor' || key === undefined) {
        collectPatternBindingNames(prop.value, aliases);
      } else {
        collectDerivedFunctionAliasesFromPattern(
          prop.value,
          undefined,
          aliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectDerivedFunctionAliasesFromPattern(
          patterns[i],
          values[i],
          aliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectDerivedFunctionAliasesFromPattern(
      pat.argument,
      value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectDerivedFunctionAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    );
  }
}
function collectFunctionConstructorDescriptorAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  descriptorAliases: Set<string>,
  derivedFunctionAliases: Set<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases: ReflectMethodAliases | undefined,
  objectAliases: ReadonlySet<string>,
  objectMethodAliases: ObjectMethodAliases | undefined,
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (
      name &&
      expressionMayBeFunctionConstructorDescriptor(
        value,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        descriptorAliases,
        functionDescriptorMapAliases,
      )
    ) {
      descriptorAliases.add(name);
    }
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      expressionMayBeFunctionConstructorDescriptorMap(
        value,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        descriptorAliases,
        functionDescriptorMapAliases,
      )
    ) {
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === 'constructor' || key === undefined) {
          collectFunctionConstructorDescriptorPattern(
            prop.value,
            descriptorAliases,
            derivedFunctionAliases,
          );
        }
      }
      return;
    }
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) {
          collectFunctionConstructorDescriptorAliasesFromPattern(
            prop.value,
            sourceProp.value,
            descriptorAliases,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorMapAliases,
          );
        }
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectFunctionConstructorDescriptorAliasesFromPattern(
          patterns[i],
          values[i],
          descriptorAliases,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorMapAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectFunctionConstructorDescriptorAliasesFromPattern(
      pat.argument,
      value,
      descriptorAliases,
      derivedFunctionAliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorMapAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectFunctionConstructorDescriptorAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      descriptorAliases,
      derivedFunctionAliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorMapAliases,
    );
  }
}
function collectFunctionConstructorDescriptorMapAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  descriptorMapAliases: Set<string>,
  derivedFunctionAliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases: ReflectMethodAliases | undefined,
  objectAliases: ReadonlySet<string>,
  objectMethodAliases: ObjectMethodAliases | undefined,
  functionDescriptorAliases: ReadonlySet<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (
      name &&
      expressionMayBeFunctionConstructorDescriptorMap(
        value,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        descriptorMapAliases,
      )
    ) {
      descriptorMapAliases.add(name);
    }
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        if (sourceProp) {
          collectFunctionConstructorDescriptorMapAliasesFromPattern(
            prop.value,
            sourceProp.value,
            descriptorMapAliases,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
          );
        }
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectFunctionConstructorDescriptorMapAliasesFromPattern(
          patterns[i],
          values[i],
          descriptorMapAliases,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectFunctionConstructorDescriptorMapAliasesFromPattern(
      pat.argument,
      value,
      descriptorMapAliases,
      derivedFunctionAliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectFunctionConstructorDescriptorMapAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      descriptorMapAliases,
      derivedFunctionAliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
    );
  }
}
function collectFunctionConstructorDescriptorPattern(
  pattern: unknown,
  descriptorAliases: Set<string>,
  derivedFunctionAliases: Set<string>,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name) descriptorAliases.add(name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    for (const prop of props) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === 'value' || key === undefined) {
        collectPatternBindingNames(prop.value, derivedFunctionAliases);
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectFunctionConstructorDescriptorPattern(
      pat.argument,
      descriptorAliases,
      derivedFunctionAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectFunctionConstructorDescriptorPattern(
      pat.left,
      descriptorAliases,
      derivedFunctionAliases,
    );
  }
}
function collectFunctionAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  aliases: Set<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (
      name &&
      expressionMayBeGlobalFunctionConstructor(value, aliases, reflectAliases, reflectMethodAliases)
    ) {
      aliases.add(name);
    }
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) continue;
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectFunctionAliasesFromPattern(
          prop.value,
          sourceProp?.value,
          aliases,
          reflectAliases,
          reflectMethodAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectFunctionAliasesFromPattern(
          patterns[i],
          values[i],
          aliases,
          reflectAliases,
          reflectMethodAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectFunctionAliasesFromPattern(
      pat.argument,
      value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectFunctionAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    );
  }
}
function collectEvalAliasesFromPattern(
  pattern: unknown,
  value: unknown,
  aliases: Set<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name && expressionMayBeGlobalEval(value, aliases, reflectAliases, reflectMethodAliases)) {
      aliases.add(name);
    }
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ObjectExpression'
    ) {
      const objectProperties =
        (unwrapChain(value) as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
      for (const prop of props) {
        if (prop.type === 'RestElement') continue;
        const key = staticPropertyKeyName(prop);
        if (key === undefined) {
          collectPatternBindingNames(prop.value, aliases);
          continue;
        }
        const sourceProp = objectProperties.find(
          (candidate) =>
            candidate.type !== 'SpreadElement' && staticPropertyKeyName(candidate) === key,
        );
        collectEvalAliasesFromPattern(
          prop.value,
          sourceProp?.value,
          aliases,
          reflectAliases,
          reflectMethodAliases,
        );
      }
      return;
    }
    for (const prop of props) {
      if (prop.type === 'RestElement') continue;
      const key = staticPropertyKeyName(prop);
      if (key === 'eval' || key === undefined) collectPatternBindingNames(prop.value, aliases);
      else {
        collectEvalAliasesFromPattern(
          prop.value,
          undefined,
          aliases,
          reflectAliases,
          reflectMethodAliases,
        );
      }
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const patterns = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    if (
      value &&
      typeof value === 'object' &&
      (unwrapChain(value) as AnyNodeShape).type === 'ArrayExpression'
    ) {
      const values = (unwrapChain(value) as unknown as { elements?: unknown[] }).elements ?? [];
      for (let i = 0; i < patterns.length; i++) {
        collectEvalAliasesFromPattern(
          patterns[i],
          values[i],
          aliases,
          reflectAliases,
          reflectMethodAliases,
        );
      }
    } else {
      collectPatternBindingNames(pat, aliases);
    }
    return;
  }
  if (pat.type === 'RestElement') {
    collectEvalAliasesFromPattern(
      pat.argument,
      value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    );
  }
  if (pat.type === 'AssignmentPattern') {
    collectEvalAliasesFromPattern(
      pat.left,
      value === undefined ? pat.right : value,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    );
  }
}
function collectPatternBindingNames(pattern: unknown, out: Set<string>): void {
  if (!pattern || typeof pattern !== 'object') return;
  const pat = pattern as AnyNodeShape;
  if (pat.type === 'Identifier') {
    const name = (pat as unknown as { name?: string }).name;
    if (name) out.add(name);
    return;
  }
  if (pat.type === 'ObjectPattern') {
    const props = (pat as unknown as { properties?: AnyNodeShape[] }).properties ?? [];
    for (const prop of props) {
      collectPatternBindingNames(prop.type === 'RestElement' ? prop.argument : prop.value, out);
    }
    return;
  }
  if (pat.type === 'ArrayPattern') {
    const elements = (pat as unknown as { elements?: unknown[] }).elements ?? [];
    for (const element of elements) collectPatternBindingNames(element, out);
    return;
  }
  if (pat.type === 'RestElement') collectPatternBindingNames(pat.argument, out);
  if (pat.type === 'AssignmentPattern') collectPatternBindingNames(pat.left, out);
}
function expressionMayBeEval(node: unknown, aliases: ReadonlySet<string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return name === 'eval' || (typeof name === 'string' && aliases.has(name));
  }
  if (n.type !== 'MemberExpression') return false;
  if (staticPropertyName(n) === 'eval') return true;
  const member = n as unknown as { object?: unknown };
  return memberPropertyMayBeEval(n) && isKnownGlobalObjectExpression(member.object);
}
function expressionMayBeGlobalEval(
  node: unknown,
  evalAliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  if (expressionMayBeEval(node, evalAliases)) return true;
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  return (
    n.type === 'CallExpression' &&
    isReflectGetGlobalEvalCall(n, reflectAliases, reflectMethodAliases)
  );
}
function expressionMayBeFunctionConstructor(node: unknown, aliases: ReadonlySet<string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return name === 'Function' || (typeof name === 'string' && aliases.has(name));
  }
  if (n.type !== 'MemberExpression') return false;
  if (staticPropertyName(n) === 'Function') return true;
  const member = n as unknown as { object?: unknown };
  return memberPropertyMayBeFunction(n) && isKnownGlobalObjectExpression(member.object);
}
function expressionMayBeGlobalFunctionConstructor(
  node: unknown,
  functionAliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  if (expressionMayBeFunctionConstructor(node, functionAliases)) return true;
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  return (
    n.type === 'CallExpression' &&
    isReflectGetGlobalFunctionCall(n, reflectAliases, reflectMethodAliases)
  );
}
function expressionMayBeReflect(node: unknown, aliases: ReadonlySet<string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  return name === 'Reflect' || (typeof name === 'string' && aliases.has(name));
}
function expressionMayBeObject(node: unknown, aliases: ReadonlySet<string>): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  return name === 'Object' || (typeof name === 'string' && aliases.has(name));
}
function reflectMethodName(
  node: unknown,
  reflectAliases: ReadonlySet<string>,
): ReflectMethodName | null {
  if (!node || typeof node !== 'object') return null;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'MemberExpression') return null;
  const member = n as unknown as { object?: unknown };
  if (!expressionMayBeReflect(member.object, reflectAliases)) return null;
  const method = staticPropertyName(n);
  return method === 'apply' ||
    method === 'construct' ||
    method === 'get' ||
    method === 'getOwnPropertyDescriptor'
    ? method
    : null;
}
function objectMethodName(
  node: unknown,
  objectAliases: ReadonlySet<string>,
): ObjectMethodName | null {
  if (!node || typeof node !== 'object') return null;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'MemberExpression') return null;
  const member = n as unknown as { object?: unknown };
  if (!expressionMayBeObject(member.object, objectAliases)) return null;
  const method = staticPropertyName(n);
  return method === 'getOwnPropertyDescriptor' || method === 'getOwnPropertyDescriptors'
    ? method
    : null;
}
function callMayInvokeFunctionConstructor(
  callee: unknown,
  args: readonly unknown[],
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  if (!callee || typeof callee !== 'object') return false;
  const n = unwrapChain(callee) as AnyNodeShape;
  if (expressionMayBeGlobalFunctionConstructor(n, aliases, reflectAliases, reflectMethodAliases)) {
    return functionConstructorArgsMayTouchImport(args);
  }
  if (isReflectFunctionConstructorCall(n, args, aliases, reflectAliases, reflectMethodAliases)) {
    return true;
  }
  const bindArgs = functionConstructorBindArgs(n, aliases, reflectAliases, reflectMethodAliases);
  if (bindArgs) return functionConstructorArgsMayTouchImport([...bindArgs, ...args]);
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (
    !member.object ||
    !expressionMayBeGlobalFunctionConstructor(
      member.object,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    )
  ) {
    return false;
  }
  const propertyName = staticPropertyName(n);
  if (propertyName === 'call') return functionConstructorArgsMayTouchImport(args.slice(1));
  if (propertyName === 'apply') return constructorArgArrayMayTouchImport(args[1]);
  if (propertyName === 'bind') return functionConstructorArgsMayTouchImport(args.slice(1));
  return false;
}
function functionConstructorBindArgs(
  node: AnyNodeShape,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): readonly unknown[] | null {
  if (node.type !== 'CallExpression') return null;
  const call = node as unknown as { callee?: unknown; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  if (!callee || callee.type !== 'MemberExpression') return null;
  const member = callee as unknown as { object?: unknown };
  if (
    !member.object ||
    !expressionMayBeGlobalFunctionConstructor(
      member.object,
      aliases,
      reflectAliases,
      reflectMethodAliases,
    )
  ) {
    return null;
  }
  if (staticPropertyName(callee) !== 'bind') return null;
  return (call.arguments ?? []).slice(1);
}
function isReflectFunctionConstructorCall(
  callee: AnyNodeShape,
  args: readonly unknown[],
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  if (
    !calleeMayBeReflectMethod(callee, 'apply', reflectAliases, reflectMethodAliases) &&
    !calleeMayBeReflectMethod(callee, 'construct', reflectAliases, reflectMethodAliases)
  ) {
    return false;
  }
  if (
    !expressionMayBeGlobalFunctionConstructor(
      args[0],
      aliases,
      reflectAliases,
      reflectMethodAliases,
    )
  ) {
    return false;
  }
  if (calleeMayBeReflectMethod(callee, 'apply', reflectAliases, reflectMethodAliases)) {
    return constructorArgArrayMayTouchImport(args[2]);
  }
  return constructorArgArrayMayTouchImport(args[1]);
}
function expressionMayBeDerivedFunctionConstructor(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && aliases.has(name);
  }
  if (
    n.type === 'CallExpression' &&
    isReflectGetDerivedFunctionConstructorCall(n, aliases, reflectAliases, reflectMethodAliases)
  ) {
    return true;
  }
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (
    memberPropertyMayBeDescriptorValue(n) &&
    expressionMayBeFunctionConstructorDescriptor(
      member.object,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  ) {
    return true;
  }
  if (isKnownGlobalObjectExpression(member.object)) return false;
  return memberPropertyMayBeConstructor(n);
}
function calleeMayBeDerivedFunctionConstructor(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (
    expressionMayBeDerivedFunctionConstructor(
      n,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  ) {
    return true;
  }
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  if (
    !member.object ||
    !expressionMayBeDerivedFunctionConstructor(
      member.object,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  ) {
    return false;
  }
  const propertyName = staticPropertyName(n);
  return propertyName === 'call' || propertyName === 'apply' || propertyName === 'bind';
}
function isReflectGetDerivedFunctionConstructorCall(
  node: AnyNodeShape,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee) return false;
  if (!calleeMayBeReflectMethod(callee, 'get', reflectAliases, reflectMethodAliases)) return false;
  return (
    propertyMayBeConstructor(args[1]) && expressionMayHaveFunctionConstructor(args[0], aliases)
  );
}
function expressionMayBeFunctionConstructorDescriptor(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && functionDescriptorAliases.has(name);
  }
  if (
    n.type === 'CallExpression' &&
    isOwnPropertyDescriptorConstructorCall(
      n,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  ) {
    return true;
  }
  if (n.type !== 'MemberExpression') return false;
  const member = n as unknown as { object?: unknown };
  return (
    memberPropertyMayBeConstructor(n) &&
    expressionMayBeFunctionConstructorDescriptorMap(
      member.object,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  );
}
function isOwnPropertyDescriptorConstructorCall(
  node: AnyNodeShape,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases: ReflectMethodAliases | undefined,
  objectAliases: ReadonlySet<string>,
  objectMethodAliases: ObjectMethodAliases | undefined,
  functionDescriptorAliases: ReadonlySet<string>,
  functionDescriptorMapAliases: ReadonlySet<string>,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee) return false;
  if (
    !calleeMayBeObjectMethod(
      callee,
      'getOwnPropertyDescriptor',
      objectAliases,
      objectMethodAliases,
    ) &&
    !calleeMayBeReflectMethod(
      callee,
      'getOwnPropertyDescriptor',
      reflectAliases,
      reflectMethodAliases,
    )
  ) {
    return false;
  }
  return (
    propertyMayBeConstructor(args[1]) &&
    expressionMayHaveFunctionConstructor(
      args[0],
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  );
}
function expressionMayBeFunctionConstructorDescriptorMap(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Identifier') {
    const name = (n as unknown as { name?: string }).name;
    return typeof name === 'string' && functionDescriptorMapAliases.has(name);
  }
  return (
    n.type === 'CallExpression' &&
    isOwnPropertyDescriptorsFunctionConstructorMapCall(
      n,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  );
}

function isOwnPropertyDescriptorsFunctionConstructorMapCall(
  node: AnyNodeShape,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases: ReflectMethodAliases | undefined,
  objectAliases: ReadonlySet<string>,
  objectMethodAliases: ObjectMethodAliases | undefined,
  functionDescriptorAliases: ReadonlySet<string>,
  functionDescriptorMapAliases: ReadonlySet<string>,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee) return false;
  if (
    !calleeMayBeObjectMethod(
      callee,
      'getOwnPropertyDescriptors',
      objectAliases,
      objectMethodAliases,
    )
  ) {
    return false;
  }
  return expressionMayHaveFunctionConstructor(
    args[0],
    aliases,
    reflectAliases,
    reflectMethodAliases,
    objectAliases,
    objectMethodAliases,
    functionDescriptorAliases,
    functionDescriptorMapAliases,
  );
}

function isReflectGetGlobalFunctionCall(
  node: AnyNodeShape,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  return isReflectGetGlobalMemberCall(node, 'Function', reflectAliases, reflectMethodAliases);
}

function isReflectGetGlobalEvalCall(
  node: AnyNodeShape,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  return isReflectGetGlobalMemberCall(node, 'eval', reflectAliases, reflectMethodAliases);
}

function isReflectGetGlobalMemberCall(
  node: AnyNodeShape,
  property: 'Function' | 'eval',
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  if (!callee || !calleeMayBeReflectMethod(callee, 'get', reflectAliases, reflectMethodAliases)) {
    return false;
  }
  const args = call.arguments ?? [];
  return isKnownGlobalObjectExpression(args[0]) && propertyMayBeNamed(args[1], property);
}

function isReflectDerivedFunctionConstructorCall(
  node: AnyNodeShape,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  const call = node as unknown as { callee?: AnyNodeShape; arguments?: unknown[] };
  const callee = unwrapChain(call.callee) as AnyNodeShape | undefined;
  const args = call.arguments ?? [];
  if (!callee) return false;
  if (calleeMayBeReflectMethod(callee, 'apply', reflectAliases, reflectMethodAliases)) {
    return (
      expressionMayBeDerivedFunctionConstructor(
        args[0],
        aliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      ) && constructorArgArrayMayTouchImport(args[2])
    );
  }
  if (calleeMayBeReflectMethod(callee, 'construct', reflectAliases, reflectMethodAliases)) {
    return (
      expressionMayBeDerivedFunctionConstructor(
        args[0],
        aliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      ) && constructorArgArrayMayTouchImport(args[1])
    );
  }
  return false;
}

function isReflectMember(
  node: AnyNodeShape,
  method: string,
  aliases: ReadonlySet<string> = new Set(),
): boolean {
  const member = node as unknown as { object?: AnyNodeShape };
  const object = unwrapChain(member.object) as AnyNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  return (
    typeof objectName === 'string' &&
    (objectName === 'Reflect' || aliases.has(objectName)) &&
    staticPropertyName(node) === method
  );
}

function isObjectMember(
  node: AnyNodeShape,
  method: ObjectMethodName,
  aliases: ReadonlySet<string> = new Set(),
): boolean {
  const member = node as unknown as { object?: AnyNodeShape };
  const object = unwrapChain(member.object) as AnyNodeShape | undefined;
  const objectName =
    object?.type === 'Identifier' ? (object as unknown as { name?: string }).name : undefined;
  return (
    typeof objectName === 'string' &&
    (objectName === 'Object' || aliases.has(objectName)) &&
    staticPropertyName(node) === method
  );
}

function calleeMayBeReflectMethod(
  node: AnyNodeShape,
  method: ReflectMethodName,
  reflectAliases: ReadonlySet<string>,
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  if (isReflectMember(node, method, reflectAliases)) return true;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  return typeof name === 'string' && (reflectMethodAliases?.[method].has(name) ?? false);
}

function calleeMayBeObjectMethod(
  node: AnyNodeShape,
  method: ObjectMethodName,
  objectAliases: ReadonlySet<string>,
  objectMethodAliases?: ObjectMethodAliases,
): boolean {
  if (isObjectMember(node, method, objectAliases)) return true;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  return typeof name === 'string' && (objectMethodAliases?.[method].has(name) ?? false);
}

function expressionMayHaveFunctionConstructor(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
  objectAliases: ReadonlySet<string> = new Set(),
  objectMethodAliases?: ObjectMethodAliases,
  functionDescriptorAliases: ReadonlySet<string> = new Set(),
  functionDescriptorMapAliases: ReadonlySet<string> = new Set(),
): boolean {
  if (!node || typeof node !== 'object') return true;
  const n = unwrapChain(node) as AnyNodeShape;
  if (
    expressionMayBeFunctionConstructor(n, new Set()) ||
    expressionMayBeDerivedFunctionConstructor(
      n,
      aliases,
      reflectAliases,
      reflectMethodAliases,
      objectAliases,
      objectMethodAliases,
      functionDescriptorAliases,
      functionDescriptorMapAliases,
    )
  ) {
    return true;
  }
  return (
    n.type !== 'Literal' &&
    n.type !== 'TemplateLiteral' &&
    n.type !== 'ObjectExpression' &&
    n.type !== 'ArrayExpression'
  );
}

function propertyMayBeConstructor(node: unknown): boolean {
  const value = literalString(node);
  return value === 'constructor' || value === undefined;
}

function memberPropertyMayBeConstructor(node: AnyNodeShape): boolean {
  const value = staticPropertyName(node);
  return value === 'constructor' || value === undefined;
}

function memberPropertyMayBeDescriptorValue(node: AnyNodeShape): boolean {
  const value = staticPropertyName(node);
  return value === 'value' || value === undefined;
}

function memberPropertyMayBeEval(node: AnyNodeShape): boolean {
  const value = staticPropertyName(node);
  return value === 'eval' || value === undefined;
}

function memberPropertyMayBeFunction(node: AnyNodeShape): boolean {
  const value = staticPropertyName(node);
  return value === 'Function' || value === undefined;
}

function isKnownGlobalObjectExpression(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'Identifier') return false;
  const name = (n as unknown as { name?: string }).name;
  return name === 'globalThis' || name === 'global';
}

function propertyMayBeNamed(node: unknown, name: 'Function' | 'eval'): boolean {
  const value = literalString(node);
  return value === name || value === undefined;
}

function calleeMayBeEval(
  node: unknown,
  aliases: ReadonlySet<string>,
  reflectAliases: ReadonlySet<string> = new Set(),
  reflectMethodAliases?: ReflectMethodAliases,
): boolean {
  return expressionMayBeGlobalEval(node, aliases, reflectAliases, reflectMethodAliases);
}

function evalArgumentMayTouchImport(node: unknown): boolean {
  const source = literalString(node);
  if (source === undefined) return true;
  return /\bimport\b/.test(source);
}

function functionConstructorArgsMayTouchImport(args: readonly unknown[]): boolean {
  if (args.length === 0) return false;
  const sourceParts = args.map(literalString);
  const staticSources = sourceParts.filter((source): source is string => source !== undefined);
  if (!staticSources.some((source) => importToken.test(source) || dynamicScopeToken.test(source))) {
    return false;
  }
  const params = sourceParts
    .slice(0, -1)
    .map(
      (source, index) => source ?? uniqueHelperName(staticSources, `__riftyOpaqueParam${index}`),
    );
  const body = sourceParts[sourceParts.length - 1] ?? '';
  const wrapped = `function anonymous(${params.join(',')}) {\n${body}\n}`;
  try {
    const program = acornParse(wrapped, {
      ecmaVersion: 'latest',
      sourceType: 'script',
      allowHashBang: false,
      locations: false,
    }) as Program;
    return sourceContainsImportOrEval(program);
  } catch {
    return importToken.test(wrapped) || dynamicScopeToken.test(wrapped);
  }
}

function constructorArgArrayMayTouchImport(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type !== 'ArrayExpression') return false;
  const elements = (n as unknown as { elements?: unknown[] }).elements ?? [];
  return functionConstructorArgsMayTouchImport(elements);
}

function sourceContainsImportOrEval(node: unknown): boolean {
  const evalAliases = new Set<string>();
  const functionAliases = new Set<string>();
  const derivedFunctionAliases = new Set<string>();
  const reflectAliases = new Set<string>();
  const reflectMethodAliases = createReflectMethodAliases();
  const objectAliases = new Set<string>();
  const objectMethodAliases = createObjectMethodAliases();
  const functionDescriptorAliases = new Set<string>();
  const functionDescriptorMapAliases = new Set<string>();
  let found = false;

  const walk = (candidate: unknown): void => {
    if (found || !candidate || typeof candidate !== 'object') return;
    const n = candidate as AnyNodeShape;
    if (typeof n.type !== 'string') return;
    if (n.type === 'VariableDeclarator') {
      const decl = n as unknown as { id?: AnyNodeShape; init?: unknown };
      if (decl.id?.type === 'Identifier') {
        const name = (decl.id as unknown as { name?: string }).name;
        if (
          name &&
          expressionMayBeGlobalEval(decl.init, evalAliases, reflectAliases, reflectMethodAliases)
        ) {
          evalAliases.add(name);
        }
        if (
          name &&
          expressionMayBeGlobalFunctionConstructor(
            decl.init,
            functionAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          functionAliases.add(name);
        }
        if (
          name &&
          expressionMayBeDerivedFunctionConstructor(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          derivedFunctionAliases.add(name);
        }
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptor(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorAliases.add(name);
        }
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptorMap(
            decl.init,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorMapAliases.add(name);
        }
        if (name && expressionMayBeReflect(decl.init, reflectAliases)) reflectAliases.add(name);
        if (name) {
          const method = reflectMethodName(decl.init, reflectAliases);
          if (method) reflectMethodAliases[method].add(name);
        }
        if (name && expressionMayBeObject(decl.init, objectAliases)) objectAliases.add(name);
        if (name) {
          const method = objectMethodName(decl.init, objectAliases);
          if (method) objectMethodAliases[method].add(name);
        }
      }
      collectEvalAliasesFromPattern(
        decl.id,
        decl.init,
        evalAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectFunctionAliasesFromPattern(
        decl.id,
        decl.init,
        functionAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectDerivedFunctionAliasesFromPattern(
        decl.id,
        decl.init,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorAliasesFromPattern(
        decl.id,
        decl.init,
        functionDescriptorAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorMapAliasesFromPattern(
        decl.id,
        decl.init,
        functionDescriptorMapAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
      );
      collectReflectAliasesFromPattern(decl.id, decl.init, reflectAliases);
      collectReflectMethodAliasesFromPattern(
        decl.id,
        decl.init,
        reflectAliases,
        reflectMethodAliases,
      );
      collectObjectAliasesFromPattern(decl.id, decl.init, objectAliases);
      collectObjectMethodAliasesFromPattern(decl.id, decl.init, objectAliases, objectMethodAliases);
    }
    if (n.type === 'AssignmentExpression') {
      const assignment = n as unknown as { left?: AnyNodeShape; right?: unknown };
      if (assignment.left?.type === 'Identifier') {
        const name = (assignment.left as unknown as { name?: string }).name;
        if (
          name &&
          expressionMayBeGlobalEval(
            assignment.right,
            evalAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          evalAliases.add(name);
        } else if (name) evalAliases.delete(name);
        if (
          name &&
          expressionMayBeGlobalFunctionConstructor(
            assignment.right,
            functionAliases,
            reflectAliases,
            reflectMethodAliases,
          )
        ) {
          functionAliases.add(name);
        } else if (name) functionAliases.delete(name);
        if (
          name &&
          expressionMayBeDerivedFunctionConstructor(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          derivedFunctionAliases.add(name);
        } else if (name) derivedFunctionAliases.delete(name);
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptor(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorAliases.add(name);
        } else if (name) functionDescriptorAliases.delete(name);
        if (
          name &&
          expressionMayBeFunctionConstructorDescriptorMap(
            assignment.right,
            derivedFunctionAliases,
            reflectAliases,
            reflectMethodAliases,
            objectAliases,
            objectMethodAliases,
            functionDescriptorAliases,
            functionDescriptorMapAliases,
          )
        ) {
          functionDescriptorMapAliases.add(name);
        } else if (name) functionDescriptorMapAliases.delete(name);
        if (name && expressionMayBeReflect(assignment.right, reflectAliases)) {
          reflectAliases.add(name);
        } else if (name) reflectAliases.delete(name);
        if (name) {
          deleteReflectMethodAlias(reflectMethodAliases, name);
          const method = reflectMethodName(assignment.right, reflectAliases);
          if (method) reflectMethodAliases[method].add(name);
        }
        if (name && expressionMayBeObject(assignment.right, objectAliases)) {
          objectAliases.add(name);
        } else if (name) objectAliases.delete(name);
        if (name) {
          deleteObjectMethodAlias(objectMethodAliases, name);
          const method = objectMethodName(assignment.right, objectAliases);
          if (method) objectMethodAliases[method].add(name);
        }
      }
      collectEvalAliasesFromPattern(
        assignment.left,
        assignment.right,
        evalAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectFunctionAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionAliases,
        reflectAliases,
        reflectMethodAliases,
      );
      collectDerivedFunctionAliasesFromPattern(
        assignment.left,
        assignment.right,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionDescriptorAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorMapAliases,
      );
      collectFunctionConstructorDescriptorMapAliasesFromPattern(
        assignment.left,
        assignment.right,
        functionDescriptorMapAliases,
        derivedFunctionAliases,
        reflectAliases,
        reflectMethodAliases,
        objectAliases,
        objectMethodAliases,
        functionDescriptorAliases,
      );
      collectReflectAliasesFromPattern(assignment.left, assignment.right, reflectAliases);
      collectReflectMethodAliasesFromPattern(
        assignment.left,
        assignment.right,
        reflectAliases,
        reflectMethodAliases,
      );
      collectObjectAliasesFromPattern(assignment.left, assignment.right, objectAliases);
      collectObjectMethodAliasesFromPattern(
        assignment.left,
        assignment.right,
        objectAliases,
        objectMethodAliases,
      );
    }
    if (n.type === 'ImportExpression') {
      found = true;
      return;
    }
    if (n.type === 'CallExpression') {
      const call = n as unknown as { callee?: unknown; arguments?: unknown[] };
      if (
        calleeMayBeEval(call.callee, evalAliases, reflectAliases, reflectMethodAliases) &&
        evalArgumentMayTouchImport(call.arguments?.[0])
      ) {
        found = true;
        return;
      }
      if (
        callMayInvokeFunctionConstructor(
          call.callee,
          call.arguments ?? [],
          functionAliases,
          reflectAliases,
          reflectMethodAliases,
        )
      ) {
        found = true;
        return;
      }
      if (
        isOwnPropertyDescriptorsFunctionConstructorMapCall(
          n,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        )
      ) {
        found = true;
        return;
      }
      if (
        calleeMayBeDerivedFunctionConstructor(
          call.callee,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        ) &&
        functionConstructorArgsMayTouchImport(call.arguments ?? [])
      ) {
        found = true;
        return;
      }
      if (
        isReflectDerivedFunctionConstructorCall(
          n,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        )
      ) {
        found = true;
        return;
      }
    }
    if (n.type === 'NewExpression') {
      const ctor = n as unknown as { callee?: unknown; arguments?: unknown[] };
      if (
        expressionMayBeGlobalFunctionConstructor(
          ctor.callee,
          functionAliases,
          reflectAliases,
          reflectMethodAliases,
        ) &&
        functionConstructorArgsMayTouchImport(ctor.arguments ?? [])
      ) {
        found = true;
        return;
      }
      if (
        calleeMayBeDerivedFunctionConstructor(
          ctor.callee,
          derivedFunctionAliases,
          reflectAliases,
          reflectMethodAliases,
          objectAliases,
          objectMethodAliases,
          functionDescriptorAliases,
          functionDescriptorMapAliases,
        ) &&
        functionConstructorArgsMayTouchImport(ctor.arguments ?? [])
      ) {
        found = true;
        return;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
        continue;
      }
      const value = n[key];
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) walk(item);
      } else if (typeof value === 'object') {
        walk(value);
      }
    }
  };

  walk(node);
  return found;
}

function unwrapChain(node: unknown): unknown {
  if (!node || typeof node !== 'object') return node;
  const n = node as AnyNodeShape;
  if (n.type === 'ChainExpression') return unwrapChain(n.expression);
  if (n.type === 'SequenceExpression') {
    const expressions = (n as unknown as { expressions?: unknown[] }).expressions ?? [];
    return unwrapChain(expressions[expressions.length - 1]);
  }
  return node;
}

function staticPropertyName(node: AnyNodeShape): string | undefined {
  const n = unwrapChain(node) as AnyNodeShape;
  const member = n as unknown as { computed?: boolean; property?: AnyNodeShape };
  const property = member.property;
  if (!property) return undefined;
  if (!member.computed && property.type === 'Identifier') {
    return (property as unknown as { name?: string }).name;
  }
  return literalString(property);
}

function staticPropertyKeyName(node: AnyNodeShape): string | undefined {
  const n = unwrapChain(node) as AnyNodeShape;
  const property = n as unknown as { computed?: boolean; key?: AnyNodeShape };
  const key = property.key;
  if (!key) return undefined;
  if (!property.computed && key.type === 'Identifier') {
    return (key as unknown as { name?: string }).name;
  }
  return literalString(key);
}

function literalString(node: unknown): string | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const n = unwrapChain(node) as AnyNodeShape;
  if (n.type === 'Literal') {
    const value = (n as unknown as { value?: unknown }).value;
    return typeof value === 'string' ? value : undefined;
  }
  if (n.type === 'TemplateLiteral') {
    const tmpl = n as unknown as {
      expressions?: unknown[];
      quasis?: Array<{ value?: { cooked?: string | null; raw?: string } }>;
    };
    if ((tmpl.expressions?.length ?? 0) !== 0) return undefined;
    return (tmpl.quasis ?? []).map((q) => q.value?.cooked ?? q.value?.raw ?? '').join('');
  }
  if (n.type === 'BinaryExpression' && (n as unknown as { operator?: string }).operator === '+') {
    const bin = n as unknown as { left?: unknown; right?: unknown };
    const left = literalString(bin.left);
    const right = literalString(bin.right);
    return left !== undefined && right !== undefined ? `${left}${right}` : undefined;
  }
  return undefined;
}

function applyEdits(source: string, edits: readonly Edit[]): string {
  let out = '';
  let pos = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    out += source.slice(pos, edit.start);
    out += edit.text;
    pos = edit.end;
  }
  out += source.slice(pos);
  return out;
}
