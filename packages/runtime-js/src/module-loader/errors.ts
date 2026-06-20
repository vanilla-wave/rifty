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
  /**
   * Node-faithful `MODULE_NOT_FOUND` require-stack: the chain of requiring
   * modules (Node lists the immediate requirer first), EMPTY for a top-level
   * entry miss (the entry has no requirer). Set only by the file-resolution
   * MODULE_NOT_FOUND path so `err.requireStack` matches Node's; absent on other
   * codes. Deeper ancestors collapse to the immediate requirer (the resolver
   * sees only `importer`) — see docs/public/compat/process.md.
   */
  readonly requireStack?: readonly string[];

  constructor(
    code: ModuleLoadErrorCode,
    specifier: string,
    message: string,
    importer?: string,
    requireStack?: readonly string[],
  ) {
    super(message);
    this.name = 'ModuleLoadError';
    this.code = code;
    this.specifier = specifier;
    if (importer !== undefined) this.importer = importer;
    if (requireStack !== undefined) this.requireStack = requireStack;
  }
}
