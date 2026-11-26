import { invalidArgType } from './node-received.ts';

/** Node v24.16.0 `internal/errors` `AbortError`: `code` `ABORT_ERR`, `cause` from `options`. */
export class AbortError extends Error {
  declare code: string;
  constructor(message = 'The operation was aborted', options: unknown = undefined) {
    if (options !== undefined && typeof options !== 'object')
      throw invalidArgType('"options" argument', 'of type object', options);
    super(message, options as ErrorOptions);
    this.code = 'ABORT_ERR';
    this.name = 'AbortError';
  }
}
