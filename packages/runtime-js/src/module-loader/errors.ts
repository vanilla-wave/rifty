export type ModuleLoadErrorCode =
  | 'MODULE_NOT_FOUND'
  | 'PACKAGE_PATH_NOT_EXPORTED'
  | 'INVALID_PACKAGE_TARGET'
  | 'UNSUPPORTED_PROTOCOL'
  | 'CIRCULAR_NAMED_IMPORT'
  | 'SYNTAX_ERROR';

export class ModuleLoadError extends Error {
  readonly code: ModuleLoadErrorCode;
  readonly specifier: string;
  readonly importer?: string;

  constructor(code: ModuleLoadErrorCode, specifier: string, message: string, importer?: string) {
    super(message);
    this.name = 'ModuleLoadError';
    this.code = code;
    this.specifier = specifier;
    if (importer !== undefined) this.importer = importer;
  }
}
