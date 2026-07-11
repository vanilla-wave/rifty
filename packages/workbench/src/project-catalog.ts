import { NotImplementedError } from '@riftydev/vfs';
import { normalizePath } from '@riftydev/vfs';
import { type ProjectSpec, resolveBootstrapConfig } from './project-spec.ts';

export interface WorkbenchStarterFile {
  readonly path: string;
  readonly content: string;
}

export interface WorkbenchStarter {
  readonly id: string;
  readonly name: string;
  readonly templateId: string;
  readonly files: readonly WorkbenchStarterFile[];
}

/** Serializable project data installed in every owner realm. */
export interface WorkbenchProjectCatalog {
  readonly defaultTemplateId: string;
  readonly defaultStarterId: string;
  readonly templates: readonly ProjectSpec[];
  readonly starters: readonly WorkbenchStarter[];
}

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`workbench project catalog: ${field} must be a non-empty string`);
  }
  return value;
}

function objectRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`workbench project catalog: ${field} must be an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function rootRelativePath(value: unknown, field: string, requireLeadingSlash = false): string {
  const path = nonEmpty(value, field);
  const absolute = path.startsWith('/') ? path : `/${path}`;
  if (
    (requireLeadingSlash && !path.startsWith('/')) ||
    absolute === '/' ||
    absolute.includes('\0') ||
    normalizePath(absolute) !== absolute
  ) {
    throw new TypeError(
      `workbench project catalog: ${field} must be a normalized root-relative path`,
    );
  }
  return path;
}

function stringRecord(
  value: unknown,
  field: string,
  paths = false,
): Readonly<Record<string, string>> {
  const record = objectRecord(value, field);
  for (const [key, entry] of Object.entries(record)) {
    if (paths) rootRelativePath(key, `${field}.${key}`);
    if (typeof entry !== 'string' || entry.length === 0) {
      throw new TypeError(`workbench project catalog: ${field}.${key} must be a non-empty string`);
    }
  }
  return record as Readonly<Record<string, string>>;
}

function optionalNonEmpty(value: unknown, field: string): void {
  if (value !== undefined) nonEmpty(value, field);
}

function validateTemplate(value: unknown, index: number): ProjectSpec {
  const template = objectRecord(value, `templates[${index}]`);
  nonEmpty(template.id, `templates[${index}].id`);
  nonEmpty(template.displayName, `templates[${index}].displayName`);
  if (
    template.runtime !== 'vite' &&
    template.runtime !== 'node-server' &&
    template.runtime !== 'node-cli'
  ) {
    throw new TypeError(`workbench project catalog: templates[${index}].runtime is invalid`);
  }
  stringRecord(template.install, `templates[${index}].install`);
  if (template.devDependencies !== undefined) {
    stringRecord(template.devDependencies, `templates[${index}].devDependencies`);
  }
  const entry = objectRecord(template.entry, `templates[${index}].entry`);
  rootRelativePath(entry.relativePath, `templates[${index}].entry.relativePath`, true);
  if (typeof entry.content !== 'string') {
    throw new TypeError(
      `workbench project catalog: templates[${index}].entry.content must be a string`,
    );
  }
  const defaultPort = Number(template.defaultPort);
  const minimumPort = template.runtime === 'node-cli' ? 0 : 1;
  if (
    !Number.isInteger(template.defaultPort) ||
    defaultPort < minimumPort ||
    defaultPort > 65_535
  ) {
    throw new TypeError(`workbench project catalog: templates[${index}].defaultPort is invalid`);
  }
  if (
    typeof template.estimatedBootSeconds !== 'number' ||
    !Number.isFinite(template.estimatedBootSeconds) ||
    template.estimatedBootSeconds < 0
  ) {
    throw new TypeError(
      `workbench project catalog: templates[${index}].estimatedBootSeconds is invalid`,
    );
  }
  optionalNonEmpty(template.bakedNodeModulesUrl, `templates[${index}].bakedNodeModulesUrl`);
  optionalNonEmpty(
    template.bakedNodeModulesTemplateId,
    `templates[${index}].bakedNodeModulesTemplateId`,
  );
  if (template.runtime === 'vite') {
    nonEmpty(template.runtimeSpecifier, `templates[${index}].runtimeSpecifier`);
    nonEmpty(template.htmlTitle, `templates[${index}].htmlTitle`);
    if (template.extraFiles !== undefined) {
      stringRecord(template.extraFiles, `templates[${index}].extraFiles`, true);
    }
    const server = objectRecord(template.server, `templates[${index}].server`);
    if (typeof server.appType !== 'string' || server.appType.length === 0) {
      throw new TypeError(
        `workbench project catalog: templates[${index}].server.appType is invalid`,
      );
    }
    for (const field of ['strictPort', 'optimizeDepsDisabled', 'host', 'allowedHosts']) {
      if (typeof server[field] !== 'boolean') {
        throw new TypeError(
          `workbench project catalog: templates[${index}].server.${field} must be boolean`,
        );
      }
    }
    const hmr = objectRecord(template.hmr, `templates[${index}].hmr`);
    if (typeof hmr.enabled !== 'boolean') {
      throw new TypeError(
        `workbench project catalog: templates[${index}].hmr.enabled must be boolean`,
      );
    }
  } else {
    stringRecord(template.extraFiles, `templates[${index}].extraFiles`, true);
  }
  return value as ProjectSpec;
}

export function parseProjectSpec(serialized: string): ProjectSpec {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`workbench project spec: invalid JSON (${reason})`);
  }
  return validateTemplate(value, 0);
}

function validateStarter(value: unknown, index: number): WorkbenchStarter {
  const starter = objectRecord(value, `starters[${index}]`);
  nonEmpty(starter.id, `starters[${index}].id`);
  nonEmpty(starter.name, `starters[${index}].name`);
  nonEmpty(starter.templateId, `starters[${index}].templateId`);
  if (!Array.isArray(starter.files)) {
    throw new TypeError(`workbench project catalog: starters[${index}].files must be an array`);
  }
  const paths = new Set<string>();
  for (const [fileIndex, fileValue] of starter.files.entries()) {
    const file = objectRecord(fileValue, `starters[${index}].files[${fileIndex}]`);
    const path = rootRelativePath(file.path, `starters[${index}].files[${fileIndex}].path`);
    const canonical = path.replace(/^\/+/, '');
    if (paths.has(canonical)) {
      throw new TypeError(
        `workbench project catalog: starters[${index}] has duplicate file ${canonical}`,
      );
    }
    paths.add(canonical);
    if (typeof file.content !== 'string') {
      throw new TypeError(
        `workbench project catalog: starters[${index}].files[${fileIndex}].content must be a string`,
      );
    }
  }
  return value as unknown as WorkbenchStarter;
}

function uniqueIds(values: readonly { readonly id: string }[], field: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id))
      throw new TypeError(`workbench project catalog: duplicate ${field} id ${value.id}`);
    seen.add(value.id);
  }
}

export function validateProjectCatalog(value: unknown): WorkbenchProjectCatalog {
  const catalog = objectRecord(value, 'catalog');
  const defaultTemplateId = nonEmpty(catalog.defaultTemplateId, 'defaultTemplateId');
  const defaultStarterId = nonEmpty(catalog.defaultStarterId, 'defaultStarterId');
  if (!Array.isArray(catalog.templates) || catalog.templates.length === 0) {
    throw new TypeError('workbench project catalog: templates must be a non-empty array');
  }
  if (!Array.isArray(catalog.starters) || catalog.starters.length === 0) {
    throw new TypeError('workbench project catalog: starters must be a non-empty array');
  }
  const templates = catalog.templates.map(validateTemplate);
  const starters = catalog.starters.map(validateStarter);
  uniqueIds(templates, 'template');
  uniqueIds(starters, 'starter');
  const templateIds = new Set(templates.map((template) => template.id));
  if (!templateIds.has(defaultTemplateId)) {
    throw new TypeError(`workbench project catalog: unknown default template ${defaultTemplateId}`);
  }
  if (!starters.some((starter) => starter.id === defaultStarterId)) {
    throw new TypeError(`workbench project catalog: unknown default starter ${defaultStarterId}`);
  }
  for (const starter of starters) {
    if (!templateIds.has(starter.templateId)) {
      throw new TypeError(
        `workbench project catalog: starter ${starter.id} references unknown template ${starter.templateId}`,
      );
    }
  }
  return { defaultTemplateId, defaultStarterId, templates, starters };
}

export function parseProjectCatalog(serialized: string): WorkbenchProjectCatalog {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new TypeError(`workbench project catalog: invalid JSON (${reason})`);
  }
  return validateProjectCatalog(value);
}

export function resolveProjectSpec(
  catalog: WorkbenchProjectCatalog,
  id: string = catalog.defaultTemplateId,
): ProjectSpec {
  const template = catalog.templates.find((candidate) => candidate.id === id);
  if (!template) {
    throw new NotImplementedError('workbench.resolveProjectSpec', `unknown template id: ${id}`);
  }
  return template;
}

export function resolveStarter(
  catalog: WorkbenchProjectCatalog,
  id: string = catalog.defaultStarterId,
): WorkbenchStarter {
  const starter = catalog.starters.find((candidate) => candidate.id === id);
  if (!starter) throw new Error(`unknown workbench starter ${id}`);
  return starter;
}

export function seedFilesForStarter(
  catalog: WorkbenchProjectCatalog,
  starter: WorkbenchStarter,
  root: string,
): Record<string, string> {
  const spec = resolveProjectSpec(catalog, starter.templateId);
  const cfg = resolveBootstrapConfig(spec, spec.defaultPort, root);
  const entryPath = spec.entry.relativePath.replace(/^\/+/, '');
  if (!starter.files.some((file) => file.path.replace(/^\/+/, '') === entryPath)) {
    throw new Error(`starter ${starter.id} is missing entry file ${entryPath}`);
  }
  const files: Record<string, string> = { ...cfg.seedFiles };
  for (const file of starter.files) {
    const relative = file.path.startsWith('/') ? file.path : `/${file.path}`;
    files[`${root}${relative}`] = file.content;
  }
  return files;
}
