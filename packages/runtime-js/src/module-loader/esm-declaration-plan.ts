import type {
  ArrayPattern,
  AssignmentPattern,
  ExportAllDeclaration,
  ExportDefaultDeclaration,
  ExportNamedDeclaration,
  Identifier,
  ImportDeclaration,
  Literal,
  Node,
  ObjectPattern,
  Pattern,
  Program,
  RestElement,
  VariableDeclaration,
} from 'acorn';

export interface TransformHelperNames {
  readonly dynamicImport: string;
  readonly importStatic: string;
  readonly slots: string;
  readonly rebuildExports: string;
  readonly importMeta: string;
  readonly importMetaUrl: string;
  readonly metaDirname: string;
  readonly metaFilename: string;
  readonly assetPath: string;
  readonly metaResolve: string;
  readonly runtimeObject: string;
}

export interface EsmAstEdit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

export interface EsmImportBinding {
  /** The synthesized local namespace variable, e.g. `__m0`. */
  readonly ns: string;
  /** `'*'` for `import * as ns`, `'default'` for default, or the named binding. */
  readonly imported: string;
  readonly specifier: string;
}

export interface LinkedNamedReexport {
  readonly specifier: string;
  readonly imported: string;
  readonly exported: string;
}

export interface LinkedLocalExport {
  readonly local: string;
  readonly exported: string;
}

export interface LinkedImportRequirement {
  readonly specifier: string;
  readonly imported: string;
}

export interface LinkedImportBinding extends LinkedImportRequirement {
  readonly local: string;
}

export interface LinkedNamespaceReexport {
  readonly specifier: string;
  readonly exported: string;
}

export interface LinkedExports {
  readonly explicitNames: ReadonlySet<string>;
  readonly localExports: readonly LinkedLocalExport[];
  readonly importBindings: readonly LinkedImportBinding[];
  readonly importRequirements: readonly LinkedImportRequirement[];
  readonly namedReexports: readonly LinkedNamedReexport[];
  readonly namespaceReexports: readonly LinkedNamespaceReexport[];
  readonly starSpecifiers: readonly string[];
}

export interface EsmDeclarationPlan {
  readonly edits: EsmAstEdit[];
  readonly importedBindings: Map<string, EsmImportBinding>;
  readonly staticImports: readonly string[];
  readonly hasTopLevelAwait: boolean;
  readonly linkedExports: LinkedExports;
  readonly instantiationBody: string;
  readonly needsGeneratorInstantiation: boolean;
}

type AllocateGeneratedName = (base: string) => string;

/**
 * Plans all top-level import/export declarations in one pass. The caller owns
 * lexical reference rewrites; this module owns declaration instrumentation and
 * the loader's matching link/instantiation metadata.
 */
export function planEsmDeclarations(
  program: Program,
  source: string,
  helpers: TransformHelperNames,
  allocateName: AllocateGeneratedName,
): EsmDeclarationPlan {
  const edits: EsmAstEdit[] = [];
  const staticImports = new Set<string>();
  const explicitExportNames = new Set<string>();
  const localExports: LinkedLocalExport[] = [];
  const importRequirements: LinkedImportRequirement[] = [];
  const linkedImportBindings: LinkedImportBinding[] = [];
  const namedReexports: LinkedNamedReexport[] = [];
  const namespaceReexports: LinkedNamespaceReexport[] = [];
  const starSpecifiers: string[] = [];
  const instantiationImports: string[] = [];
  const hoistedModuleBindings = moduleVarBindings(program);
  const importedBindings = new Map<string, EsmImportBinding>();
  let importCounter = 0;

  for (const node of program.body) {
    collectHoistedDeclaration(node, hoistedModuleBindings);
    if (node.type === 'ImportDeclaration') {
      if (isFileAttributeImport(node)) {
        handleFileImport(node, allocateName(`__file${importCounter++}`), edits, helpers);
      } else {
        const ns = allocateName(`__m${importCounter++}`);
        handleImportDeclaration(node, ns, edits, importedBindings);
        const sourceLit = literalString(node.source.value);
        instantiationImports.push(
          `const ${ns} = () => ${helpers.importStatic}(${JSON.stringify(sourceLit)});`,
        );
        staticImports.add(sourceLit);
        collectImportLinks(node, sourceLit, importRequirements, linkedImportBindings);
      }
      continue;
    }

    if (node.type === 'ExportNamedDeclaration') {
      const sourceLit = node.source ? literalString(node.source.value) : null;
      collectNamedExportLinks(node, sourceLit, explicitExportNames, localExports, namedReexports);
      if (sourceLit !== null) {
        const ns = allocateName(`__m${importCounter++}`);
        handleReExportNamed(node, ns, edits, sourceLit, helpers);
        staticImports.add(sourceLit);
      } else {
        handleExportNamed(node, edits, importedBindings, helpers);
      }
      continue;
    }

    if (node.type === 'ExportDefaultDeclaration') {
      explicitExportNames.add('default');
      const declaration = node.declaration;
      const anonymousName =
        (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') &&
        !declaration.id
          ? allocateName('__default')
          : undefined;
      const local =
        declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration'
          ? (declaration.id?.name ?? anonymousName ?? '*default*')
          : '*default*';
      if (declaration.type === 'FunctionDeclaration') hoistedModuleBindings.add(local);
      localExports.push({ local, exported: 'default' });
      handleExportDefault(node, edits, source, helpers, anonymousName);
      continue;
    }

    if (node.type === 'ExportAllDeclaration') {
      const ns = allocateName(`__m${importCounter++}`);
      const sourceLit = literalString(node.source.value);
      handleExportAll(node, ns, edits, sourceLit, helpers);
      staticImports.add(sourceLit);
      if (node.exported) {
        const exported = exportName(node.exported);
        explicitExportNames.add(exported);
        namespaceReexports.push({ specifier: sourceLit, exported });
      } else {
        starSpecifiers.push(sourceLit);
      }
    }
  }

  const instantiationBody = [
    ...instantiationImports,
    ...localExports
      .filter(
        (binding) =>
          binding.local !== '*default*' &&
          !linkedImportBindings.some((imported) => imported.local === binding.local),
      )
      .map(
        (binding) =>
          `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(binding.exported)}, { configurable: true, enumerable: true, get: () => ${binding.local} });`,
      ),
  ].join(' ');

  return {
    edits,
    importedBindings,
    staticImports: [...staticImports],
    hasTopLevelAwait: programHasTopLevelAwait(program),
    linkedExports: {
      explicitNames: explicitExportNames,
      localExports,
      importBindings: linkedImportBindings,
      importRequirements,
      namedReexports,
      namespaceReexports,
      starSpecifiers,
    },
    instantiationBody,
    needsGeneratorInstantiation: localExports.some((binding) =>
      hoistedModuleBindings.has(binding.local),
    ),
  };
}

export function renderImportBinding(binding: EsmImportBinding): string {
  if (binding.imported === '*') return `(${binding.ns}())`;
  if (binding.imported === 'default') return `(${binding.ns}().default)`;
  if (/^[A-Za-z_$][\w$]*$/.test(binding.imported)) {
    return `(${binding.ns}().${binding.imported})`;
  }
  return `(${binding.ns}()[${JSON.stringify(binding.imported)}])`;
}

function collectHoistedDeclaration(node: Program['body'][number], names: Set<string>): void {
  if (node.type === 'FunctionDeclaration' && node.id) {
    names.add(node.id.name);
  } else if (node.type === 'VariableDeclaration' && node.kind === 'var') {
    for (const name of collectDeclarationNames(node)) names.add(name);
  } else if (node.type === 'ExportNamedDeclaration' && node.declaration) {
    if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
      names.add(node.declaration.id.name);
    } else if (node.declaration.type === 'VariableDeclaration' && node.declaration.kind === 'var') {
      for (const name of collectDeclarationNames(node.declaration)) names.add(name);
    }
  }
}

function collectImportLinks(
  node: ImportDeclaration,
  sourceLit: string,
  requirements: LinkedImportRequirement[],
  bindings: LinkedImportBinding[],
): void {
  for (const specifier of node.specifiers) {
    if (specifier.type === 'ImportNamespaceSpecifier') {
      bindings.push({ specifier: sourceLit, imported: '*', local: specifier.local.name });
      continue;
    }
    const imported =
      specifier.type === 'ImportDefaultSpecifier'
        ? 'default'
        : specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : String(specifier.imported.value ?? '');
    requirements.push({ specifier: sourceLit, imported });
    bindings.push({ specifier: sourceLit, imported, local: specifier.local.name });
  }
}

function collectNamedExportLinks(
  node: ExportNamedDeclaration,
  sourceLit: string | null,
  explicitNames: Set<string>,
  localExports: LinkedLocalExport[],
  namedReexports: LinkedNamedReexport[],
): void {
  if (node.declaration) {
    for (const name of collectDeclarationNames(node.declaration)) {
      explicitNames.add(name);
      localExports.push({ local: name, exported: name });
    }
  }
  for (const specifier of node.specifiers) {
    const exported = exportName(specifier.exported);
    explicitNames.add(exported);
    const local = exportName(specifier.local);
    if (sourceLit !== null) {
      namedReexports.push({ specifier: sourceLit, imported: local, exported });
    } else {
      localExports.push({ local, exported });
    }
  }
}

/**
 * Detect evaluation-time await without mistaking a nested function body for
 * module TLA. Class heritage, computed keys, static fields, and static blocks
 * execute while the class definition is evaluated and therefore remain in the
 * walk; method bodies and instance-field initializers do not.
 */
function programHasTopLevelAwait(program: Program): boolean {
  let found = false;

  const visit = (value: unknown): void => {
    if (found || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    const node = value as AnyNodeShape;
    if (typeof node.type !== 'string') return;
    if (node.type === 'AwaitExpression') {
      found = true;
      return;
    }
    if (node.type === 'ForOfStatement' && node.await === true) {
      found = true;
      return;
    }
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression'
    ) {
      return;
    }
    if (node.type === 'MethodDefinition') {
      if (node.computed === true) visit(node.key);
      return;
    }
    if (node.type === 'PropertyDefinition' || node.type === 'FieldDefinition') {
      if (node.computed === true) visit(node.key);
      if (node.static === true) visit(node.value);
      return;
    }

    visitChildren(node, visit);
  };

  visit(program);
  return found;
}

function moduleVarBindings(program: Program): Set<string> {
  const names = new Set<string>();
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as AnyNodeShape;
    if (typeof node.type !== 'string') return;
    if (
      node.type === 'FunctionDeclaration' ||
      node.type === 'FunctionExpression' ||
      node.type === 'ArrowFunctionExpression' ||
      node.type === 'ClassDeclaration' ||
      node.type === 'ClassExpression'
    ) {
      return;
    }
    if (node.type === 'VariableDeclaration' && node.kind === 'var') {
      for (const name of collectDeclarationNames(node as unknown as VariableDeclaration)) {
        names.add(name);
      }
      return;
    }
    visitChildren(node, visit);
  };
  visit(program.body);
  return names;
}

interface AnyNodeShape {
  readonly type: string;
  readonly [key: string]: unknown;
}

function visitChildren(node: AnyNodeShape, visit: (value: unknown) => void): void {
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc' || key === 'range') {
      continue;
    }
    visit(node[key]);
  }
}

function isFileAttributeImport(node: ImportDeclaration): boolean {
  const attrs = node.attributes;
  if (!attrs) return false;
  for (const attr of attrs) {
    const key = attr.key.type === 'Identifier' ? attr.key.name : String(attr.key.value ?? '');
    if (key === 'type' && attr.value.value === 'file') return true;
  }
  return false;
}

function handleFileImport(
  node: ImportDeclaration,
  assetVar: string,
  edits: EsmAstEdit[],
  helpers: TransformHelperNames,
): void {
  const spec = literalString(node.source.value);
  const lines: string[] = [`const ${assetVar} = ${helpers.assetPath}(${JSON.stringify(spec)});`];
  for (const specifier of node.specifiers) {
    if (specifier.type === 'ImportDefaultSpecifier') {
      lines.push(`const ${specifier.local.name} = ${assetVar};`);
    } else if (specifier.type === 'ImportNamespaceSpecifier') {
      lines.push(`const ${specifier.local.name} = { default: ${assetVar} };`);
    }
  }
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleImportDeclaration(
  node: ImportDeclaration,
  ns: string,
  edits: EsmAstEdit[],
  importedBindings: Map<string, EsmImportBinding>,
): void {
  const spec = literalString(node.source.value);
  for (const specifier of node.specifiers) {
    if (specifier.type === 'ImportDefaultSpecifier') {
      importedBindings.set(specifier.local.name, { ns, imported: 'default', specifier: spec });
    } else if (specifier.type === 'ImportNamespaceSpecifier') {
      importedBindings.set(specifier.local.name, { ns, imported: '*', specifier: spec });
    } else {
      const imported =
        specifier.imported.type === 'Identifier'
          ? specifier.imported.name
          : String(specifier.imported.value ?? '');
      importedBindings.set(specifier.local.name, { ns, imported, specifier: spec });
    }
  }
  edits.push({ start: node.start, end: node.end, text: '' });
}

function handleReExportNamed(
  node: ExportNamedDeclaration,
  ns: string,
  edits: EsmAstEdit[],
  sourceLit: string,
  helpers: TransformHelperNames,
): void {
  const lines: string[] = [
    `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)});`,
  ];
  for (const specifier of node.specifiers) {
    const exported = exportName(specifier.exported);
    const local = exportName(specifier.local);
    lines.push(
      `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${ns}[${JSON.stringify(local)}] });`,
    );
  }
  lines.push(`${helpers.rebuildExports}(); }`);
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportNamed(
  node: ExportNamedDeclaration,
  edits: EsmAstEdit[],
  imports: Map<string, EsmImportBinding>,
  helpers: TransformHelperNames,
): void {
  if (node.declaration) {
    const declaration = node.declaration;
    const names = collectDeclarationNames(declaration);
    edits.push({ start: node.start, end: declaration.start, text: '' });
    const trailing: string[] = [];
    for (const name of names) {
      trailing.push(
        `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(name)}, { configurable: true, enumerable: true, get: () => ${name} });`,
      );
    }
    trailing.push(`${helpers.rebuildExports}();`);
    edits.push({ start: declaration.end, end: node.end, text: `\n${trailing.join('\n')}` });
    return;
  }

  const lines: string[] = [];
  for (const specifier of node.specifiers) {
    const exported = exportName(specifier.exported);
    const local = exportName(specifier.local);
    const imported = imports.get(local);
    const reference = imported ? renderImportBinding(imported) : local;
    lines.push(
      `${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exported)}, { configurable: true, enumerable: true, get: () => ${reference} });`,
    );
  }
  lines.push(`${helpers.rebuildExports}();`);
  edits.push({ start: node.start, end: node.end, text: lines.join('\n') });
}

function handleExportDefault(
  node: ExportDefaultDeclaration,
  edits: EsmAstEdit[],
  source: string,
  helpers: TransformHelperNames,
  anonymousName?: string,
): void {
  const declaration = node.declaration;
  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    const name = declaration.id?.name ?? anonymousName;
    if (!name) throw new Error('internal: missing synthesized default declaration name');
    edits.push({ start: node.start, end: declaration.start, text: '' });
    if (!declaration.id) {
      const declarationSource = source.slice(declaration.start, declaration.body.start);
      const prefix =
        declaration.type === 'FunctionDeclaration'
          ? /^(?:async\s+)?function(?:\s*\*)?/.exec(declarationSource)?.[0]
          : /^class/.exec(declarationSource)?.[0];
      if (!prefix) throw new Error('internal: failed to locate anonymous default declaration');
      edits.push({
        start: declaration.start + prefix.length,
        end: declaration.start + prefix.length,
        text: ` ${name}`,
      });
    }
    edits.push({
      start: declaration.end,
      end: node.end,
      text: `\n${helpers.slots}.default = ${name};\n${helpers.rebuildExports}();`,
    });
    return;
  }
  edits.push({
    start: node.start,
    end: declaration.start,
    text: `${helpers.slots}.default = (`,
  });
  edits.push({
    start: declaration.end,
    end: node.end,
    text: `);\n${helpers.rebuildExports}();`,
  });
}

function handleExportAll(
  node: ExportAllDeclaration,
  ns: string,
  edits: EsmAstEdit[],
  sourceLit: string,
  helpers: TransformHelperNames,
): void {
  if (node.exported) {
    const exportedName = exportName(node.exported);
    const text = `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)}); ${helpers.runtimeObject}.defineProperty(${helpers.slots}, ${JSON.stringify(exportedName)}, { configurable: true, enumerable: true, get: () => ${ns} }); ${helpers.rebuildExports}(); }`;
    edits.push({ start: node.start, end: node.end, text });
    return;
  }
  const text = `{ const ${ns} = ${helpers.importStatic}(${JSON.stringify(sourceLit)}); for (const __k of ${helpers.runtimeObject}.keys(${ns})) if (__k !== 'default' && !${helpers.runtimeObject}.prototype.hasOwnProperty.call(${helpers.slots}, __k)) ${helpers.runtimeObject}.defineProperty(${helpers.slots}, __k, { configurable: true, enumerable: true, get: ((k) => () => ${ns}[k])(__k) }); ${helpers.rebuildExports}(); }`;
  edits.push({ start: node.start, end: node.end, text });
}

function collectDeclarationNames(declaration: Node): string[] {
  const names: string[] = [];
  if (declaration.type === 'FunctionDeclaration' || declaration.type === 'ClassDeclaration') {
    const id = (declaration as { id?: Identifier | null }).id;
    if (id) names.push(id.name);
    return names;
  }
  if (declaration.type === 'VariableDeclaration') {
    const variable = declaration as unknown as { declarations: { id: Pattern }[] };
    for (const declarator of variable.declarations) collectPatternNames(declarator.id, names);
  }
  return names;
}

function collectPatternNames(pattern: Pattern, names: string[]): void {
  switch (pattern.type) {
    case 'Identifier':
      names.push(pattern.name);
      return;
    case 'ObjectPattern':
      for (const property of (pattern as ObjectPattern).properties) {
        if (property.type === 'RestElement') collectPatternNames(property.argument, names);
        else collectPatternNames(property.value, names);
      }
      return;
    case 'ArrayPattern':
      for (const element of (pattern as ArrayPattern).elements) {
        if (element) collectPatternNames(element, names);
      }
      return;
    case 'RestElement':
      collectPatternNames((pattern as RestElement).argument, names);
      return;
    case 'AssignmentPattern':
      collectPatternNames((pattern as AssignmentPattern).left, names);
      return;
    default:
      return;
  }
}

function exportName(node: Identifier | Literal): string {
  return node.type === 'Identifier' ? node.name : String(node.value ?? '');
}

function literalString(value: unknown): string {
  if (typeof value !== 'string') throw new Error('expected string literal');
  return value;
}
