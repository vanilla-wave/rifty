export interface BodyState {
  stream: ReadableStream<Uint8Array>;
  source: unknown;
  length: number | null;
}
export interface RequestState {
  body: BodyState | null;
  method: string;
  urlList: URL[];
  headersList: { entriesList: [string, string][] };
  redirect: RequestRedirect;
  cache: RequestCache;
  integrity: string;
  keepalive: boolean;
  referrer: URL | 'client' | 'no-referrer';
  referrerPolicy: ReferrerPolicy;
}
interface ResponseState {
  body: BodyState | null;
  type: ResponseType;
  status: number;
  statusText: string;
  urlList: URL[];
  headersList: unknown;
}
export interface FetchClasses {
  Request: typeof Request;
  Response: typeof Response;
  Headers: typeof Headers;
  FormData: typeof FormData;
  fullyReadBody(
    body: BodyState,
    success: (bytes: Uint8Array<ArrayBuffer>) => void,
    failure: (error: unknown) => void,
  ): void;
  argumentLengthCheck(args: { length: number }, minimum: number, context: string): void;
  getRequestState(request: Request): RequestState;
  getRequestDispatcher(request: Request): unknown;
  getResponseState(response: Response): ResponseState;
  getHeadersList(headers: Headers): unknown;
  fromInnerResponse(state: ResponseState, guard: 'immutable'): Response;
  makeResponse(state: Partial<ResponseState>): ResponseState;
  HeadersList: new (entries?: Headers) => unknown;
}
declare function createFetchClasses(
  require: (specifier: string) => unknown,
  process: unknown,
  buffer: unknown,
  platform: {
    isProxy(value: unknown): boolean;
    isDisturbed(value: unknown): boolean;
    trackBody(stream: ReadableStream<Uint8Array>): void;
    toUSVString(value: string): string;
    isUSVString(value: string): boolean;
    emitWarning(message: string, options: { code: string }): void;
  },
): FetchClasses;
export default createFetchClasses;
