/** Node's loud base-stream error; internal shape shared by stream hook owners. */
export function methodNotImplementedError(method: string): Error {
  const error = new Error(`The ${method} method is not implemented`) as Error & {
    code: string;
  };
  error.code = 'ERR_METHOD_NOT_IMPLEMENTED';
  return error;
}
